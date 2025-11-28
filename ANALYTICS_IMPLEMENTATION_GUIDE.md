# 📊 Bill-e Analytics - Complete Implementation Guide

**Version:** 1.0
**Last Updated:** 2025-11-27
**Status:** Ready for Implementation

---

## 🎯 Overview

This guide covers the complete analytics implementation for Bill-e, including:

- **Frontend**: Google Analytics 4 + custom event tracking
- **Backend**: Structured logging, metrics, cost tracking
- **Dashboard**: Real-time metrics and reports
- **Alerting**: Automated anomaly detection and notifications

---

## 📦 What's Been Created

### Frontend (`frontend/src/`)
- `analytics.js` - Google Analytics 4 integration + event tracking
- `App.analytics-integration.js` - Integration guide for App.js

### Backend (`backend/`)
- `analytics.py` - Core analytics engine
- `analytics_routes.py` - API endpoints for metrics
- `analytics_middleware.py` - Automatic request tracking
- `alerting.py` - Alert management system

---

## 🚀 PHASE 1: Frontend Integration

### Step 1.1: Install Google Analytics 4

1. Create Google Analytics 4 property:
   - Go to: https://analytics.google.com/
   - Create new GA4 property
   - Get Measurement ID (format: `G-XXXXXXXXXX`)

2. Add to frontend environment:
   ```bash
   # frontend/.env
   REACT_APP_GA_MEASUREMENT_ID=G-XXXXXXXXXX
   REACT_APP_API_URL=https://bill-e-backend-lfwp.onrender.com
   ```

### Step 1.2: Update index.js

```javascript
// frontend/src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { initGA } from './analytics';

// Initialize Google Analytics
initGA();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### Step 1.3: Integrate into App.js

Add these tracking calls to your existing App.js:

```javascript
// Add import at top
import {
  trackPageView,
  trackSessionLoad,
  trackPersonAdded,
  trackItemAssignment,
  trackCalculationComplete,
  trackShare,
  trackTipChange,
  trackError,
  trackFunnelStep
} from './analytics';

// In SessionPage component
function SessionPage() {
  const { id } = useParams();

  // Track page view
  useEffect(() => {
    if (id) {
      trackPageView(`/s/${id}`, `Session ${id}`);
    }
  }, [id]);

  // In loadSessionData - after successful load
  const loadSessionData = async (sessionId) => {
    try {
      // ... existing code ...
      const data = await response.json();
      setSessionData(data);

      // ✅ ADD THIS
      trackSessionLoad(
        sessionId,
        data.items?.length || 0,
        data.total || 0,
        data.phone_number ? 'whatsapp' : 'web'
      );

    } catch (error) {
      // ✅ ADD THIS
      trackError('session_load_failed', error.message, sessionId);
      setError(error.message);
    }
  };

  // In addPerson - after adding
  const addPerson = () => {
    if (newPersonName.trim()) {
      const newPeople = [...people, { name: newPersonName.trim(), amount: 0 }];
      setPeople(newPeople);

      // ✅ ADD THIS
      trackPersonAdded(id, newPeople.length);
      trackFunnelStep('person_added', id, { person_count: newPeople.length });
    }
  };

  // In toggleItemAssignment
  const toggleItemAssignment = (itemName, personName) => {
    // ... existing logic ...

    // ✅ ADD THIS
    if (!isAssigned) {
      trackItemAssignment(id, itemName, personName);
    }
  };

  // Add share button
  const handleShareClick = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      alert('Link copiado!');

      // ✅ ADD THIS
      trackShare(id, 'copy_link');
      trackFunnelStep('share_initiated', id);
    } catch (error) {
      trackError('share_failed', error.message, id);
    }
  };

  // Track engagement time on unmount
  useEffect(() => {
    const startTime = Date.now();
    return () => {
      const timeSpent = Math.floor((Date.now() - startTime) / 1000);
      if (timeSpent > 5) {
        trackEngagement(id, timeSpent);
      }
    };
  }, [id]);

  // ... rest of component
}
```

### Step 1.4: Add Share Button to UI

```javascript
// In your JSX, add a share button
<button
  onClick={handleShareClick}
  className="share-button"
>
  📤 Compartir
</button>
```

---

## 🔧 PHASE 2: Backend Integration

### Step 2.1: Install Dependencies

```bash
cd backend
pip install redis httpx python-dotenv
```

Update `requirements.txt`:
```txt
# Add these if not present
redis>=4.5.0
httpx>=0.24.0
python-dotenv>=1.0.0
```

### Step 2.2: Update main.py

```python
# backend/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import asyncio

