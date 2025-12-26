# Bill-e Variante B - Estado Actual

## Resumen
Bill-e es una app mobile-first para dividir cuentas de restaurante. La Variante B implementa un flujo guiado de 3 pasos para el host.

**URL de prueba:** `https://bill-e.vercel.app/s/{session_id}?v=B&owner={token}`

---

## Arquitectura de Componentes

```
CollaborativeSessionStepFlow.js (2,278 líneas - componente principal)
├── utils/billEngine.js (lógica matemática pura)
└── components/Wizard/
    ├── Avatar.js
    ├── StepIndicator.js
    ├── ChargeModal.js
    ├── BillItem.js (~320 líneas)
    ├── StepReview.js (~170 líneas) - Paso 1
    └── StepShare.js (~140 líneas) - Paso 3
```

---

## Flujo de 3 Pasos (Solo Host)

### Paso 1: Verificar
- **Propósito:** Host revisa items y cargos escaneados
- **UI:** Dos secciones colapsables (Items, Cargos)
- **Acciones:** Editar items, agregar items manuales, agregar cargos/descuentos
- **Componente:** `<StepReview>`

### Paso 2: Asignar
- **Propósito:** Asignar consumos a participantes
- **UI:** Lista de items con avatares de participantes
- **Modos por item:**
  - Individual: Cada unidad se asigna a una persona
  - Grupal: Se comparte entre varios (con opción "por unidad" para qty > 1)
- **Componente:** Inline en principal (usa `<BillItem>`)

### Paso 3: Compartir
- **Propósito:** Ver desglose final y compartir
- **UI:** Tabla con participantes expandibles mostrando su consumo
- **Acciones:** Compartir por WhatsApp, Copiar resumen
- **Componente:** `<StepShare>`

---

## Componentes Principales

### StepIndicator.js
```jsx
// Indicador visual de pasos 1-2-3
// Permite navegar hacia atrás clickeando pasos completados
<div className="step-indicator">
  <div className="step active|completed">
    <div className="step-circle">1|2|3|✓</div>
    <span className="step-label">Verificar|Asignar|Compartir</span>
  </div>
  <div className="step-line completed?" />
</div>
```

### BillItem.js
```jsx
// Item de la cuenta con múltiples estados
// Props principales:
- item: { id, name, price, quantity, mode }
- hideAssignments: boolean (true en Paso 1)
- itemMode: 'individual' | 'grupal'
- isExpanded, isEditing, isSyncing

// Modos de visualización:
1. View mode: qty badge + nombre + precio
2. Edit mode: inputs editables para qty, nombre, precio
3. Grupal con qty>1: Switch "Entre todos" / "Por unidad"
4. Expanded tree: Asignación por unidad individual
```

### StepReview.js (Paso 1)
```jsx
// Dos secciones colapsables:
<div className="collapsible-section">
  <div className="collapsible-header">
    Items (count) | Total
  </div>
  <div className="collapsible-content">
    {items.map(item => <BillItem hideAssignments={true} />)}
    <button>+ Agregar item</button>
  </div>
</div>

// Similar para Cargos/Descuentos
```

### StepShare.js (Paso 3)
```jsx
// Breakdown final estilo hoja de cálculo
<div className="sheet-breakdown">
  <div className="sheet-breakdown-header">
    Nombre | Subtotal | Total
  </div>
  {participants.map(p => (
    <div className="sheet-breakdown-item clickable">
      // Avatar + nombre + subtotal + total
      // Expandible: muestra items consumidos + cargos
    </div>
  ))}
  <div className="sheet-breakdown-total">
    Total Mesa: $XXX
  </div>
</div>
```

---

## Variables CSS Principales

```css
:root {
  --primary: #4f46e5;           /* Indigo */
  --primary-glow: rgba(79, 70, 229, 0.4);

  --glass-surface: rgba(255, 255, 255, 0.75);
  --glass-border: rgba(255, 255, 255, 0.8);
  --blur-amount: 16px;

  --text-main: #111827;
  --text-secondary: #6b7280;
  --success: #10b981;
  --danger: #ef4444;

  --radius-lg: 24px;
  --radius-md: 16px;
  --radius-sm: 12px;
}
```

---

## Estructura de UI Actual

