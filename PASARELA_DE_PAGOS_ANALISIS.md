# Pasarela de pagos Bill-e — auditoría, boletas y MoR

Fecha: 2026-04-25
Autor: revisión técnica para gonzalo
Alcance: `backend/mercadopago_payment.py`, `backend/flow_payment.py`, `backend/simpleapi_boleta.py`, integración en `backend/main.py` y estrategia comercial declarada en `# ESTRATEGIA DE LANZAMIENTO Y MONET.txt`.

---

## TL;DR

1. **La integración de pagos está OK funcionalmente, pero hay 3 hallazgos críticos** (signature opcional en MP, default email forzado en Flow, boleta no idempotente). Ver §1.
2. **Mercado Pago NO emite boletas electrónicas en Chile.** MP es solo procesador. La emisión DTE está bien delegada a SimpleAPI; el flujo actual es válido pero le faltan reintentos automáticos y notificación al usuario. Ver §2.
3. **Sí, un MoR puede reemplazar la pasarela — pero solo para venta internacional.** Para Chile sigue siendo más rentable el setup local (Flow / Webpay / MP) + SimpleAPI. La estrategia que tienes escrita en el doc de monetización es la correcta. Ver §3.
4. **Recomendación concreta:** Mantener Flow como rail local (descontinuar MP a mediano plazo o dejarlo como segundo método), agregar **Lemon Squeezy** o **Paddle** como MoR para internacional, y usar la moneda detectada por IP/locale del usuario para enrutar. Ver §4 y §5.

---

## 1. Auditoría de la implementación actual

### 1.1 Mercado Pago (`mercadopago_payment.py`)

Lo bueno:

- Usa el SDK oficial de Mercado Pago, soporta tanto Card Payment Brick (embebido) como Wallet Brick (redirect via `init_point`).
- `binary_mode: True` evita estados intermedios largos (rechaza si no hay aprobación inmediata) — buena decisión para SaaS de bajo ticket.
- Filtros de `payment_methods` permiten restringir a crédito o débito si lo necesitas.
- `expiration_date_to` a 24h limpia preferencias colgadas.
- `verify_webhook_signature` está implementado correctamente con HMAC-SHA256 sobre el manifest `id:...;request-id:...;ts:...;`.

Problemas:

- **HALLAZGO CRÍTICO 1** — `verify_webhook_signature` retorna `True` cuando `MP_WEBHOOK_SECRET` no está configurado (línea 277-279). Esto es razonable en dev, pero en producción **debe** fallar cerrado. Sugerencia: leer una env `ENV=production` y cambiar el comportamiento.
- `statement_descriptor: "BILL-E PREMIUM"` — verifica que MP Chile permita el descriptor (algunos procesos lo truncan a 13 caracteres). Si tus usuarios ven cargos en el estado de cuenta como `MP*BILL-E PR` queda mal.
- No se persiste el `preference_id` en Postgres antes de redirigir. Si el usuario abandona y vuelve, no hay forma de recuperar. La fuente de verdad hoy es Redis (`payment_token:{token}`), lo cual es frágil ante un flush.
- No hay control de "no doble pago" (idempotencia). Si el webhook llega dos veces (MP los reenvía), `set_premium_by_email` se llama dos veces. Hoy no rompe nada porque suma tiempo, pero es subóptimo.

### 1.2 Flow.cl (`flow_payment.py`)

Lo bueno:

- Firma HMAC-SHA256 con orden alfabético de keys está correcta (es el formato que pide Flow).
- `paymentMethod: 9` (todos los métodos) deja al usuario elegir Webpay, Khipu, etc. Las cuotas se desactivan en el dashboard de Flow.
- Validación de monto mínimo (350 CLP) antes del request.
- Manejo de error code != 0 en la respuesta.

Problemas:

- **HALLAZGO CRÍTICO 2** — Usa `FLOW_DEFAULT_EMAIL` cuando el usuario no tiene email (línea 89-91). Esto es problemático: Flow asocia el pago a ese email genérico y la **boleta sale con destinatario incorrecto**. En lugar de fallar, prefiere recibir siempre el email del usuario logueado (de Google) y, si no existe, pedirlo en un step previo.
- `urlReturn` y `urlConfirmation` no validan formato. Si por error apuntan a localhost en prod, Flow rechaza pero el error no es claro al usuario.
- No persiste el `flowOrder` real (solo lo guarda al recibir el webhook). Si el webhook se pierde, no hay manera de auditar el estado luego.