# ✅ ADD THESE IMPORTS
from analytics_routes import router as analytics_router
from analytics_middleware import AnalyticsMiddleware
from alerting import init_alerting, periodic_anomaly_check

# ... existing imports ...

app = FastAPI(title="Bill-e API", version="1.0.0")

# ✅ ADD ANALYTICS MIDDLEWARE (before CORS)
app.add_middleware(AnalyticsMiddleware)

# CORS (existing)
app.add_middleware(CORSMiddleware, ...)

# ✅ INCLUDE ANALYTICS ROUTER
app.include_router(analytics_router)

# ✅ INITIALIZE ALERTING ON STARTUP
@app.on_event("startup")
async def startup_event():
    # Initialize alerting
    init_alerting()

    # Start background anomaly checking (optional)
    # asyncio.create_task(periodic_anomaly_check())

    print("✅ Analytics and alerting initialized")

# ... rest of your code ...
```

### Step 2.3: Update OCR Service

```python
# backend/ocr_service.py

import time
from analytics import analytics

class OCRService:
    def process_image(self, image_data: bytes) -> str:
        """Process image with analytics tracking"""

        start_time = time.time()
        session_id = None  # Get from context if available
        success = False
        item_count = 0
        error = None

        try:
            # ... existing OCR code ...

            # If successful
            result = texts[0].description if texts else ""
            success = True

            return result

        except Exception as e:
            error = str(e)
            raise

        finally:
            # ✅ TRACK OCR USAGE
            processing_time = (time.time() - start_time) * 1000

            analytics.track_ocr_usage(
                session_id=session_id,
                success=success,
                processing_time_ms=processing_time,
                item_count=item_count,
                confidence='unknown',
                image_size_bytes=len(image_data),
                error=error
            )

            # ✅ TRACK COST (Google Vision pricing: $1.50 per 1000 images)
            if success:
                analytics.track_cost(
                    service='google_vision',
                    operation='text_detection',
                    cost_usd=0.0015,  # $1.50 / 1000
                    units=1
                )
```

### Step 2.4: Update WhatsApp Webhook

```python
# backend/webhook_whatsapp.py

from analytics import analytics

async def handle_webhook(request: Request):
    """Handle WhatsApp messages with analytics"""

    try:
        body = await request.json()

        # Extract phone number
        phone_number = messages[0]["from"]

        # ✅ TRACK INBOUND MESSAGE
        analytics.track_whatsapp_message(
            phone_number=phone_number,
            direction='inbound',
            message_type=message_data.get("type", "unknown"),
            success=True
        )

        # Process message...

        return {"status": "ok"}

    except Exception as e:
        # ✅ TRACK ERROR
        analytics.track_whatsapp_message(
            phone_number='unknown',
            direction='inbound',
            message_type='unknown',
            success=False,
            error=str(e)
        )

async def send_whatsapp_message(phone_number: str, message: str):
    """Send WhatsApp message with analytics"""

    try:
        # ... existing send logic ...

        # ✅ TRACK OUTBOUND MESSAGE
        analytics.track_whatsapp_message(
            phone_number=phone_number,
            direction='outbound',
            message_type='text',
            success=True
        )

        # ✅ TRACK COST (WhatsApp pricing: ~$0.005 per message)
        analytics.track_cost(
            service='whatsapp',
            operation='send_message',
            cost_usd=0.005,
            units=1
        )

    except Exception as e:
        analytics.track_whatsapp_message(
            phone_number=phone_number,
            direction='outbound',
            message_type='text',
            success=False,
            error=str(e)
        )
