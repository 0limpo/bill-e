"""
Analytics API endpoints for Bill-e
Real-time metrics, dashboards, and reporting
"""

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import json

from analytics import analytics, AnalyticsEvent

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class FrontendEvent(BaseModel):
    """Frontend analytics event model"""
    event_name: str
    event_params: Dict[str, Any]
    user_agent: Optional[str] = None
    timestamp: Optional[str] = None


@router.post("/event")
async def track_frontend_event(event: FrontendEvent, request: Request):
    """
    Track analytics event from frontend
    """
    try:
        analytics_event = AnalyticsEvent(
            event_type=event.event_name,
            timestamp=event.timestamp or datetime.utcnow().isoformat(),
            session_id=event.event_params.get('session_id'),
            source='web',
            metadata=event.event_params,
            success=True
        )

        analytics.track_event(analytics_event)

        return {"status": "tracked"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to track event: {str(e)}")


@router.get("/metrics")
async def get_metrics(date: Optional[str] = None):
    """
    Get aggregated metrics for a specific date
    Default: today

    Query params:
    - date: YYYYMMDD format (optional)
    """
    try:
        metrics = analytics.get_metrics(date)
        return {
            "date": date or datetime.now().strftime('%Y%m%d'),
            "metrics": metrics
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get metrics: {str(e)}")


@router.get("/realtime")
async def get_realtime_stats():
    """
    Get real-time statistics (last hour)
    """
    try:
        stats = analytics.get_realtime_stats()
        return {
            "timestamp": datetime.utcnow().isoformat(),
            "stats": stats
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get realtime stats: {str(e)}")


@router.get("/dashboard")
async def get_dashboard():
    """
    Get comprehensive dashboard data
    Includes today's metrics, real-time stats, and trends
    """
    try:
        today = datetime.now().strftime('%Y%m%d')
        yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y%m%d')

        # Get metrics for today and yesterday
        metrics_today = analytics.get_metrics(today)
        metrics_yesterday = analytics.get_metrics(yesterday)

        # Get real-time stats
        realtime = analytics.get_realtime_stats()

        # Check for anomalies
        anomalies = analytics.check_anomalies()

        # Calculate trends (today vs yesterday)
        trends = _calculate_trends(metrics_today, metrics_yesterday)

        return {
            "timestamp": datetime.utcnow().isoformat(),
            "metrics": {
                "today": metrics_today,
                "yesterday": metrics_yesterday,
                "trends": trends
            },
            "realtime": realtime,
            "anomalies": anomalies,
            "summary": _generate_summary(metrics_today, realtime, anomalies)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get dashboard: {str(e)}")


@router.get("/anomalies")
async def get_anomalies():
    """
    Check for anomalies and issues that need attention
    """
    try:
        anomalies = analytics.check_anomalies()
        return {
            "timestamp": datetime.utcnow().isoformat(),
            "anomalies": anomalies,
            "count": len(anomalies),
            "critical_count": len([a for a in anomalies if a.get('severity') == 'critical'])
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check anomalies: {str(e)}")


@router.get("/costs")
async def get_costs(period: str = "daily"):
    """
    Get cost breakdown by service

    Query params:
    - period: 'daily', 'weekly', or 'monthly'
    """
    try:
        if not analytics.redis:
            return {"error": "Redis not available"}

        today = datetime.now()

        if period == "daily":
            date_key = today.strftime('%Y%m%d')
            costs = analytics.redis.hgetall(f"costs:daily:{date_key}")

        elif period == "monthly":
            date_key = today.strftime('%Y%m')
            costs = analytics.redis.hgetall(f"costs:monthly:{date_key}")

        elif period == "weekly":
            # Aggregate last 7 days
            costs = {}
            for i in range(7):
                date = (today - timedelta(days=i)).strftime('%Y%m%d')
                daily_costs = analytics.redis.hgetall(f"costs:daily:{date}")
                for service, cost in daily_costs.items():
                    costs[service] = costs.get(service, 0) + float(cost)

        else:
            raise HTTPException(status_code=400, detail="Invalid period. Use 'daily', 'weekly', or 'monthly'")

        # Convert to float and calculate total
        costs_float = {k: float(v) for k, v in costs.items()}
        total = sum(costs_float.values())

        return {
            "period": period,
            "date": today.strftime('%Y-%m-%d'),
            "costs": costs_float,
            "total_usd": total,
            "breakdown": [
                {
                    "service": service,
                    "cost_usd": cost,
                    "percentage": (cost / total * 100) if total > 0 else 0
                }
                for service, cost in costs_float.items()
            ]
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get costs: {str(e)}")


@router.get("/ocr/stats")
async def get_ocr_stats(days: int = 7):
    """
    Get detailed OCR statistics

    Query params:
    - days: Number of days to aggregate (default: 7)
    """
    try:
        if not analytics.redis:
            return {"error": "Redis not available"}

        stats = {
            "period_days": days,
            "total_requests": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "success_rate": 0,
            "avg_processing_time_ms": 0,
            "item_count_distribution": {},
            "confidence_distribution": {},
            "daily_breakdown": []
        }

        processing_times = []

        for i in range(days):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')

            total = int(analytics.redis.get(f"ocr:total:{date}") or 0)
            success = int(analytics.redis.get(f"ocr:success:{date}") or 0)

            stats["total_requests"] += total
            stats["successful_requests"] += success

            # Get processing times
            times = analytics.redis.zrange(f"ocr:processing_times:{date}", 0, -1, withscores=True)
            processing_times.extend([score for _, score in times])

            # Daily breakdown
            stats["daily_breakdown"].append({
                "date": date,
                "total": total,
                "success": success,
                "success_rate": (success / total * 100) if total > 0 else 0
            })

        stats["failed_requests"] = stats["total_requests"] - stats["successful_requests"]
        stats["success_rate"] = (
            stats["successful_requests"] / stats["total_requests"] * 100
            if stats["total_requests"] > 0 else 0
        )

        # Calculate average processing time
        if processing_times:
            stats["avg_processing_time_ms"] = sum(processing_times) / len(processing_times)
            stats["min_processing_time_ms"] = min(processing_times)
            stats["max_processing_time_ms"] = max(processing_times)

            # Calculate percentiles
            sorted_times = sorted(processing_times)
            stats["p50_processing_time_ms"] = sorted_times[len(sorted_times) // 2]
            stats["p95_processing_time_ms"] = sorted_times[int(len(sorted_times) * 0.95)]
            stats["p99_processing_time_ms"] = sorted_times[int(len(sorted_times) * 0.99)]

        return stats

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get OCR stats: {str(e)}")


@router.get("/whatsapp/stats")
async def get_whatsapp_stats(days: int = 7):
    """
    Get WhatsApp usage statistics

    Query params:
    - days: Number of days to aggregate (default: 7)
    """
    try:
        if not analytics.redis:
            return {"error": "Redis not available"}

        stats = {
            "period_days": days,
            "total_inbound": 0,
            "total_outbound": 0,
            "unique_users": set(),
            "message_types": {},
            "daily_breakdown": []
        }

        for i in range(days):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')

            inbound = int(analytics.redis.get(f"whatsapp:inbound:{date}") or 0)
            outbound = int(analytics.redis.get(f"whatsapp:outbound:{date}") or 0)
            users = analytics.redis.smembers(f"whatsapp:unique_users:{date}")
            types = analytics.redis.hgetall(f"whatsapp:types:{date}")

            stats["total_inbound"] += inbound
            stats["total_outbound"] += outbound
            stats["unique_users"].update(users)

            # Aggregate message types
            for msg_type, count in types.items():
                stats["message_types"][msg_type] = stats["message_types"].get(msg_type, 0) + int(count)

            stats["daily_breakdown"].append({
                "date": date,
                "inbound": inbound,
                "outbound": outbound,
                "unique_users": len(users)
            })

        # Convert set to count
        stats["unique_users_count"] = len(stats["unique_users"])
        del stats["unique_users"]  # Remove set (not JSON serializable)

        return stats

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get WhatsApp stats: {str(e)}")


def _calculate_trends(today: Dict[str, Any], yesterday: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate trend percentages (today vs yesterday)"""
    trends = {}

    try:
        # OCR trend
        ocr_today = today.get('ocr', {}).get('total', 0)
        ocr_yesterday = yesterday.get('ocr', {}).get('total', 0)
        trends['ocr_usage'] = _calc_percent_change(ocr_today, ocr_yesterday)

        # Success rate trend
        success_today = today.get('ocr', {}).get('success_rate', 0)
        success_yesterday = yesterday.get('ocr', {}).get('success_rate', 0)
        trends['ocr_success_rate'] = success_today - success_yesterday  # Absolute change

        # WhatsApp trend
        wa_today = today.get('whatsapp', {}).get('inbound', 0)
        wa_yesterday = yesterday.get('whatsapp', {}).get('inbound', 0)
        trends['whatsapp_messages'] = _calc_percent_change(wa_today, wa_yesterday)

        # Cost trend
        cost_today = today.get('costs', {}).get('total', 0)
        cost_yesterday = yesterday.get('costs', {}).get('total', 0)
        trends['daily_cost'] = _calc_percent_change(cost_today, cost_yesterday)

    except Exception as e:
        analytics.logger.error(f"Failed to calculate trends: {e}")

    return trends


def _calc_percent_change(current: float, previous: float) -> float:
    """Calculate percentage change"""
    if previous == 0:
        return 100 if current > 0 else 0
    return ((current - previous) / previous) * 100


def _generate_summary(metrics: Dict[str, Any], realtime: Dict[str, Any], anomalies: List[Dict]) -> Dict[str, Any]:
    """Generate dashboard summary"""
    return {
        "ocr_requests_today": metrics.get('ocr', {}).get('total', 0),
        "ocr_success_rate": metrics.get('ocr', {}).get('success_rate', 0),
        "whatsapp_messages_today": metrics.get('whatsapp', {}).get('inbound', 0) + metrics.get('whatsapp', {}).get('outbound', 0),
        "unique_users_today": metrics.get('whatsapp', {}).get('unique_users', 0),
        "total_cost_today_usd": metrics.get('costs', {}).get('total', 0),
        "errors_last_hour": realtime.get('errors_last_hour', 0),
        "active_anomalies": len(anomalies),
        "status": "critical" if len([a for a in anomalies if a.get('severity') == 'critical']) > 0 else "healthy"
    }
