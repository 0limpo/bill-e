# Bill-e — Migración a modelo Tips-Only

**Fecha**: 2026-05-23
**Estado**: Diseño aprobado, listo para plan de implementación

## Resumen

Bill-e cambia su modelo de negocio de "free-tier (5 boletas) + Premium $3.49" a "**todo gratis + tip voluntario**". El paywall y el cap de 5 sesiones se desactivan. En el paso 3 del flujo (StepShare) aparece un widget permanente que invita al host a tipear, con presets $3 / $7 / $15 (default $7) y opción de dividir el tip entre los participantes reusando la mecánica existente de split-subscription.

Es un cambio de modelo, no un A/B test. La implementación sigue un **soft launch reversible**: el cap se eleva a 500 efectivamente (`FREE_SESSIONS_LIMIT = 500` como defensa antiabuso, inalcanzable en uso humano normal), el widget se agrega de forma aditiva, y la limpieza del código viejo se difiere 2-4 semanas hasta validar KPIs en PostHog.

## Motivación

1. **Crecer adopción**: la tesis es que nadie quiere pagar por una app de división de boletas. Quitando el paywall, más gente la usa y recomienda.
2. **Filosofía "pay what you want"**: el producto sigue gratis para todos; los tips lo sostienen si funcionan.
3. **Hipótesis financiera**: si la base de usuarios crece lo suficiente y un porcentaje pequeño tipea una vez al año, el revenue iguala o supera el modelo Premium actual.

## Decisiones clave

| Decisión | Resultado |
|---|---|
| Modelo | Todo gratis + tip opcional voluntario |
| Quién ve el prompt | Solo el host (editores cero fricción) |
| Cuándo | Al pasar al paso 3 de StepShare, widget permanente (no modal) |
| Montos | Presets $3 / $7 / $15 USD, default $7, custom con mínimo $1 |
| Split del tip | Reusa mecánica de split-subscription. Bill-e aparece como adicional en la boleta de editores cuando split está ON. El host paga su slice vía Polar; el resto se cobra entre amigos sin involucrar a Bill-e. |
| Migración Premium | Badge "Supporter" por 90 días en su landing/header. Sin refund. Pueden tipear igual. |
| Protección OCR | Rate-limit existente 20/min + Turnstile ON. Sin caps nuevos. |
| Plataforma | Solo web. Drop Play Store. Polar para todo. |
| Estrategia de release | Soft launch reversible (constante + aditivo + cleanup diferido) |

## Sección 1 — Backend: bypass del cap

Cambio mínimo, una constante:

- `backend/free_tier.py`: `FREE_SESSIONS_LIMIT = 500`
- `check_can_join` y `record_session_use` mantienen su lógica actual. El cap de 500 es defensa antiabuso por si acaso; ningún humano normal lo alcanza.
- Conserva el conteo de session_ids para telemetría ("cuántas boletas/host" sigue siendo dato útil).
- `POST /api/session/{id}/enter-share` deja de devolver 402 efectivamente (porque nadie normal cruzará 500). Sigue retornando el status como telemetría.
- Endpoints de Polar para Premium $3.49 (`createPolarCheckout`, webhooks) se preservan intactos. El producto viejo queda inactivo en Polar dashboard.

**Lo que NO se toca en esta fase**: `is_premium` en schema, código de paywall en frontend (queda dormant pero inalcanzable porque backend nunca retorna 402 en uso normal).

## Sección 2 — Tip widget en StepShare

**Ubicación**: bloque permanente debajo del botón principal de share, encima del bloque actual de split-subscription (que se reemplaza).

**Estructura visual**:

```
[ Compartir resultados ]   ← CTA existente (share/copy/whatsapp)

──────────────────────────────────
💚 Apoya a Bill-e
Tu tip mantiene al desarrollador despierto ☕

[ $3 ]  [ $7 ✓ ]  [ $15 ]  [ Otro ]
                  ↑ default

☐ Dividir Bill-e entre todos (4 personas)
   $1.75 c/u — aparece como "Bill-e" en su parte

[  Dar tip $7  ]

Conoce al desarrollador →  (expandible)
──────────────────────────────────
```

