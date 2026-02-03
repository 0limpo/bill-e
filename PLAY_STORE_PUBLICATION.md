# Publicar Bill-e en Google Play Store (TWA)

Bill-e es una PWA lista para ser publicada en Play Store usando TWA (Trusted Web Activity).

---

## Estado actual (Febrero 2026)

### Completado
- [x] manifest.json configurado
- [x] Service Worker funcionando
- [x] Iconos 192x192 y 512x512
- [x] HTTPS (Vercel)
- [x] assetlinks.json configurado con SHA256
- [x] Cuenta de desarrollador Google Play creada
- [x] APK/AAB generado con PWABuilder
- [x] App creada en Play Console

### Pendiente
- [ ] Completar verificacion de identidad (1-3 dias)
- [ ] Subir AAB a Internal Testing
- [ ] Completar ficha de tienda (screenshots, descripcion)
- [ ] Closed testing
- [ ] Publicar en produccion

---

## Configuracion actual

### Google Play Console
- **Cuenta**: jimenezgonzalom@gmail.com
- **Account ID**: 5625217078568591523
- **Tipo**: Personal (no organizacion)
- **App ID**: 4975380859220625270

### TWA Package
- **Package ID**: `app.vercel.bill_e.twa`
- **App name**: Bill-e
- **URL**: https://bill-e.vercel.app

### Digital Asset Links
- **URL**: https://bill-e.vercel.app/.well-known/assetlinks.json
- **SHA256**: `76:0A:B6:2D:D8:90:D6:57:03:7B:75:0C:E2:D3:5C:B2:82:49:2D:7D:50:42:F9:76:27:69:AD:2C:F1:A2:38:38`

### Archivos de firma (GUARDAR EN LUGAR SEGURO)
- **Ubicacion**: `Bill-e - Google Play package/`
- **Keystore**: `signing.keystore`
- **Password**: `gbpPKMLyKasV`
- **Key alias**: `my-key-alias`

---

## Proceso de publicacion

### Paso 1: Crear cuenta de desarrollador (COMPLETADO)

1. Ir a https://play.google.com/console
2. Tipo de cuenta: Personal (Organizacion requiere D-U-N-S)
3. Pagar $25 USD
4. Verificar identidad (carnet/pasaporte)
5. Verificar dispositivo Android (instalar app Play Console)
6. Verificar telefono (se habilita despues de los anteriores)

### Paso 2: Generar AAB con PWABuilder (COMPLETADO)

1. Ir a https://www.pwabuilder.com/
2. Ingresar URL: `https://bill-e.vercel.app`
3. Click "Package for stores" → "Android"
4. Configurar:

| Campo | Valor |
|-------|-------|
| Package ID | `app.vercel.bill_e.twa` |
| App name | Bill-e |
| Short name | Bill-e |
| Include source code | No |
| Signing key | Let PWABuilder create a new signing key |

5. Descargar ZIP con:
   - `Bill-e.aab` (subir a Play Store)
   - `Bill-e.apk` (para testing local)
   - `signing.keystore` (GUARDAR)
   - `signing-key-info.txt` (GUARDAR)
   - `assetlinks.json` (copiar SHA256)

### Paso 3: Configurar Digital Asset Links (COMPLETADO)

Archivo: `frontend/public/.well-known/assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.vercel.bill_e.twa",
      "sha256_cert_fingerprints": [
        "76:0A:B6:2D:D8:90:D6:57:03:7B:75:0C:E2:D3:5C:B2:82:49:2D:7D:50:42:F9:76:27:69:AD:2C:F1:A2:38:38"
      ]
    }
  }
]
```

Verificar: https://bill-e.vercel.app/.well-known/assetlinks.json

### Paso 4: Subir a Play Console (EN PROGRESO)

Google requiere proceso escalonado:

1. **Internal Testing** (actual)
   - Test and release → Internal testing → Get started
   - Subir `Bill-e.aab`
   - Agregar testers por email (hasta 100)

2. **Finish setting up your app**
   - Completar ficha de tienda
   - Screenshots (minimo 2)
   - Descripcion corta y larga
   - Categoria: Finanzas
   - Clasificacion de contenido
   - Politica de privacidad (URL requerida)

3. **Closed Testing**
   - Probar con grupo mas amplio
   - Recoger feedback

4. **Production**
   - Se habilita despues de closed testing
   - Enviar a revision de Google

---

## Comisiones de Google Play

| Situacion | Comision |
|-----------|----------|
| Primer $1M USD/ano | 15% |
| Suscripciones | 15% |
| Despues de $1M | 30% |
| Sin ventaja gameplay (post-Epic 2026) | 9% |

Bill-e califica para **15%** (o **9%** cuando aplique el acuerdo Epic) porque el premium no otorga "ventaja de gameplay".

### Pagos
- Google deposita el dia **15 de cada mes**
- Umbral minimo: **$1 USD**
- Tiempo de transferencia: 2-7 dias

### Impuestos (Chile)
- Google cobra y paga el IVA al SII por ti
- Registrar RUT de empresa en Play Console evita 19% extra sobre comision
- Declarar ingresos como "servicios digitales" o "servicios exportados"

---

## Actualizaciones futuras

Las actualizaciones de la PWA se reflejan **automaticamente** en la app de Play Store (es la misma web).

Solo necesitas subir un nuevo AAB si:
- Cambias el package name
- Cambias el certificado de firma
- Necesitas actualizar la version minima de Android
- Cambias configuracion del manifest de la TWA

Para subir nueva version:
1. Incrementar version en PWABuilder
2. Usar el **mismo keystore** (signing.keystore)
3. Subir nuevo AAB a Play Console

---

## Troubleshooting

### La app muestra barra de navegador
El archivo `assetlinks.json` no esta configurado correctamente. Verificar:
```bash
curl https://bill-e.vercel.app/.well-known/assetlinks.json
```
Debe retornar JSON con el SHA256 correcto.

### Error de verificacion de firma
El SHA256 en `assetlinks.json` no coincide con el certificado del AAB.
- Verificar que el package_name coincide
- Verificar que el SHA256 es el correcto

### La app no pasa revision
Causas comunes:
- Falta politica de privacidad
- Screenshots no cumplen requisitos (minimo 2)
- Descripcion muy corta
- Contenido no cumple politicas de Google

---

## Archivos importantes

| Archivo | Ubicacion | Proposito |
|---------|-----------|-----------|
| manifest.json | `frontend/public/manifest.json` | Configuracion PWA |
| Service Worker | `frontend/public/sw.js` | Cache y offline |
| assetlinks.json | `frontend/public/.well-known/assetlinks.json` | Verificacion TWA |
| signing.keystore | `Bill-e - Google Play package/` | Firma del AAB |
| Bill-e.aab | `Bill-e - Google Play package/` | Bundle para Play Store |

---

## Recursos

- [PWABuilder](https://www.pwabuilder.com/)
- [Google Play Console](https://play.google.com/console)
- [Digital Asset Links Validator](https://developers.google.com/digital-asset-links/tools/generator)
- [TWA Documentation](https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2)
- [Play Console Help](https://support.google.com/googleplay/android-developer)
