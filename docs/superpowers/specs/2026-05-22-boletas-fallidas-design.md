# Captura de boletas fallidas para mejorar el OCR

**Fecha:** 2026-05-22
**Autor:** Gonzalo (con Claude)
**Estado:** Diseño aprobado, pendiente de implementación

## Objetivo

Capturar automáticamente las imágenes de boletas que fallan el OCR o son marcadas con `needs_review`, persistirlas en Postgres hasta por 30 días, y permitir su exportación manual al corpus local de `ocr-benchmark/` para afinar el prompt con casos reales de producción.

Hoy los fallos se cuentan pero las imágenes se descartan, así que el corpus de benchmark depende 100 % de recolección manual. Este diseño cierra ese hueco con el mínimo de infraestructura nueva posible.

## Alcance

**Incluido**

- Captura silenciosa en backend de imágenes cuando el OCR falla duro o vuelve con `needs_review`.
- Tabla nueva en Postgres con los bytes de la imagen y metadata.
- Limpieza automática de capturas con más de 30 días (lazy, on-insert).
- Endpoints admin para listar, descargar y borrar capturas.
- Script local en `ocr-benchmark/scripts/` que sincroniza las capturas a `ocr-benchmark/incoming/`.
- Línea agregada en la política de privacidad.

**Explícitamente fuera de alcance (YAGNI)**

- UI de cara al usuario, opt-in, toggle de consentimiento.
- Almacenamiento en S3 / R2 / disco persistente.
- Anonimización o difuminado de las imágenes (anularía el objetivo).
- Reprocesamiento automático ni reintento.
- Análisis automático del corpus.
- Dedup por hash (futuro, no v1).

## Arquitectura

```
┌─────────┐    foto    ┌─────────────────────┐    ┌──────────┐
│ Usuario │ ─────────▶ │  Backend (Render)   │ ──▶│  Gemini  │
└─────────┘            │  /ocr  o  /upload   │    └──────────┘
                       └──────────┬──────────┘
                                  │
                                  │  ¿fallo duro o needs_review?
                                  │  sí ▼
                       ┌─────────────────────┐
                       │ Postgres (Render)   │ ◀── auto-prune
                       │ failed_ocr_captures │     >30 días
                       │                     │     (lazy on insert)
                       └──────────┬──────────┘
                                  │
                                  │  GET con auth admin
                                  │  (cuando quieras)
                                  ▼
                       ┌─────────────────────┐
                       │  Tu laptop          │
                       │  python scripts/    │
                       │  sync-failed-       │
                       │  boletas.py         │
                       │         │           │
                       │         ▼           │
                       │  ocr-benchmark/     │
                       │  incoming/{id}.jpg  │
                       │       + sidecar     │
                       │       + DELETE      │
                       │       en DB         │
                       └─────────────────────┘
```

**Por qué Postgres y no R2/S3/disco:** la DB de Render ya existe, ya tiene acceso vía MCP (`postgres-bille`), el volumen esperado es bajísimo (\~5-15 capturas/día × \~500 KB-3 MB = peak \~45 MB en 30 días con auto-prune), y guardar `bytea` a esta escala es perfectamente sano. Si en el futuro el tráfico crece 10×, migrar a R2 es trivial — pero ahora sería sobre-ingeniería.

## Componentes

### 1. Tabla Postgres: `failed_ocr_captures`

```sql
CREATE TABLE failed_ocr_captures (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    image_bytes     BYTEA NOT NULL,
    image_mime      VARCHAR(50) NOT NULL,
    image_size_bytes INTEGER NOT NULL,
    reason          VARCHAR(20) NOT NULL
                    CHECK (reason IN ('hard_fail', 'needs_review')),
    error_msg       TEXT,
    gemini_raw      JSONB,
    session_id      VARCHAR(64) NOT NULL,
    endpoint        VARCHAR(20) NOT NULL
                    CHECK (endpoint IN ('ocr', 'upload')),
    ip_hash         VARCHAR(64)
);

CREATE INDEX idx_failed_ocr_created_at ON failed_ocr_captures(created_at);
CREATE INDEX idx_failed_ocr_session_id ON failed_ocr_captures(session_id);
```

- `image_bytes` guarda los bytes **tal como llegaron al endpoint** (antes de la compresión a 2048 px que hace Gemini), porque el benchmark replica el pipeline completo y necesita la imagen original.
- `gemini_raw` guarda el JSON crudo de Gemini para los casos `needs_review` (en `hard_fail` queda `NULL`).
- `ip_hash` es SHA-256 de la IP de origen, útil para dedup futuro sin almacenar la IP en claro.
- No hay columna `exported_at`: el flujo es DELETE-after-download (ver §5), así que la presencia de la fila ya indica "pendiente de exportar".

### 2. Persistencia en backend (`backend/main.py` + `backend/postgres_db.py`)