```
┌─────────────────────────────────────┐
│ [Timer]                        ⏱️   │  <- Floating timer (top right)
├─────────────────────────────────────┤
│ 👤 👤 👤 👤 [+]                      │  <- Participants bar (horizontal scroll)
├─────────────────────────────────────┤
│ ○─────○─────○                       │  <- Step indicator (1-2-3)
│ Verificar  Asignar  Compartir       │
├─────────────────────────────────────┤
│                                     │
│ [CONTENIDO DEL PASO ACTUAL]         │  <- Main content area
│                                     │
│ - Paso 1: Collapsibles              │
│ - Paso 2: Lista de BillItems        │
│ - Paso 3: Breakdown table           │
│                                     │
├─────────────────────────────────────┤
│ ═══════════════════════════════════ │  <- Bottom sheet
│ [Botones de navegación]             │
│ ← Anterior    Siguiente →           │
│ [Resumen de totales]                │
└─────────────────────────────────────┘
```

---

## Bottom Sheet por Paso

### Paso 1 (Verificar)
- Muestra: Total Items vs Total Boleta (match/mismatch)
- Botón: "Continuar a Asignar →"

### Paso 2 (Asignar)
- Expandible (drag handle)
- Colapsado: Mini resumen de asignación
- Expandido: Breakdown por participante
- Botones: "← Volver" | "Cerrar Cuenta →"

### Paso 3 (Compartir)
- Botones de compartir: WhatsApp, Copiar
- Botón: "Reabrir cuenta"

---

## Vista del Editor (No-Host)

Los editores (participantes que no son host) ven:
- La misma barra de participantes
- Lista de items con capacidad de asignar
- Su breakdown personal en el bottom sheet
- NO ven el indicador de pasos (flujo lineal simple)

---

## Archivos Relevantes

| Archivo | Líneas | Descripción |
|---------|--------|-------------|
| `CollaborativeSessionStepFlow.js` | 2,278 | Componente principal |
| `CollaborativeSessionStepFlow.css` | 3,401 | Estilos completos |
| `utils/billEngine.js` | ~180 | Lógica matemática |
| `components/Wizard/BillItem.js` | ~320 | Item con asignaciones |
| `components/Wizard/StepReview.js` | ~170 | UI Paso 1 |
| `components/Wizard/StepShare.js` | ~140 | UI Paso 3 |

---

## Traducciones (i18n)

La app soporta múltiples idiomas. Keys relevantes para los pasos:
```json
{
  "steps": {
    "verify": "Verificar",
    "assign": "Asignar",
    "share": "Compartir",
    "verifyTitle": "Verifica los items",
    "verifySubtitle": "Revisa que todo esté correcto",
    "assignTitle": "Asigna los consumos",
    "assignSubtitle": "¿Quién consumió qué?"
  }
}
```

---

## Áreas de Mejora Potencial (UI/UX)

1. **Transiciones entre pasos** - Actualmente sin animación
2. **Feedback visual** - Indicadores de progreso de asignación
3. **Onboarding** - No hay guía para nuevos usuarios
4. **Accesibilidad** - Contraste, tamaños táctiles
5. **Estados vacíos** - Mensajes cuando no hay items/participantes
6. **Micro-interacciones** - Animaciones sutiles en acciones
7. **Dark mode** - Solo hay light mode
8. **Responsive** - Optimizado para móvil, desktop podría mejorar

---

## Prompt Sugerido para Gemini

```
Eres un diseñador UI/UX experto. Analiza el estado actual de Bill-e Variante B
(app mobile-first para dividir cuentas) y propón mejoras de UI para el flujo
de 3 pasos del host.

Contexto:
- Framework: React con CSS vanilla (glassmorphism style)
- Target: Mobile-first, iOS/Android browsers
- Usuarios: Grupos en restaurantes dividiendo la cuenta
- Flujo: Verificar items → Asignar consumos → Compartir resultado

Prioriza:
1. Mejoras que no requieran cambios estructurales grandes
2. Micro-interacciones y feedback visual
3. Claridad en el flujo de pasos
4. Accesibilidad y usabilidad táctil

Formato de respuesta:
- Lista priorizada de mejoras
- Para cada mejora: descripción, impacto esperado, complejidad (baja/media/alta)
- Snippets de CSS/JSX cuando sea útil
```