**Comportamiento**:

- Default $7 pre-seleccionado.
- "Otro" abre input numérico, mínimo $1 USD validado client-side y server-side.
- Toggle "Dividir entre todos" solo visible cuando hay ≥2 participantes. Default OFF. Cuando ON, el monto del CTA cambia a la parte del host (`$7 / 4 = $1.75`), y la línea "Bill-e $1.75" aparece en cada participante (igual mecánica que split-subscription hoy).
- El bloque actual de "split suscripción Premium" se **reemplaza** por este. No coexisten.
- Después de tipear con éxito (`?tip_success=true` en URL), el widget muestra estado "✓ Gracias por tu apoyo" y se reduce a un mini-botón "tipear otra vez". No se oculta, pero ya no es protagónico.
- Si el host es `supporter_until > now()` (Premium migrado), el widget igual aparece. Solo el badge en el header lo identifica.
- "Conoce al desarrollador" abre sección expandible inline con foto + bio breve + link opcional a LinkedIn/portfolio. **La bio la escribe Gonzalo** (no draft de Claude).

**Copy/i18n**: nuevas keys en `i18n.ts` para los 12 idiomas. Regla de neutralidad estricta — sin voseo en español, sin regionalismos en ningún idioma.

## Sección 3 — Flujo de pago del tip

**Endpoint nuevo backend**: `POST /api/tip/create-checkout`

- Input: `{ session_id, amount_usd, is_split, participant_count, google_email, device_id }`
- Validaciones: `amount_usd >= 1.0`, presets exactos o custom, `session_id` debe existir.
- Cálculo: si `is_split`, monto a cobrar al host = `round(amount_usd / participant_count, 2)`; el resto solo se representa en la UI de editores (no se cobra a Bill-e).
- Crea Polar checkout con custom amount, metadata `{ session_id, tip_amount_total, is_split, host_email }`.
- Retorna `{ checkout_url }`.

**Producto Polar**: producto nuevo "Bill-e Tip" con custom amount habilitado. Producto viejo "Premium $3.49" queda inactivo en Polar dashboard (no se borra, para conservar historial).

**Webhook Polar**: el handler existente se extiende para detectar el nuevo producto. Cuando llega `order.paid` con metadata `tip_*`:

- Inserta fila en nueva tabla `tips` (`id, session_id, host_email, amount_total_usd, amount_charged_usd, is_split, participant_count, polar_order_id UNIQUE, created_at`).
- Idempotente por `polar_order_id`.
- No marca `is_premium=true`. El tip no compra status; solo se registra para gratitude/analytics.
- Emite evento PostHog `tip_paid_webhook` (via dual-write como ya hace el resto).

**Retorno al host**: Polar redirige a `/s/{session_id}?tip_success=true&amount=7`. StepShare lee query params, muestra "✓ Gracias por tu apoyo" y dispara confeti suave + PostHog `tip_checkout_returned`.

**Caso edge**:

- Si el host cierra el checkout sin pagar, ningún registro, widget vuelve a estado neutro al volver.
- Si el webhook falla pero el host vuelve con `?tip_success=true`: UX positiva inmediata, pero la fila en `tips` queda sin registrar hasta que el webhook llegue. Idempotencia por `polar_order_id` evita doble-conteo si el webhook llega tarde.

## Sección 4 — Migración Premium → Supporter

**Schema**:

- Agregar columna `supporter_until TIMESTAMP NULL` a tabla `users`.
- `is_premium` y `premium_expires` se preservan dormant en esta fase.

**Migración one-shot** (script ejecutado una vez en deploy):

