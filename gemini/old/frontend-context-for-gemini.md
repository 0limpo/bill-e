# Bill-e Frontend - Contexto para Gemini

## Resumen del Proyecto

**Bill-e** es una app para dividir cuentas de restaurante. El usuario envía una foto de la boleta por WhatsApp, el backend hace OCR con Gemini, y crea una sesión colaborativa donde los participantes pueden asignar items y ver cuánto debe pagar cada uno.

## Stack Tecnológico

- **React 19** (Create React App)
- **React Router DOM 7** - Routing
- **i18next** - Internacionalización (ES, EN, PT, etc.)
- **lucide-react** - Iconos
- **CSS vanilla** - Diseño Glassmorphism

## Estructura de Archivos

```
frontend/src/
├── App.js                    # Router principal + SessionPage legacy
├── CollaborativeSession.js   # Componente principal (3000+ líneas)
├── CollaborativeSession.css  # Estilos glassmorphism (2700+ líneas)
├── analytics.js              # Google Analytics
├── index.js                  # Entry point
└── i18n/
    └── index.js              # Traducciones
```

## Componente Principal: CollaborativeSession.js

### Roles de Usuario
- **Host (owner)**: Quien creó la sesión. Puede editar items, cambiar modos, finalizar.
- **Editor**: Participante que puede asignar items a sí mismo.

### Flujo Principal
1. Usuario llega via URL `/s/{sessionId}?owner={uuid}` (host) o `/s/{sessionId}` (editor)
2. Si es editor nuevo, ve pantalla de selección para identificarse
3. Vista principal muestra:
   - Lista de participantes (avatares circulares)
   - Items de la cuenta (cards glassmorphism)
   - Bottom sheet con total y desglose

### Modos de Asignación por Item
- **Individual**: Cada persona marca cuántas unidades consumió
- **Grupal**: Se divide entre los que marcaron "participé"

### Estados Importantes
```javascript
const [session, setSession] = useState(null);           // Datos de sesión del backend
const [participants, setParticipants] = useState([]);   // Lista de participantes
const [currentUser, setCurrentUser] = useState(null);   // Usuario actual
const [isOwner, setIsOwner] = useState(false);          // Es host?
const [isFinalized, setIsFinalized] = useState(false);  // Sesión cerrada?
```

## API Backend

**Base URL**: `https://bill-e-backend-lfwp.onrender.com`

### Endpoints Principales
```
GET  /api/session/{id}/collaborative    # Datos completos de sesión
POST /api/session/{id}/participant      # Agregar participante
POST /api/session/{id}/assign           # Asignar item a persona
PUT  /api/session/{id}/item/{itemId}    # Editar item (host only)
POST /api/session/{id}/finalize         # Cerrar sesión (host only)
```

### Estructura de Sesión (response)
```json
{
  "session_id": "abc123",
  "items": [
    {
      "id": "item_0",
      "name": "Hamburguesa",
      "price": 12990,
      "quantity": 2,
      "mode": "individual",
      "assignments": {
        "person_uuid": 1
      }
    }
  ],
  "participants": [
    {
      "id": "uuid",
      "name": "Juan",
      "phone": "569...",
      "role": "owner"
    }
  ],
  "charges": [...],
  "subtotal": 50000,
  "total": 55000,
  "tip": 5000,
  "decimal_places": 0,
  "number_format": {"thousands": ".", "decimal": ","},
  "is_finalized": false,
  "expires_at": "2025-12-21T..."
}
```

## Diseño Visual

### Variables CSS Principales
```css
--primary: #4f46e5;           /* Indigo */
--glass-surface: rgba(255, 255, 255, 0.75);
--blur-amount: 16px;
--radius-lg: 24px;
--success: #10b981;
--danger: #ef4444;
```

### Componentes Visuales Clave
- **Avatar**: Círculo con iniciales, color basado en hash del nombre
- **Bill Item Card**: Glassmorphism con blur, muestra qty, nombre, precio
- **Bottom Sheet**: Fijo abajo, expandible, muestra total y desglose
- **Participant Chip**: Avatar + nombre, scroll horizontal

## Problemas Conocidos / Áreas de Mejora

1. **Archivo muy grande**: CollaborativeSession.js tiene 3000+ líneas, difícil de mantener
2. **Estilos inline**: Hay muchos estilos inline mezclados con CSS
3. **Re-renders**: Múltiples useEffects que podrían optimizarse
4. **Mobile first**: Diseñado para móvil, pero podría mejorar en desktop

## Cómo Probar

1. Crear sesión: Enviar foto de boleta al WhatsApp del bot
2. Abrir link de host que llega en la respuesta
3. Probar como editor: Abrir el link de compartir en otra pestaña

---

## Archivos a Compartir con Gemini

Para cambios de **UI/UX**:
- `CollaborativeSession.js` (o las secciones relevantes)
- `CollaborativeSession.css`

Para cambios de **lógica**:
- `CollaborativeSession.js`
- `App.js` (si afecta routing)

Para cambios de **i18n**:
- `i18n/index.js`

**Nota**: CollaborativeSession.js es muy grande. Considera compartir solo las funciones/secciones relevantes al problema específico.