```

### Step 2.5: Environment Variables (Render)

Add to Render environment variables:

```bash
# Optional: Slack alerts
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Optional: Custom webhook alerts
ALERT_WEBHOOK_URL=https://your-webhook-url.com/alerts
ALERT_WEBHOOK_AUTH_HEADER=Bearer your-token-here
```

---

## 📊 PHASE 3: Dashboard & Metrics

### Available Endpoints

Once integrated, these endpoints will be available:

#### GET /api/analytics/dashboard
**Complete dashboard with all metrics**

```bash
curl https://bill-e-backend-lfwp.onrender.com/api/analytics/dashboard
```

Response:
```json
{
  "timestamp": "2025-11-27T...",
  "metrics": {
    "today": {
      "ocr": {
        "total": 150,
        "success": 142,
        "success_rate": 94.67
      },
      "whatsapp": {
        "inbound": 150,
        "outbound": 300,
        "unique_users": 45
      },
      "costs": {
        "total": 1.75,
        "by_service": {
          "google_vision": 0.225,
          "whatsapp": 1.50,
          "redis": 0.025
        }
      }
    },
    "trends": {
      "ocr_usage": 15.5,
      "whatsapp_messages": 22.3,
      "daily_cost": -5.2
    }
  },
  "realtime": {
    "session_created": 5,
    "ocr_completed": 4,
    "errors_last_hour": 0
  },
  "anomalies": [],
  "summary": {
    "ocr_requests_today": 150,
    "ocr_success_rate": 94.67,
    "whatsapp_messages_today": 450,
    "unique_users_today": 45,
    "total_cost_today_usd": 1.75,
    "errors_last_hour": 0,
    "active_anomalies": 0,
    "status": "healthy"
  }
}
```

#### GET /api/analytics/metrics?date=YYYYMMDD
**Metrics for specific date**

#### GET /api/analytics/realtime
**Real-time stats (last hour)**

#### GET /api/analytics/ocr/stats?days=7
**Detailed OCR statistics**

```json
{
  "period_days": 7,
  "total_requests": 1050,
  "successful_requests": 994,
  "success_rate": 94.67,
  "avg_processing_time_ms": 1234.5,
  "p50_processing_time_ms": 1100,
  "p95_processing_time_ms": 2500,
  "p99_processing_time_ms": 3200
}
```

#### GET /api/analytics/whatsapp/stats?days=7
**WhatsApp usage statistics**

#### GET /api/analytics/costs?period=daily
**Cost breakdown**

Period: `daily`, `weekly`, or `monthly`

```json
{
  "period": "daily",
  "costs": {
    "google_vision": 0.225,
    "whatsapp": 1.50,
    "redis": 0.025
  },
  "total_usd": 1.75,
  "breakdown": [
    {
      "service": "whatsapp",
      "cost_usd": 1.50,
      "percentage": 85.7
    },
    {
      "service": "google_vision",
      "cost_usd": 0.225,
      "percentage": 12.9
    }
  ]
}
```

#### GET /api/analytics/anomalies
**Check for issues**

```json
{
  "anomalies": [
    {
      "type": "high_error_rate",
      "severity": "critical",
      "message": "High error rate detected: 15 errors in last hour",
      "value": 15,
      "threshold": 10
    }
  ],
  "count": 1,
  "critical_count": 1
}
```

---

## 🚨 PHASE 4: Alerting

### Step 4.1: Configure Slack Alerts

1. Create Slack webhook:
   - Go to: https://api.slack.com/messaging/webhooks
   - Create incoming webhook
   - Copy webhook URL

2. Add to Render:
   ```
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
   ```

3. Alerts will be sent automatically when:
   - Error rate > 10/hour
   - OCR success rate < 70%
   - Daily cost > $10
   - Custom thresholds exceeded

### Step 4.2: Custom Alert Rules

Edit `backend/analytics.py` - method `check_anomalies()`:

```python
# Add custom alert
if whatsapp_messages > 1000:  # Example: high volume alert
    anomalies.append({
        'type': 'high_whatsapp_volume',
        'severity': 'info',
        'message': f'High message volume: {whatsapp_messages} messages today',
        'value': whatsapp_messages,
        'threshold': 1000
    })
```

---

## 📈 PHASE 5: Creating Dashboards

### Option A: Grafana (Recommended)

1. **Install Grafana**: https://grafana.com/
2. **Configure Redis datasource**
3. **Import dashboard template** (create JSON from metrics)

### Option B: Custom React Dashboard

```javascript
// frontend/src/Dashboard.js
import React, { useState, useEffect } from 'react';