### 1.3 Boletas SimpleAPI (`simpleapi_boleta.py`)

Lo bueno:

- Estructura del DTE 39 (Boleta Electrónica) es correcta: Encabezado/Emisor/Totales/Detalle.
- Cálculo de neto e IVA con redondeo (Chile: IVA 19%) está bien.
- Almacena el resultado en Redis con TTL de 30 días y agrega a `boleta:failed_queue` si falla.
- Premium se activa **independientemente** del éxito de la boleta — buena decisión: nunca bloquees al usuario por un fallo del SII.

Problemas:

- **HALLAZGO CRÍTICO 3** — La emisión no es idempotente. Si el webhook reintenta y la boleta ya fue emitida, se intenta emitir otra → genera folio duplicado. Hoy se mitiga porque `payment["status"]` ya está `"paid"`, pero la lógica de `emit_boleta_async` no chequea si ya hay `boleta:{commerce_order}` en Redis.
- No hay reintento automático del `failed_queue`. Solo se acumulan ahí esperando un job manual.
- No hay notificación al usuario de que su boleta está disponible. SimpleAPI devuelve `pdf_url` pero nunca se le envía al payer.
- `Referencia.TpoDocRef = "SET"` es el tipo "SET DE PRUEBAS" para ambiente de certificación. **En producción debe ser otro código** (típicamente no se manda referencia para boletas B2C, o se usa el código del SII correspondiente). Este hallazgo lo verificas con SimpleAPI antes de pasar a producción.
- `RUTEmisor` y `RznSoc` salen del .env. Asegúrate que estén firmados por tu certificado SII; SimpleAPI no firma por ti.

### 1.4 Riesgos transversales

- **No hay sistema de reintento del webhook.** Si Flow o MP reintentan después de una caída, el código asume que Redis tiene el `payment:{commerce_order}` — si Redis se reinició, perdiste la asociación.
- **No hay reconciliación nocturna.** Una rutina diaria que pida estados a Flow/MP de los `payments` en estado `pending` con > 1h es un must para detectar pagos que llegaron sin webhook.
- **PostgreSQL es backup, no fuente de verdad.** El comentario "Redis is source of truth" es correcto operativamente pero peligroso para auditoría fiscal: ante cualquier cuestionamiento del SII, Postgres debe tener la trazabilidad completa.

---

## 2. ¿Mercado Pago emite boletas?

**Respuesta corta: NO.** Y nadie en Chile espera que lo haga.

### 2.1 Qué hace MP

Mercado Pago Chile es un **procesador de pagos** (Payment Service Provider, PSP). Su rol es:
- Capturar el medio de pago (tarjeta, MercadoPago wallet, transferencia).
- Liquidar al comercio (a tu cuenta).
- Emitir su propio "comprobante MP" — que **no es una boleta electrónica del SII**, es solo un voucher interno que sirve como recibo del usuario, no como DTE válido.

Lo mismo aplica a Flow, Transbank/Webpay, Khipu, Klap. Ninguno emite DTE.

### 2.2 Quién emite la boleta

La emisión de boleta electrónica (DTE 39) es responsabilidad **del comercio** (tu SpA / persona natural con inicio de actividades). Necesitas:
1. Estar habilitado como emisor electrónico ante el SII.
2. Tener un certificado digital del SII.
3. Folio CAF (Código de Autorización de Folios) vigente.
4. Un sistema que firme y envíe el XML al SII.

El "sistema" lo puedes implementar:
- **In-house:** firmar XML, mandar al SII, manejar respuestas. Costo: alto (semanas de dev y compliance).
- **Outsourced:** SimpleAPI, Haulmer/OpenFactura, Bsale, NubiPos, OneSII, etc. Costo: ~$10–30 USD/mes + por documento.

### 2.3 ¿Necesitas un flujo adicional?

Hoy ya lo tienes: post-webhook llamas `emit_boleta_async`. Lo que falta:

- **Idempotencia**: chequear `if redis.exists("boleta:{commerce_order}")` antes de emitir.
- **Reintento**: cron que tome `boleta:failed_queue` cada N minutos.
- **Notificación al usuario**: mandar el `pdf_url` por email (Brevo, Resend) o mostrarlo en `/account/billing` dentro de la app.
- **Trazabilidad fiscal**: persistir `folio` y `track_id` en Postgres, no solo en Redis.

Estos cuatro arreglos son ~1 día de desarrollo y los necesitas antes de escalar.

### 2.4 Casos especiales

- **Si vendes a empresas (B2B):** el cliente puede pedir factura electrónica (DTE 33) en lugar de boleta. SimpleAPI también soporta DTE 33 — hay que agregar UI para que el usuario indique RUT empresa + giro y disparar emit_factura.
- **Si exportas servicios (cliente extranjero):** estás en zona gris. Técnicamente vendes a un no-residente y debiera ir con factura de exportación (DTE 110) sin IVA. Aquí es donde el MoR resuelve el problema. Ver §3.

---

## 3. ¿Un MoR puede reemplazar la pasarela?

### 3.1 Qué es un Merchant of Record

Un **Merchant of Record (MoR)** es un intermediario que **figura como vendedor** en la transacción. El usuario le compra al MoR, no a ti. Tú le vendes mayoreo al MoR.

Implicaciones:
- El MoR se encarga del IVA/VAT/sales tax en cada jurisdicción (en EE.UU. son ~46 estados, en UE 27 países, etc.).
- El MoR emite la factura/recibo al usuario final con su nombre comercial.
- El MoR maneja chargebacks, fraude, refunds.
- Cobra una comisión más alta que un PSP puro: típicamente 5–8% + fee fijo, vs 2.9–3.5% + fee fijo de un PSP local.

Players principales:
- **Lemon Squeezy** (ahora propiedad de Stripe): mejor UX dev, pricing 5% + $0.50.
- **Paddle**: más enterprise, soporta más países, pricing 5% + $0.50 (Paddle Billing) o 5% + $0.50 (Paddle Classic).
- **DodoPayments**: alternativa nueva, más barato (4% + $0.40), enfocada en startups.
- **FastSpring**: histórico, más caro pero soporte SaaS empresarial.

### 3.2 ¿Funciona para Chile?

Sí, pero con matices. Tres escenarios:

**Escenario A — Cliente chileno paga con tarjeta CLP a un MoR (ej. Lemon Squeezy)**

- LS toma el cobro en CLP → te liquida en USD a su FX (~1–2% peor que el spot).
- LS NO emite boleta SII chilena. Solo manda un recibo "Lemon Squeezy Inc., Wyoming USA".
- **Problema fiscal:** Para el SII tú no vendiste nada (porque LS facturó al usuario). Pero LS te paga regalías/honorarios → tienes que emitir factura de exportación a LS. Esto cambia tu contabilidad y reduce el "ingreso por boleta chilena" que probablemente quieres maximizar para tu SpA.
- **Problema usuario:** Un chileno con tarjeta CLP que recibe un cargo en USD por una app chilena va a mirar el extracto y desconfiar. Riesgo de chargeback ↑.

**Veredicto Escenario A: NO recomendado.** Para venta CLP-Chile, mantén Flow + boleta local.

**Escenario B — Cliente internacional paga con tarjeta USD a tu Flow / MP**

- Flow Chile no procesa tarjetas extranjeras de manera fluida (tiene flag de internacional pero baja conversión).
- MP sí procesa internacionales pero con FX desfavorable y comisión más alta (~5–6% + IVA, peor que LS).
- Tendrías que emitir factura de exportación chilena (DTE 110) — complejo si son cientos de transacciones pequeñas.

**Veredicto Escenario B: NO recomendado.** Para venta USD-internacional, no uses pasarela local.

**Escenario C — Doble vía (lo que dice tu doc de estrategia)**

- Detectas el país del usuario por IP / locale / tarjeta.
- CL → checkout Flow → SimpleAPI emite boleta DTE 39.
- Resto del mundo → checkout Lemon Squeezy → LS emite recibo a su nombre y maneja IVA local.

**Veredicto: SÍ recomendado.** Es lo que ya planteaste y es el patrón estándar para SaaS chileno con vocación regional.

