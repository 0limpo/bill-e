# 🚀 WhatsApp Business API - Activación Modo Producción

## 📋 ESTADO ACTUAL

**Account ID:** `1374166607626007`
**Status:** Approved pero "Test WhatsApp Business Account"
**Business Verification:** Unverified

**PROBLEMA:** Modo test = Solo puede enviar mensajes a números verificados en sandbox

**OBJETIVO:** Activar modo producción = Enviar a CUALQUIER número

---

## 🔍 VERIFICACIÓN PASO 1: Current Status

### Check Environment Variables en Render

Vamos a verificar que tienes las variables correctas:

**Variables que DEBES tener en Render:**
```
WHATSAPP_ACCESS_TOKEN=your_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_VERIFY_TOKEN=your_verify_token
WHATSAPP_BUSINESS_ACCOUNT_ID=1374166607626007
```

### ¿Cómo verificar si estás en modo Test o Production?

**Indicadores de modo TEST:**
- ✓ Solo puedes enviar a números que agregaste manualmente
- ✓ Dice "Test WhatsApp Business Account" en Meta
- ✓ Límite de 50 mensajes por día
- ✓ Business no verificado

**Indicadores de modo PRODUCTION:**
- ✓ Puedes enviar a CUALQUIER número
- ✓ Dice "Production" o no dice "Test"
- ✓ Sin límite de mensajes (pricing aplica)
- ✓ Business verificado

---

## 🎯 PASO A PASO: ACTIVACIÓN MODO PRODUCCIÓN

### FASE 1: Verificar Webhook (CRÍTICO)

**1.1 Verificar que tu webhook está configurado:**

Ve a: https://developers.facebook.com/apps/

1. Selecciona tu app
2. WhatsApp → Configuration
3. Verifica:
   - **Webhook URL:** `https://bill-e-backend-lfwp.onrender.com/webhook/whatsapp`
   - **Verify Token:** (el que pusiste en `WHATSAPP_VERIFY_TOKEN`)
   - **Status:** Debe estar ✅ verificado

**Si NO está verificado:**
```bash
# Test webhook verification
curl "https://bill-e-backend-lfwp.onrender.com/webhook/whatsapp?hub.mode=subscribe&hub.challenge=TEST_CHALLENGE&hub.verify_token=YOUR_VERIFY_TOKEN"

# Debe retornar: TEST_CHALLENGE
```

**1.2 Subscribir a eventos:**

En WhatsApp → Configuration → Webhook Fields:
- ✅ `messages` (CRITICAL)
- ✅ `message_status` (optional pero recomendado)

Click **Subscribe**

---

### FASE 2: Business Verification (REQUERIDO para producción)

**Diferencia entre Test y Production:**

| Feature | Test Mode | Production Mode |
|---------|-----------|-----------------|
| Business Verification | ❌ No required | ✅ **REQUIRED** |
| Message Recipients | Solo números verificados | CUALQUIER número |
| Message Limit | 50/día | 1000/día (tier 1), escala hasta 100k/día |
| Pricing | Gratis | $0.0042-$0.0089 por mensaje |
| App Review | No necesario | Necesario para algunos permisos |

**2.1 Iniciar Business Verification:**

1. Ve a: https://business.facebook.com/settings
2. Security Center → Start Verification
3. Opciones disponibles:

   **Opción A: Email + Phone (Rápido - 1-2 días)**
   - Email del negocio (@company.com)
   - Teléfono del negocio
   - Website del negocio (opcional)

   **Opción B: Official Document (Más lento - 5-7 días)**
   - Tax ID / Business Registration
   - Articles of Incorporation
   - Utility Bill con dirección del negocio

**2.2 Para startups/pequeños negocios:**

Si no tienes documentos oficiales:
- Usa **Option A**: Email + Phone
- Email: Crea email corporativo (ej: `contact@bill-e.com` con domain)
- Phone: Número de celular válido
- Website: Tu dominio (aunque sea landing page)

---

### FASE 3: Cambiar de Test a Production

**IMPORTANTE:** No hay un "switch" de test a production. El cambio sucede **automáticamente** cuando:

✅ Business está verificado
✅ Webhook está configurado
✅ (Opcional) App Review completado

**3.1 Verificar si ya estás en Production:**

```bash
# Test enviando mensaje a número NO verificado
# Si funciona → Production ✅
# Si falla → Test mode ❌
```