function Dashboard() {
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      const response = await fetch(
        'https://bill-e-backend-lfwp.onrender.com/api/analytics/dashboard'
      );
      const data = await response.json();
      setMetrics(data);
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000); // Refresh every minute

    return () => clearInterval(interval);
  }, []);

  if (!metrics) return <div>Loading...</div>;

  return (
    <div className="dashboard">
      <h1>Bill-e Analytics Dashboard</h1>

      <div className="summary-cards">
        <div className="card">
          <h3>OCR Requests</h3>
          <p className="big-number">{metrics.summary.ocr_requests_today}</p>
          <small>Success rate: {metrics.summary.ocr_success_rate.toFixed(1)}%</small>
        </div>

        <div className="card">
          <h3>WhatsApp Messages</h3>
          <p className="big-number">{metrics.summary.whatsapp_messages_today}</p>
          <small>Unique users: {metrics.summary.unique_users_today}</small>
        </div>

        <div className="card">
          <h3>Daily Cost</h3>
          <p className="big-number">${metrics.summary.total_cost_today_usd.toFixed(2)}</p>
          <small>Status: {metrics.summary.status}</small>
        </div>

        <div className="card">
          <h3>Errors</h3>
          <p className="big-number">{metrics.summary.errors_last_hour}</p>
          <small>Last hour</small>
        </div>
      </div>

      {metrics.anomalies.length > 0 && (
        <div className="anomalies">
          <h2>⚠️ Active Anomalies</h2>
          {metrics.anomalies.map((anomaly, i) => (
            <div key={i} className={`anomaly ${anomaly.severity}`}>
              <strong>{anomaly.type}</strong>: {anomaly.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Option C: Google Data Studio

1. Export metrics to Google Sheets using Apps Script
2. Connect Data Studio to sheets
3. Create visualizations

---

## 🎯 Key Metrics to Monitor

### Product Metrics
- **Session Creation Rate**: Sessions created per day
- **OCR Usage**: Images processed per day
- **OCR Success Rate**: % of successful OCR attempts
- **Conversion Funnel**:
  1. Session loaded
  2. Person added
  3. Items assigned
  4. Calculation viewed
  5. Share initiated

### Performance Metrics
- **OCR Processing Time**: p50, p95, p99
- **API Response Time**: Average, max
- **Error Rate**: Errors per hour/day

### Business Metrics
- **Daily Active Users**: Unique WhatsApp users
- **Messages per User**: Average engagement
- **Cost per Session**: Total cost / sessions
- **Revenue Potential**: Based on user growth

### Technical Metrics
- **Uptime**: % of time service is available
- **Error Distribution**: By endpoint, by type
- **Resource Usage**: Memory, CPU (from Render dashboard)

---

## 🔍 Monitoring Best Practices

### Daily Checks
- [ ] Review dashboard summary
- [ ] Check for anomalies
- [ ] Verify OCR success rate > 85%
- [ ] Ensure error rate < 1%

### Weekly Reviews
- [ ] Analyze conversion funnel
- [ ] Review cost trends
- [ ] Check user growth
- [ ] Identify optimization opportunities

### Monthly Analysis
- [ ] Cost optimization review
- [ ] Feature usage analysis
- [ ] Performance improvements
- [ ] User behavior insights

---

## 💰 Cost Estimation

Based on analytics data, you can project costs:

```python
# Example calculation
daily_ocr_requests = 150
daily_whatsapp_messages = 300
daily_users = 50

# Costs
ocr_cost = daily_ocr_requests * 0.0015  # $0.225
whatsapp_cost = daily_whatsapp_messages * 0.005  # $1.50
redis_cost = 0.33  # Upstash free tier or $10/month = $0.33/day

daily_cost = ocr_cost + whatsapp_cost + redis_cost  # $2.055
monthly_cost = daily_cost * 30  # $61.65
```

**Track in dashboard to optimize pricing!**

---

## 🚀 Launch Checklist

Before going live:

- [ ] Frontend analytics integrated (GA4 + custom events)
- [ ] Backend analytics tracking all endpoints
- [ ] OCR metrics tracking implemented
- [ ] Cost tracking for all services
- [ ] Slack alerts configured
- [ ] Dashboard accessible
- [ ] Tested with sample data
- [ ] Anomaly detection working
- [ ] Documentation reviewed
- [ ] Team trained on dashboard

---

## 📚 Additional Resources

**Google Analytics 4:**
- Documentation: https://developers.google.com/analytics/devguides/collection/ga4
- Event tracking: https://developers.google.com/analytics/devguides/collection/ga4/events

**Redis for Analytics:**
- Time series: https://redis.io/docs/data-types/timeseries/
- Sorted sets: https://redis.io/docs/data-types/sorted-sets/

**Grafana Dashboards:**
- Getting started: https://grafana.com/docs/grafana/latest/getting-started/
- Redis datasource: https://grafana.com/grafana/plugins/redis-datasource/

---

## 🤝 Support

Questions or issues:
- Review code comments in analytics modules
- Check Render logs for errors
- Test endpoints with curl/Postman
- Monitor Redis for data storage

---

**Next Steps:**
1. Integrate frontend analytics (30 min)
2. Integrate backend analytics (1 hour)
3. Test with sample data (30 min)
4. Configure alerts (15 min)
5. Create dashboard (1 hour)
6. **GO LIVE!** 🚀