```sql
UPDATE users
SET supporter_until = COALESCE(
  GREATEST(NOW(), premium_expires),
  NOW()
) + INTERVAL '90 days'
WHERE is_premium = TRUE;
```

Resultado: todo `is_premium=true` queda con `supporter_until = now() + 90d` (o más si su Premium aún no había vencido). Después de 90 días, el badge expira.

**Frontend**:

- `auth.ts`: campo `supporter_until?: string` en `AuthUser`.
- Header: hoy ya muestra avatar del usuario con badge "Premium" / "Free" (commit `df0585b`). Cambio: si `supporter_until > now()`, muestra badge "Supporter ✨" en lugar de "Premium" / "Free".
- Si `supporter_until <= now()` o null, no muestra ningún tier.

**Endpoint**: `GET /api/auth/me` (extender si existe) retorna `supporter_until` para que frontend lo refresque.

**Sin email a usuarios migrados**: por simplicidad, no se manda comunicación proactiva. Se agrega una FAQ corta con el cambio (ruta concreta a decidir en implementación: `/about`, `/faq`, o sección dentro de la privacy policy).

**Comunicación pública**:

- Update en privacy policy / about page mencionando el cambio de modelo.
- Cambio del copy de la landing principal (de "Premium $3.49" a "Gratis, con tips voluntarios"). El rediseño detallado de landing es trabajo aparte; aquí solo cambio mínimo de copy.

## Sección 5 — Telemetría PostHog

**Eventos nuevos** (dual-write Redis + PostHog, siguiendo patrón existente):

| Evento | Properties | Cuándo |
|---|---|---|
| `tip_widget_shown` | `session_id`, `participant_count`, `is_supporter` | Host llega a StepShare (p3) |
| `tip_preset_clicked` | `amount`, `was_default` | Host clickea preset |
| `tip_custom_entered` | `amount` | Host confirma monto custom |
| `tip_split_toggled` | `is_on`, `participants` | Toggle del split |
| `tip_checkout_started` | `amount_total`, `amount_charged_host`, `is_split` | Click en CTA "Dar tip" |
| `tip_checkout_returned` | `success`, `amount` | Redirect back con `?tip_success` |
| `tip_paid_webhook` | `amount_total`, `amount_charged_host`, `is_split`, `polar_order_id` | Webhook Polar confirmado |
| `tip_skipped` | `session_id` | Host comparte sin tipear (`Compartir` clickeado sin `tip_checkout_started` previo en esa sesión) |

**KPIs a vigilar las 2-4 semanas post-launch** (dashboard PostHog "Tips"):

- **Conversion**: `tip_paid_webhook` / `tip_widget_shown` — meta inicial >2% es señal de vida.
- **Average tip**: `avg(amount_total)` — comparar con $3.49 baseline de Premium.
- **Split toggle rate**: `tip_split_toggled is_on=true` / `tip_widget_shown`.
- **Revenue por boleta finalizada**: `sum(amount_charged_host) / count(bill_finalized)` — métrica norte vs Premium model.
- **Funnel**: `widget_shown → preset_clicked → checkout_started → paid_webhook`.

**Trigger de decisión "ripear código viejo"**: pasadas 4 semanas con dashboard estable y sin regresiones detectadas, se procede al cleanup (Sección 6).

## Sección 6 — Limpieza diferida

**PR separada, no incluida en el primer release.** Criterio de gatillo: dashboard PostHog estable, sin tickets relacionados, KPIs vivos.

**Backend**:

- Borrar `backend/free_tier.py` y `backend/test_free_tier.py`.
- Borrar lógica de paywall en `main.py`:
  - `check_can_join` calls en `/api/session/{id}/join` y `/select-participant` (líneas ~991, ~1045).
  - `record_session_use` en `/api/session/{id}/enter-share`. El endpoint puede sobrevivir como telemetría o borrarse entero.
  - Lógica de `merge_device_into_user` en OAuth callback (línea ~3846).