Se agrega una función `persist_failed_capture()` en `postgres_db.py`:

```python
def persist_failed_capture(
    image_bytes: bytes,
    image_mime: str,
    reason: str,                # 'hard_fail' | 'needs_review'
    error_msg: Optional[str],
    gemini_raw: Optional[dict],
    session_id: str,
    endpoint: str,              # 'ocr' | 'upload'
    ip_hash: Optional[str],
) -> None:
    """Fire-and-forget. Nunca debe propagar excepciones."""
```

En el bloque `finally` de ambos endpoints OCR (`/api/session/{id}/ocr` y `/upload`), después de `analytics_tracker.track_ocr_usage(...)`. El nombre del endpoint se pasa como literal — cada endpoint tiene su propio call site con `endpoint='ocr'` o `endpoint='upload'` hardcoded:

```python
# Dentro de /api/session/{id}/ocr:
try:
    should_capture = (
        not _ocr_succeeded
        or (ocr_result and ocr_result.get('needs_review'))
    )
    if should_capture:
        persist_failed_capture(
            image_bytes=image_bytes,
            image_mime=detect_image_mime(image_bytes),
            reason='hard_fail' if not _ocr_succeeded else 'needs_review',
            error_msg=_ocr_error_msg,
            gemini_raw=ocr_result if _ocr_succeeded else None,
            session_id=session_id,
            endpoint='ocr',  # literal por endpoint
            ip_hash=_hash_ip(_extract_client_ip(request)),
        )
except Exception as cap_err:
    print(f"Failed to persist OCR capture: {cap_err}")
```

**Helpers que faltan agregar:**

- `detect_image_mime(image_bytes)` → mira los magic bytes (`\xFF\xD8` = JPEG, `\x89PNG` = PNG, `RIFF...WEBP` = WebP). Función nueva en `gemini_service.py` o un util.
- `_extract_client_ip(request)` → ya existe la lógica de extracción en el rate-limit setup (resuelve `X-Forwarded-For` y `CF-Connecting-IP`); refactorizar a función nombrada y reusarla.
- `_hash_ip(ip)` → `hashlib.sha256(ip.encode()).hexdigest()`. Una línea.

**Invariantes:**

- La captura es 100 % fire-and-forget: si Postgres falla o la inserción explota, el usuario no se entera y la respuesta del endpoint no se altera.
- El `image_bytes` ya está validado por el límite de tamaño (`MAX_OCR_IMAGE_BYTES = 20 MB`), así que no hay riesgo de inflar la DB con uploads gigantes.

### 3. Auto-prune lazy (on insert)

Dentro de `persist_failed_capture()`, justo después del `INSERT` exitoso, ejecutar:

```sql
DELETE FROM failed_ocr_captures
WHERE created_at < now() - interval '30 days';
```

**Por qué lazy y no un cron:**

- Cero infraestructura nueva (sin APScheduler, sin Render Cron Jobs).
- Se ejecuta sólo cuando hay actividad — alineado con la realidad: si nadie usa el OCR, no hay nada que limpiar.
- El delete es barato (índice en `created_at`, volumen mínimo) y va dentro de la misma transacción del INSERT, así que un fallo lo revierte sin dejar estado inconsistente.

### 4. Endpoints admin

Tres endpoints en `main.py`, todos protegidos por header `X-Admin-Token`:

```
GET    /api/admin/failed-captures
GET    /api/admin/failed-captures/{id}/image
DELETE /api/admin/failed-captures/{id}
```

**Auth:** se compara el header contra la env var `ADMIN_TOKEN` en Render (string aleatorio largo, generado una vez). Sin user accounts. Si el header está ausente o no matchea → `401`. Esto es suficiente para un único founder; cuando haya equipo se cambia.

**`GET /api/admin/failed-captures`** retorna metadata (sin bytes) para preview:

```json
{
  "captures": [
    {
      "id": "uuid",
      "created_at": "2026-05-22T...",
      "reason": "needs_review",
      "error_msg": null,
      "session_id": "...",
      "endpoint": "ocr",
      "image_mime": "image/jpeg",
      "image_size_bytes": 1234567,
      "gemini_raw": { ... }
    }
  ],
  "total": 42
}
```

Soporta `?limit=100` (default 500, máx 1000). No paginación compleja en v1 — al volumen esperado, una sola página alcanza.

**`GET /api/admin/failed-captures/{id}/image`** retorna los bytes binarios con el `Content-Type` correcto (`image/jpeg` o `image/png`).

**`DELETE /api/admin/failed-captures/{id}`** borra la fila. Idempotente: si no existe, retorna `204` igualmente.

**No hay rate limit:** tráfico admin, bajo volumen, no relevante.

### 5. Script local: `ocr-benchmark/scripts/sync-failed-boletas.py`

Flujo:

1. Leer config:
   - `BILL_E_ADMIN_TOKEN` de la env var, con fallback al archivo `~/.bill-e-admin-token` (primero env, luego archivo).
   - `BILL_E_BACKEND_URL` de env var, default `https://bill-e-backend-lfwp.onrender.com`.
2. `GET {BACKEND_URL}/api/admin/failed-captures` → lista de capturas con metadata.
3. Para cada captura:
   - Si `ocr-benchmark/incoming/{created_at}_{id}.{ext}` ya existe localmente, hacer sólo el `DELETE` remoto (caso de re-corrida tras crash a mitad).
   - Si no, `GET /image`, guardar los bytes a disco.
   - Escribir sidecar `{created_at}_{id}.json` con la metadata + `gemini_raw`.
   - `DELETE` remoto.
4. Imprimir resumen: N descargadas, N re-DELETE, N errores.

```
ocr-benchmark/
├── incoming/
│   ├── 2026-05-22T10-15-03_<uuid>.jpg
│   ├── 2026-05-22T10-15-03_<uuid>.json
│   └── ...
└── scripts/
    └── sync-failed-boletas.py
```

**Por qué DELETE-after-save y no `exported_at`:**

- Modelo más simple, sin estado intermedio en la DB.
- La race condition (file save OK + DELETE falla) es benigna: la próxima corrida ve el archivo local, salta la descarga y reintenta el DELETE.
- Auto-prune a 30 días es el backstop para huérfanos.

### 6. Política de privacidad

Agregar en `/privacy` (frontend):

> Cuando el escaneo de una boleta falla o requiere revisión, podemos conservar la imagen hasta 30 días en nuestros servidores para mejorar la precisión del OCR. Estas imágenes son de uso interno y no se comparten con terceros.

Disponible en los 12 idiomas que soporta el producto, siguiendo la regla de registro neutro.

## Manejo de errores

| Componente | Fallo | Comportamiento |
|---|---|---|
| `persist_failed_capture` | DB caída, timeout, lo que sea | `try/except`, log a stdout, continuar. El usuario no se entera. |
| Auto-prune dentro del INSERT | Falla del DELETE | Misma transacción que el INSERT → rollback. Próxima inserción reintenta la limpieza. |
| `GET /failed-captures` sin token o token inválido | 401 |
| `GET /image/{id}` con id inexistente | 404 |
| `DELETE /image/{id}` con id inexistente | 204 (idempotente) |
| Sync script: error en una captura | Log, continuar con las siguientes. El error se incluye en el resumen final. |

## Pruebas

**Unit tests (backend/test_failed_captures.py):**

- `persist_failed_capture` inserta correctamente con `hard_fail`.
- `persist_failed_capture` inserta correctamente con `needs_review`.
- Auto-prune borra filas con > 30 días y deja las recientes.
- `persist_failed_capture` no propaga excepciones cuando la DB está caída (mock).

**Integration test manual:**

1. Subir una imagen claramente no-boleta (foto de un paisaje) al endpoint `/upload`.
2. Verificar `GET /api/admin/failed-captures` → aparece con `reason='hard_fail'`.
3. Verificar `GET /image/{id}` → retorna los bytes correctos.
4. Correr el script de sync local → archivos en `ocr-benchmark/incoming/`.
5. Verificar que la fila se borró de la DB.

**Verificación post-deploy:**

- Después del deploy, esperar 24-48 h y revisar manualmente que estén apareciendo capturas reales.
- Confirmar que el counter `ocr:total` en Redis y el conteo en `failed_ocr_captures` son consistentes (failure rate similar al `21%` histórico).

## Migración / Rollout

1. Migración SQL en `backend/postgres_db.py` (o un archivo `migrations/` si existe) — crear la tabla con índices.
2. Generar `ADMIN_TOKEN` y agregarlo a las env vars del backend en Render.
3. Implementar `persist_failed_capture` y los endpoints admin.
4. Deploy a producción (commit + push a `main`).
5. Crear `ocr-benchmark/scripts/sync-failed-boletas.py` y guardar `~/.bill-e-admin-token` localmente.
6. Agregar la línea de privacidad en frontend (`i18n.ts` × 12 idiomas) y deploy.
7. Esperar 24-48 h y validar con sync real.

## Decisiones abiertas (post-v1)

- **Dedup automático**: hash SHA-256 de `image_bytes` para evitar duplicados si un usuario reintenta. Fácil de agregar después.
- **Migración a R2**: cuando el volumen pase de ~100 capturas/día o ~1 GB en reposo. El código admin endpoint se mantiene; sólo cambia el storage backend.
- **Vincular con anotación manual del benchmark**: el sidecar ya trae `session_id` y `gemini_raw`, así que el flujo de anotación existente puede consumirlos sin cambios.
- **Endpoint para `mark-exported` sin borrar**: si en el futuro quieres conservar el corpus en la DB en lugar de moverlo al disco local. No para v1.