### 3.3 Comisiones reales (precio premium $5.990 CLP ≈ $6.30 USD)

Asumiendo $1 USD = $950 CLP:

| Camino | Comisión | Neto al comercio | Trabajo fiscal |
|---|---|---|---|
| Flow Chile (CLP→CLP) | 2.95% + $25 + IVA fee | ~$5.477 CLP | Boleta DTE 39 obligatoria, manejas tú |
| Mercado Pago Chile (CLP→CLP) | 3.49% + $30 + IVA fee | ~$5.456 CLP | Boleta DTE 39 obligatoria, manejas tú |
| Webpay Plus / Transbank (CLP→CLP) | 1.49–2.95% según contrato | ~$5.700 CLP* | Boleta DTE 39 obligatoria, manejas tú |
| Lemon Squeezy (USD $6.30) | 5% + $0.50 = ~$0.815 | ~$5.207 CLP | Recibo MoR — tú facturas a LS |
| Paddle (USD $6.30) | 5% + $0.50 = ~$0.815 | ~$5.207 CLP | Recibo MoR — tú facturas a Paddle |

\* Webpay requiere convenio comercial con tu banco, lleva ~30 días de papeleo. No tiene API self-service como Flow.

**Lectura clave:** para CLP-Chile, Flow gana por margen y por simplicidad fiscal local (boleta directa). Para USD-internacional, LS o Paddle ganan **por absorción de complejidad** aunque dejen 5% en mesa — el costo de armar tax-compliance global tú mismo es muchísimo mayor que ese 5%.

### 3.4 Para el ticket bajo ($990 mensual o $1.990 anual)

A precios bajos la **comisión fija** ($0.50 LS, $30 CLP Flow) duele más en %:

| Precio | Flow Chile (% efectivo) | Lemon Squeezy (% efectivo) |
|---|---|---|
| $990 CLP | ~6% | ~58% (no viable) |
| $1.990 CLP | ~4.5% | ~30% (marginal) |
| $5.990 CLP | ~3.4% | ~17% (viable) |

**Conclusión:** si vas a vender internacional, **el ticket mínimo viable es ~$5.000 CLP / $5 USD anual.** Bajo eso, el MoR te come el margen. Tu doc ya identifica esto.

---

## 4. Recomendación

### 4.1 Arquitectura objetivo (3–6 meses)

```
Usuario abre /upgrade
    │
    ▼
¿locale === 'es-CL' o IP en Chile?
    │
    ├── SÍ → Flow.cl (mantener) → Webhook → SimpleAPI emite Boleta DTE 39 → email PDF
    │                                       └── Postgres trazabilidad fiscal
    │
    └── NO → Lemon Squeezy (nuevo) → Webhook → Activar premium → LS manda su recibo
                                              └── Postgres registro contable
```

### 4.2 Plan de migración por fase

**Fase 1 — Semana 1–2: Hardening del flow actual**
- Arreglar los 3 hallazgos críticos (signature opcional, default email, idempotencia boleta).
- Agregar reconciliación nocturna que consulte estados pending > 1h.
- Persistir `folio` y `track_id` de SimpleAPI en Postgres.
- Mandar email con PDF de boleta al usuario tras emisión exitosa.

**Fase 2 — Semana 3–4: Decidir Flow vs MP local**
- Tu doc de estrategia menciona "Flow, Webpay/Transbank" pero ya tienes MP implementado. Recomiendo:
  - Mantener **Flow como rail principal** (mejor UX checkout, soporta Khipu y todos los métodos chilenos).
  - **Descontinuar MP** o dejarlo como fallback si Flow está caído. MP tiene comisión más alta y peor experiencia en Chile que Flow.
  - **Webpay directo** solo si haces > 500 transacciones/mes y firmas convenio con un banco — abajo de eso, Flow es mejor.

**Fase 3 — Semana 5–8: Integración MoR**
- Elegir entre Lemon Squeezy y Paddle según tu necesidad.
  - **Lemon Squeezy** si quieres rapidez y dev experience. Subscriptions, license keys, affiliates listos.
  - **Paddle** si esperas escalar a > $100k ARR pronto y quieres soporte enterprise + más jurisdicciones.