**3.2 Message Templates (REQUERIDO en Production):**

En production, el primer mensaje debe ser:
1. **Plantilla aprobada**, O
2. **Respuesta a mensaje del usuario** (dentro de 24h)

**Crear template:**

1. Ve a: Meta Business Manager → Message Templates
2. Click **Create Template**
3. Template example para Bill-e:

```
Template Name: receipt_processing
Category: UTILITY
Language: Spanish (es)

Body:
🤖 ¡Hola! Soy Bill-e, tu asistente para dividir cuentas.

Envíame una foto clara de tu boleta de restaurante y te ayudaré a dividirla automáticamente entre tus amigos.

📸 Solo toma la foto y envíamela - yo haré el resto.

Buttons (opcional):
[1] Enviar Boleta
[2] Ayuda
```

4. Submit para aprobación (1-2 días)

---

### FASE 4: App Review (Si necesitas permisos adicionales)

**¿Cuándo necesitas App Review?**

- ✅ **NO necesitas** si solo envías mensajes **respondiendo a usuarios**
- ❌ **SÍ necesitas** si quieres enviar mensajes **proactivos** (ej: marketing)

Para Bill-e, como los usuarios **inician** la conversación (enviando foto), **NO necesitas App Review**.

**Pero si quieres enviarlo de todos modos:**

1. Ve a: App Review → Permissions and Features
2. Request: `whatsapp_business_messaging`
3. Provide:
   - Screencast showing use case
   - Step-by-step instructions
   - Privacy policy
   - Terms of service

---

### FASE 5: Aumentar Message Limits (Production)

**Message Tiers:**

| Tier | Limit | Cómo alcanzar |
|------|-------|---------------|
| Tier 1 | 1,000/día | Default al verificar business |
| Tier 2 | 10,000/día | 7 días de phone number quality |
| Tier 3 | 100,000/día | 30 días más de good quality |

**Quality Rating:**
- Status de mensajes
- User blocks
- User reports

**Ver tu tier actual:**
```bash
curl -X GET "https://graph.facebook.com/v18.0/PHONE_NUMBER_ID?fields=quality_rating,messaging_limit_tier" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## 🔧 CONFIGURACIÓN TÉCNICA

### Variables de Entorno en Render

Verifica que tienes TODAS estas variables:

```bash
# WhatsApp Business API
WHATSAPP_ACCESS_TOKEN=EAAXXXXXXXXXXXX
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_VERIFY_TOKEN=tu_token_secreto
WHATSAPP_BUSINESS_ACCOUNT_ID=1374166607626007

# Webhook
FRONTEND_URL=https://tu-frontend.vercel.app

# Redis (para analytics)
REDIS_URL=redis://...

# Google Vision (para OCR)
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}
```

### Webhook Configuration en Meta

**URL:** `https://bill-e-backend-lfwp.onrender.com/webhook/whatsapp`

**Callback Events:**
- ✅ messages
- ✅ message_status (opcional)

**Verify Token:** El valor de `WHATSAPP_VERIFY_TOKEN`

---

## 🧪 TESTING

### Test 1: Webhook Verification
```bash
curl "https://bill-e-backend-lfwp.onrender.com/webhook/whatsapp?hub.mode=subscribe&hub.challenge=TEST&hub.verify_token=YOUR_VERIFY_TOKEN"

# Expected: TEST
```

### Test 2: Send Test Message (Test Mode)
```bash
# Agrega tu número en Meta → Phone Numbers → Manage Phone Number List
# Luego envía mensaje de prueba
```

### Test 3: Production Mode Check
```bash
# Intenta enviar a número NO verificado
# Si funciona → Production ✅
# Si error "phone number not verified" → Test mode
```

---

## 📊 CHECKLIST DE ACTIVACIÓN

### Checklist Mínimo (Para empezar a testear):
- [ ] Webhook configurado y verificado
- [ ] Environment variables en Render
- [ ] Puede recibir mensajes de usuarios
- [ ] Puede responder (dentro de 24h window)

### Checklist Completo (Para producción):
- [ ] Business verificado
- [ ] Webhook en production
- [ ] Message template aprobado
- [ ] Puede enviar a cualquier número
- [ ] Quality rating: Medium o High
- [ ] Messaging limit tier visible

