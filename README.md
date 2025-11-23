# 🤖 Bill-e

Bot inteligente de WhatsApp para dividir cuentas de restaurantes entre amigos.

![Status](https://img.shields.io/badge/status-MVP-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## 🌐 Demo en vivo

- **Frontend**: https://bill-e.vercel.app/s/{session_id}
- **Backend API**: https://bill-e-backend-lfwp.onrender.com
- **Health Check**: https://bill-e-backend-lfwp.onrender.com/health

## 🎯 Características

- ✅ División de cuentas equitativa o por consumo individual
- ✅ Asignación de items a personas específicas
- ✅ Cálculo automático de propina proporcional
- ✅ Interfaz web temporal (expira en 1 hora)
- ✅ Sistema de pricing A/B testing integrado
- ✅ Sesiones seguras con Redis
- 🔜 OCR para escanear boletas automáticamente
- 🔜 Integración WhatsApp para envío de resultados
- 🔜 Monetización: $1.89/año por acceso ilimitado

## 🏗️ Arquitectura
```
┌─────────────┐
│   Usuario   │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│  WhatsApp (próximo) │
└──────┬──────────────┘
       │
       ▼
┌─────────────────┐      ┌──────────────┐
│  Backend API    │◄────►│ Redis/Upstash│
│  (Render)       │      │  (Sesiones)  │
└────────┬────────┘      └──────────────┘
         │
         ▼
┌─────────────────┐
│  Frontend Web   │
│   (Vercel)      │
└─────────────────┘
```

## 🛠️ Stack Tecnológico

### Backend
- **Framework**: FastAPI (Python)
- **Base de datos**: Redis (Upstash)
- **Hosting**: Render (Free tier)
- **Features**:
  - API REST
  - Sistema de sesiones temporales
  - A/B testing de precios
  - Paywall integrado

### Frontend
- **Framework**: React
- **Styling**: Inline styles (sin dependencias CSS)
- **Icons**: Lucide React
- **Hosting**: Vercel
- **Features**:
  - Interfaz responsive
  - Asignación drag-and-click
  - Cálculos en tiempo real
  - Preview antes de enviar

### Infraestructura
- **Versionado**: GitHub
- **CI/CD**: Auto-deploy en push
- **Monitoring**: Render + Vercel dashboards

## 📦 Instalación local

### Prerrequisitos
- Python 3.11+
- Node.js 18+
- Redis (o cuenta Upstash)

### Backend
```bash
cd backend

# Crear entorno virtual
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Instalar dependencias
pip install -r requirements.txt

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# Ejecutar servidor
uvicorn main:app --reload
```

### Frontend
```bash
cd frontend

# Instalar dependencias
npm install

# Configurar variables de entorno
echo "REACT_APP_API_URL=http://localhost:8000" > .env

# Ejecutar desarrollo
npm start
```

## 🔑 Variables de Entorno

### Backend (.env)
```bash
# Redis
REDIS_URL=rediss://default:PASSWORD@host:6379

# WhatsApp (cuando se implemente)
WHATSAPP_TOKEN=your_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_id
WHATSAPP_VERIFY_TOKEN=your_verify_token

# Stripe (cuando se implemente)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# URLs
BASE_URL=https://bill-e.vercel.app
FRONTEND_URL=https://bill-e.vercel.app
```

### Frontend (.env)
```bash
REACT_APP_API_URL=https://bill-e-backend-lfwp.onrender.com
```

## 📡 API Endpoints

### Health Check
```bash
GET /health
```
Respuesta:
```json
{"status": "healthy", "service": "bill-e-backend"}
```

### Obtener Sesión
```bash
GET /api/session/{session_id}
```

### Calcular División
```bash
POST /api/session/{session_id}/calculate
Content-Type: application/json

{
  "total": 35650,
  "subtotal": 31000,
  "tip": 4650,
  "per_person": [...]
}
```

## 🧪 Testing

### Crear sesión de prueba
```bash
cd backend
python test_session.py
```

Esto generará una URL temporal para probar el flujo completo.

## 📊 Modelo de Negocio

### Freemium
- **Gratis**: 1 cuenta dividida
- **Premium**: $1.89/año - cuentas ilimitadas

### A/B Testing de Precios
El sistema prueba automáticamente 4 variantes:
- $0.99/año
- $1.49/año
- $1.89/año (principal)
- $2.49/año

### Métricas clave
- Conversión esperada: 10-20%
- Costo por usuario: $0.02-0.06/mes
- Margen: ~85-95%

## 🚀 Roadmap

### Fase 1: MVP (Actual) ✅
- [x] Backend con API REST
- [x] Frontend con interfaz visual
- [x] Sistema de sesiones temporales
- [x] Cálculo de división de cuentas
- [x] Deploy en producción

### Fase 2: Funcionalidad Completa (1-2 semanas)
- [ ] Integración WhatsApp Cloud API
- [ ] OCR con Google Vision API
- [ ] Parser de boletas con GPT-4o mini
- [ ] Sistema de pagos con Stripe
- [ ] Paywall funcional

### Fase 3: Growth (1-2 meses)
- [ ] Landing page
- [ ] Sistema de referidos
- [ ] Analytics y métricas
- [ ] Optimización de conversión
- [ ] Marketing inicial

### Fase 4: Escala (3-6 meses)
- [ ] Modo grupo en WhatsApp
- [ ] Historial de cuentas
- [ ] Exportación de reportes
- [ ] Integración con apps de delivery
- [ ] Migración a AWS/GCP si necesario

## 💰 Costos de Operación

### Actual (0-10K usuarios)
- Render: $0/mes
- Vercel: $0/mes
- Upstash: $0/mes
- **Total: $0/mes**

### Escalado (10K-100K usuarios)
- Render Pro: $20/mes
- Upstash Pro: $10/mes
- WhatsApp API: $50-200/mes
- **Total: $80-230/mes**

### Escala completa (100K-1M usuarios)
- AWS/GCP: $500-2000/mes
- Necesita migración arquitectónica

## 🤝 Contribuir

Este es un proyecto privado en desarrollo. Contacta al autor para colaboraciones.

## 📄 Licencia

MIT License - Libre para uso personal y comercial.

## 👤 Autor

**Gonzalo (0limpo)**
- GitHub: [@0limpo](https://github.com/0limpo)
- Proyecto: Bill-e - Bot de WhatsApp para dividir cuentas

## 🙏 Agradecimientos

Construido con:
- FastAPI
- React
- Redis (Upstash)
- Render
- Vercel
- Claude (Anthropic) como asistente de desarrollo

---

**Última actualización**: Noviembre 2025  
**Estado**: MVP funcional en producción  
**Próximo milestone**: Integración WhatsApp Cloud API