- Drop columnas `is_premium`, `premium_expires` de tabla `users` (migración Alembic).
- Borrar endpoints relacionados a Premium check:
  - `/api/premium/check/{email}`
  - `/api/auth/restore-premium`
  - `/api/auth/transfer-premium` (si existe)
- Borrar `check_premium_by_email` en `collaborative_session.py`.

**Frontend**:

- Borrar `PREMIUM_PRICE_USD`, funciones `getPremiumPrice`, `restorePremiumToDevice`, `transferPremium` en `lib/payment.ts` y `lib/auth.ts`.
- Borrar `is_premium`/`isPremium` de tipos `AuthUser`, `Participant`, tracking events.
- Borrar UI de paywall en `/join` y código muerto de StepShare reemplazado por el widget.
- Página `/payment` queda solo para retornos de tip checkout, o se borra si Polar redirige directo a StepShare.
- Limpiar `i18n.ts` de keys de Premium ya no usadas.

**Polar dashboard**:

- Archivar producto "Bill-e Premium $3.49" (no borrar, historial).
- Mantener "Bill-e Tip" como único producto activo.

**Memoria del proyecto a actualizar**: `project_free_tier_v2.md` marcado como deprecated + crear `project_tips_only.md` con el nuevo modelo.

## Sección 7 — Out of scope explícito

Estas decisiones **no** se tocan en este spec. Cada una requiere brainstorming aparte si se quiere meter:

- **Play Store / TWA**: ya decidido dropear. No hay cambios al código TWA aquí; queda dormant. Limpieza completa de `lib/twa.ts` y rutas TWA es trabajo separado.
- **Chile payments**: sigue geo-bloqueado. El tip widget aplica los mismos criterios geográficos que el Premium actual. Boleta electrónica chilena no se aborda.
- **Multi-currency tips**: solo USD en presets. Sin conversión a CLP/MXN/etc.
- **Recurring tips / subscription-tip**: solo one-off.
- **Email a Premium migrados**: sin comunicación proactiva. FAQ pasiva.
- **Refunds proactivos**: ninguno. Tickets individuales se evalúan caso a caso fuera del spec.
- **Renombrar `is_premium` antes del cleanup**: queda dormant con su nombre actual hasta la PR de limpieza diferida.
- **Rediseño completo de landing**: solo copy mínimo en este spec.
- **A/B testing de montos**: la apuesta inicial $3/$7/$15 default $7 no se A/B testea. Si KPIs post-launch sugieren ajuste, es follow-up.
- **Beneficio adicional para supporters**: hoy supporter es solo badge cosmético (90 días). Si en el futuro se quiere diferenciación funcional, otro spec.

## Resumen de archivos a tocar (no exhaustivo)

**Backend nuevo o modificado**:

- `backend/free_tier.py` — cambio de constante a 500.
- `backend/main.py` — endpoint nuevo `/api/tip/create-checkout`, webhook Polar extendido.
- `backend/postgres_db.py` — tabla `tips`, columna `supporter_until`, helpers.
- `backend/models.py` — modelo `Tip`, extensión de `User`.
- Migración Alembic nueva.

**Frontend nuevo o modificado**:

- `frontend/src/components/steps/StepShare.tsx` — reemplaza bloque split-subscription por TipWidget.
- `frontend/src/components/TipWidget.tsx` — componente nuevo.
- `frontend/src/components/MeetTheDeveloper.tsx` — componente expandible nuevo.
- `frontend/src/lib/payment.ts` — `createTipCheckout`.
- `frontend/src/lib/auth.ts` — campo `supporter_until`.
- `frontend/src/lib/i18n.ts` — keys nuevas en 12 idiomas.
- Header — badge "Supporter" en lugar de "Premium" / "Free".
- Landing / privacy / FAQ — copy actualizado.

**PostHog**:

- Dashboard "Tips" nuevo.
- Eventos custom según tabla en Sección 5.