### Checklist Avanzado (Para scale):
- [ ] App Review completado (si necesitas)
- [ ] Tier 2+ messaging limits
- [ ] Multiple message templates
- [ ] Analytics integrado
- [ ] Cost tracking activo

---

## 🚨 TROUBLESHOOTING

### Error: "Recipient phone number not on allowed list"
**Causa:** Estás en test mode
**Fix:** Completa business verification

### Error: "Template not approved"
**Causa:** Intentas enviar mensaje proactivo sin template
**Fix:**
1. Crea y aprueba template, O
2. Solo responde a mensajes de usuarios (24h window)

### Error: "Webhook verification failed"
**Causa:** WHATSAPP_VERIFY_TOKEN incorrecto
**Fix:**
1. Verifica variable en Render
2. Update en Meta Developer Console
3. Re-verificar webhook

### Mensajes no llegan
**Causa:** Webhook no configurado o no suscrito a eventos
**Fix:**
1. Verifica webhook URL
2. Subscribe a "messages" event
3. Check Render logs

---

## 💰 PRICING (Modo Producción)

**Conversation-based pricing:**

| Conversation Type | Price (per 24h) |
|-------------------|-----------------|
| User-initiated | $0.0042 |
| Business-initiated (utility) | $0.0089 |
| Business-initiated (marketing) | $0.0161 |

**Para Bill-e:**
- Usuarios inician (envían foto) → **$0.0042** por conversación
- Tu respondes (OCR + link) → Mismo conversation window = **Gratis**
- Follow-ups dentro de 24h → **Gratis**

**Free Tier:**
- 1,000 conversaciones gratis/mes
- Después: Pricing aplica

**Ejemplo:**
```
100 usuarios/día × 30 días = 3,000 conversaciones/mes
- Primeras 1,000: Gratis
- 2,000 adicionales × $0.0042 = $8.40/mes

Total: $8.40/mes para 3,000 usuarios
```

---

## 🎯 PLAN DE ACCIÓN INMEDIATO

### HOY (30 minutos):

1. **Verificar variables en Render:**
   ```
   ✓ WHATSAPP_ACCESS_TOKEN
   ✓ WHATSAPP_PHONE_NUMBER_ID
   ✓ WHATSAPP_VERIFY_TOKEN
   ```

2. **Test webhook:**
   ```bash
   curl "https://bill-e-backend-lfwp.onrender.com/webhook/whatsapp?hub.mode=subscribe&hub.challenge=TEST&hub.verify_token=YOUR_TOKEN"
   ```

3. **Verificar en Meta:**
   - Webhook configured y verified
   - Subscribed to "messages"

### ESTA SEMANA (1-2 días):

4. **Iniciar Business Verification:**
   - Ve a Meta Business Settings
   - Start verification
   - Submit documents o email+phone

5. **Crear Message Template:**
   - Template name: `receipt_greeting`
   - Category: UTILITY
   - Submit for approval

### PRÓXIMA SEMANA (después de approval):

6. **Test Production Mode:**
   - Enviar mensaje a número no verificado
   - Verificar que funciona

7. **Monitor Quality:**
   - Check quality rating
   - Ensure no blocks/reports
   - Progress to Tier 2

---

## 📞 SOPORTE

**Meta Support:**
- Developer Community: https://developers.facebook.com/community/
- Direct Support: https://business.facebook.com/direct-support/

**Status Dashboard:**
- WhatsApp API Status: https://developers.facebook.com/status/

**Documentation:**
- WhatsApp Business API: https://developers.facebook.com/docs/whatsapp
- Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api

---

## ✅ CONCLUSIÓN

**ACTUALMENTE:**
- ✓ Tienes account creado (ID: 1374166607626007)
- ✓ Status: Approved
- ❌ Pero: Test mode (solo números verificados)
- ❌ Business: Unverified

**PARA ACTIVAR PRODUCTION:**
1. ✅ Verificar webhook (probablemente ya está)
2. 🔄 **Business Verification** (CRÍTICO - 1-2 días)
3. 🔄 Message Template approval (1-2 días)
4. ✅ Ya puedes enviar a cualquier número!

**TIEMPO ESTIMADO:** 3-5 días para full production

**MIENTRAS TANTO:**
- Puedes testear con números verificados
- Webhook funciona
- Analytics trackea todo
- Backend deployed y ready

**🚀 Una vez verificado, estás listo para launch comercial!**
