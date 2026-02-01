# Publicar Bill-e en Google Play Store (TWA)

Bill-e es una PWA lista para ser publicada en Play Store usando TWA (Trusted Web Activity).

## Requisitos previos

- [x] manifest.json configurado
- [x] Service Worker funcionando
- [x] Iconos 192x192 y 512x512
- [x] HTTPS (Vercel)
- [x] assetlinks.json preparado
- [ ] Cuenta de desarrollador Google Play ($25 USD)
- [ ] SHA256 fingerprint del certificado

---

## Paso 1: Crear cuenta de desarrollador

1. Ir a https://play.google.com/console
2. Iniciar sesion con cuenta Google
3. Pagar $25 USD (pago unico, no es suscripcion)
4. Completar informacion del desarrollador

---

## Paso 2: Generar APK/AAB con PWABuilder

1. Ir a https://www.pwabuilder.com/
2. Ingresar la URL de produccion (ej: `https://bill-e.cl`)
3. Esperar el analisis
4. Click "Package for stores" → "Android"
5. Configurar:

| Campo | Valor |
|-------|-------|
| Package ID | `cl.bille.twa` |
| App name | Bill-e |
| Short name | Bill-e |
| App version | 1.0.0 |
| App version code | 1 |
| Host | bill-e.cl (tu dominio) |
| Start URL | / |
| Theme color | #3F7BF6 |
| Background color | #121214 |
| Signing key | Let PWABuilder create a new signing key |

6. Click "Generate"
7. Descargar el ZIP

---

## Paso 3: Actualizar Digital Asset Links

El ZIP de PWABuilder incluye un archivo con el **SHA256 fingerprint** del certificado.

1. Abrir el archivo `assetlinks.json` incluido en el ZIP
2. Copiar el valor de `sha256_cert_fingerprints`
3. Editar `frontend/public/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "cl.bille.twa",
      "sha256_cert_fingerprints": [
        "AA:BB:CC:DD:EE:FF:..."  // <-- Pegar el SHA256 real aqui
      ]
    }
  }
]
```

4. Commit y push los cambios
5. Verificar que el archivo es accesible: `https://bill-e.cl/.well-known/assetlinks.json`

---

## Paso 4: Subir a Play Console

1. Ir a Play Console → "Crear app"
2. Completar informacion basica:
   - Nombre: Bill-e
   - Idioma: Espanol (Chile)
   - Tipo: App
   - Gratis/Pago: Gratis (con compras in-app)

3. Subir el archivo `.aab` (Android App Bundle) del ZIP

4. Completar la ficha de Play Store:
   - Descripcion corta (80 chars): "Divide cuentas de restaurante facil con tus amigos"
   - Descripcion larga: Explicar funcionalidades
   - Icono: 512x512 (ya existe en `/public/icon-512.png`)
   - Screenshots: Minimo 2 capturas de pantalla
   - Categoria: Finanzas
   - Correo de contacto

5. Completar cuestionarios:
   - Clasificacion de contenido
   - Publico objetivo
   - Politica de privacidad (URL requerida)

6. Enviar a revision

---

## Comisiones de Google Play

| Situacion | Comision |
|-----------|----------|
| Primer $1M USD/ano | 15% |
| Suscripciones | 15% |
| Despues de $1M | 30% |
| Sin ventaja gameplay (post-Epic 2026) | 9% |

Bill-e califica para **15%** (o **9%** cuando aplique el acuerdo Epic) porque el premium no otorga "ventaja de gameplay".

---

## Actualizaciones

Las actualizaciones de la PWA se reflejan automaticamente en la app de Play Store (es la misma web). Solo necesitas subir un nuevo AAB si:

- Cambias el package name
- Cambias el certificado de firma
- Necesitas actualizar la version minima de Android

---

## Troubleshooting

### La app muestra barra de navegador
El archivo `assetlinks.json` no esta configurado correctamente o no es accesible. Verificar:
```bash
curl -I https://bill-e.cl/.well-known/assetlinks.json
# Debe retornar 200 OK y Content-Type: application/json
```

### Error de verificacion de firma
El SHA256 en `assetlinks.json` no coincide con el certificado del APK. Regenerar desde PWABuilder con el mismo keystore.

### La app no pasa revision
Causas comunes:
- Falta politica de privacidad
- Screenshots no cumplen requisitos
- Descripcion muy corta o con errores

---

## Recursos

- [PWABuilder](https://www.pwabuilder.com/)
- [Google Play Console](https://play.google.com/console)
- [Digital Asset Links Validator](https://developers.google.com/digital-asset-links/tools/generator)
- [TWA Documentation](https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2)