- Crear `lemonsqueezy_payment.py` (similar al Flow): create checkout, webhook handler, status mapping.
- Detección de país: usar `request.headers.get("CF-IPCountry")` (Cloudflare) o `geoip2` lib.
- Frontend: en `/upgrade` page, ramificar el botón según país detectado (con override manual "Pagar desde otro país").

**Fase 4 — Mes 3+: Optimización**
- A/B test ticket internacional ($5.99 anual vs $9.99 anual).
- Considerar agregar PIX (Brasil) y Mercado Pago Argentina con sus rails locales si esos mercados crecen.

### 4.3 Decisiones que NO recomiendo

- **No reemplaces SimpleAPI por nada propio en los próximos 12 meses.** El costo de cumplir el rito SII no compensa hasta que tengas > 5.000 boletas/mes.
- **No uses MoR para usuarios chilenos.** El usuario quiere su boleta nominal con tu razón social. LS/Paddle no pueden emitir DTE 39.
- **No mezcles MP y Flow simultáneamente en producción.** Decide uno como principal y el otro como fallback documentado, no como segunda opción visible al usuario (genera fricción).

---

## 5. Checklist accionable

Para Bill-e antes del lanzamiento masivo:

- [ ] Forzar `MERCADOPAGO_WEBHOOK_SECRET` en producción (fail-closed).
- [ ] Eliminar `FLOW_DEFAULT_EMAIL` como fallback — exigir email del usuario logueado.
- [ ] Agregar idempotencia en `emit_boleta_async`: chequear `redis.exists("boleta:{commerce_order}")` antes de emitir.
- [ ] Persistir `folio`, `track_id`, `pdf_url` en tabla `payments` de Postgres.
- [ ] Cron diario que reprocese `boleta:failed_queue`.
- [ ] Email transaccional con PDF de la boleta (Brevo, Resend o Postmark).
- [ ] Validar con SimpleAPI el `TpoDocRef` correcto para producción (no usar "SET").
- [ ] Reconciliación nocturna: `payments` con `status=pending` y `created_at < now()-1h` → consultar `flow_get_payment_status` o `mp_get_payment`.
- [ ] Agregar Postgres como fuente de verdad en paralelo a Redis (cuando Redis sea cache, no source of truth).

Para llegar a internacional:

- [ ] Decidir Lemon Squeezy vs Paddle (recomiendo LS por velocidad).
- [ ] Crear cuenta MoR, completar KYC (toma 2–7 días).
- [ ] Implementar `backend/lemonsqueezy_payment.py` (create checkout, webhook handler, webhook signature HMAC).
- [ ] Detectar país en frontend (`navigator.language`, `Intl.DateTimeFormat().resolvedOptions().timeZone`, o IP via Cloudflare header).
- [ ] Agregar precio en USD ($5.99 anual sugerido para no canibalizar el CLP).
- [ ] UI: dos botones distintos en /upgrade según país, con opción "soy chileno viajando" para forzar el rail local.
- [ ] Acuerdo contable: LS te liquida en USD a tu cuenta US o CLP a tu cuenta chilena (Wise, Mercury). Define el flujo con tu contador.
- [ ] Factura de exportación periódica (mensual) a LS por las regalías recibidas.

---

## Apéndice A — Referencias rápidas

- Flow API docs: https://www.flow.cl/docs/api.html
- Mercado Pago Chile: https://www.mercadopago.cl/developers/es/reference
- SimpleAPI: https://simpleapi.cl/docs/
- SII formato DTE: https://www.sii.cl/factura_electronica/
- Lemon Squeezy: https://docs.lemonsqueezy.com/api
- Paddle: https://developer.paddle.com/

## Apéndice B — Fragmentos de código relevantes

Ubicación de los 3 hallazgos críticos:

- `backend/mercadopago_payment.py:277-279` — `verify_webhook_signature` con secret vacío retorna `True`.
- `backend/flow_payment.py:89-91` — uso de `FLOW_DEFAULT_EMAIL` como fallback.
- `backend/simpleapi_boleta.py:223` — `emit_boleta` no chequea idempotencia antes de llamar SII.

Donde se encadena todo:

- `backend/main.py:1670-1810` — webhook Flow, activación premium, emisión boleta.
- `backend/main.py:2270-2296` — webhook MP equivalente.
