"""
Bill-e Backend Analytics System
Structured logging, metrics tracking, cost analysis, and performance monitoring
"""

import json
import time
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
import redis
import os
from dataclasses import dataclass, asdict
from enum import Enum
import logging

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('bill-e-analytics')

# Redis client for analytics storage
try:
    redis_client = redis.from_url(
        os.getenv("REDIS_URL"),
        decode_responses=True,
        ssl_cert_reqs=None
    )
except Exception as e:
    logger.warning(f"Redis not available for analytics: {e}")
    redis_client = None


class EventType(Enum):
    """Analytics event types"""
    SESSION_CREATED = "session_created"
    SESSION_LOADED = "session_loaded"
    OCR_STARTED = "ocr_started"
    OCR_COMPLETED = "ocr_completed"
    OCR_FAILED = "ocr_failed"
    WEBHOOK_RECEIVED = "webhook_received"
    MESSAGE_SENT = "message_sent"
    API_CALL = "api_call"
    ERROR = "error"
    PERFORMANCE = "performance"
    COST = "cost"


@dataclass
class AnalyticsEvent:
    """Structured analytics event"""
    event_type: str
    timestamp: str
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    source: Optional[str] = None  # 'web', 'whatsapp'
    metadata: Optional[Dict[str, Any]] = None
    duration_ms: Optional[float] = None
    success: bool = True
    error_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for storage"""
        return {k: v for k, v in asdict(self).items() if v is not None}

    def to_json(self) -> str:
        """Convert to JSON string"""
        return json.dumps(self.to_dict())


class Analytics:
    """Main analytics class for tracking and reporting"""

    def __init__(self):
        self.redis = redis_client
        self.logger = logger

    def track_event(self, event: AnalyticsEvent):
        """Track an analytics event"""
        try:
            # Log event
            self.logger.info(f"📊 {event.event_type}: {event.to_json()}")

            # Store in Redis for aggregation
            if self.redis:
                # Store in time-series list
                key = f"analytics:events:{datetime.now().strftime('%Y%m%d')}"
                self.redis.lpush(key, event.to_json())
                self.redis.expire(key, 86400 * 30)  # Keep for 30 days

                # Update counters
                self._update_counters(event)

        except Exception as e:
            self.logger.error(f"Failed to track event: {e}")

    def _update_counters(self, event: AnalyticsEvent):
        """Update real-time counters"""
        if not self.redis:
            return

        try:
            # Daily counter
            daily_key = f"analytics:count:{event.event_type}:{datetime.now().strftime('%Y%m%d')}"
            self.redis.incr(daily_key)
            self.redis.expire(daily_key, 86400 * 7)  # Keep for 7 days

            # Hourly counter (for real-time dashboard)
            hourly_key = f"analytics:count:{event.event_type}:{datetime.now().strftime('%Y%m%d%H')}"
            self.redis.incr(hourly_key)
            self.redis.expire(hourly_key, 86400)  # Keep for 1 day

        except Exception as e:
            self.logger.error(f"Failed to update counters: {e}")

    def track_ocr_usage(
        self,
        session_id: str,
        success: bool,
        processing_time_ms: float,
        item_count: int = 0,
        confidence: str = 'unknown',
        image_size_bytes: int = 0,
        error: Optional[str] = None
    ):
        """Track OCR usage and performance"""
        event = AnalyticsEvent(
            event_type=EventType.OCR_COMPLETED.value if success else EventType.OCR_FAILED.value,
            timestamp=datetime.utcnow().isoformat(),
            session_id=session_id,
            source='whatsapp' if session_id else 'web',
            metadata={
                'item_count': item_count,
                'confidence': confidence,
                'image_size_bytes': image_size_bytes,
                'processing_time_ms': processing_time_ms
            },
            duration_ms=processing_time_ms,
            success=success,
            error_message=error
        )

        self.track_event(event)

        # Update OCR metrics
        self._update_ocr_metrics(success, processing_time_ms, item_count, confidence)

    def _update_ocr_metrics(
        self,
        success: bool,
        processing_time_ms: float,
        item_count: int,
        confidence: str
    ):
        """Update OCR-specific metrics"""
        if not self.redis:
            return

        try:
            today = datetime.now().strftime('%Y%m%d')

            # Success rate
            self.redis.incr(f"ocr:total:{today}")
            if success:
                self.redis.incr(f"ocr:success:{today}")

            # Average processing time (using sorted set for percentiles)
            self.redis.zadd(
                f"ocr:processing_times:{today}",
                {str(time.time()): processing_time_ms}
            )

            # Item count distribution
            if success and item_count > 0:
                self.redis.hincrby(f"ocr:item_counts:{today}", str(item_count), 1)

            # Confidence distribution
            self.redis.hincrby(f"ocr:confidence:{today}", confidence, 1)

            # Set expiration
            for key in [
                f"ocr:total:{today}",
                f"ocr:success:{today}",
                f"ocr:processing_times:{today}",
                f"ocr:item_counts:{today}",
                f"ocr:confidence:{today}"
            ]:
                self.redis.expire(key, 86400 * 7)

        except Exception as e:
            self.logger.error(f"Failed to update OCR metrics: {e}")

    def track_api_call(
        self,
        endpoint: str,
        method: str,
        status_code: int,
        duration_ms: float,
        user_agent: Optional[str] = None
    ):
        """Track API call metrics"""
        event = AnalyticsEvent(
            event_type=EventType.API_CALL.value,
            timestamp=datetime.utcnow().isoformat(),
            metadata={
                'endpoint': endpoint,
                'method': method,
                'status_code': status_code,
                'user_agent': user_agent
            },
            duration_ms=duration_ms,
            success=200 <= status_code < 400
        )

        self.track_event(event)

        # Track error rate
        if status_code >= 400:
            self._track_error_rate(endpoint, status_code)

    def _track_error_rate(self, endpoint: str, status_code: int):
        """Track API error rates"""
        if not self.redis:
            return

        try:
            today = datetime.now().strftime('%Y%m%d')
            hour = datetime.now().strftime('%Y%m%d%H')

            # Error counter by endpoint
            self.redis.incr(f"api:errors:{endpoint}:{today}")
            self.redis.incr(f"api:errors:total:{today}")

            # Error counter by hour (for alerting)
            self.redis.incr(f"api:errors:hourly:{hour}")
            self.redis.expire(f"api:errors:hourly:{hour}", 86400)

            # Error by status code
            self.redis.hincrby(f"api:status_codes:{today}", str(status_code), 1)

        except Exception as e:
            self.logger.error(f"Failed to track error rate: {e}")

    def track_cost(
        self,
        service: str,  # 'google_vision', 'whatsapp', 'redis'
        operation: str,
        cost_usd: float,
        units: int = 1
    ):
        """Track service costs"""
        event = AnalyticsEvent(
            event_type=EventType.COST.value,
            timestamp=datetime.utcnow().isoformat(),
            metadata={
                'service': service,
                'operation': operation,
                'cost_usd': cost_usd,
                'units': units
            },
            success=True
        )

        self.track_event(event)

        # Update cost counters
        if self.redis:
            try:
                today = datetime.now().strftime('%Y%m%d')
                month = datetime.now().strftime('%Y%m')

                # Daily cost by service
                self.redis.hincrbyfloat(f"costs:daily:{today}", service, cost_usd)

                # Monthly cost by service
                self.redis.hincrbyfloat(f"costs:monthly:{month}", service, cost_usd)

                # Set expiration
                self.redis.expire(f"costs:daily:{today}", 86400 * 30)
                self.redis.expire(f"costs:monthly:{month}", 86400 * 365)

            except Exception as e:
                self.logger.error(f"Failed to track cost: {e}")

    def track_whatsapp_message(
        self,
        phone_number: str,
        direction: str,  # 'inbound' or 'outbound'
        message_type: str,  # 'text', 'image', etc.
        success: bool = True,
        error: Optional[str] = None
    ):
        """Track WhatsApp messages"""
        event = AnalyticsEvent(
            event_type=EventType.MESSAGE_SENT.value if direction == 'outbound' else EventType.WEBHOOK_RECEIVED.value,
            timestamp=datetime.utcnow().isoformat(),
            user_id=phone_number,
            source='whatsapp',
            metadata={
                'direction': direction,
                'message_type': message_type
            },
            success=success,
            error_message=error
        )

        self.track_event(event)

        # Track WhatsApp usage
        if self.redis:
            try:
                today = datetime.now().strftime('%Y%m%d')

                # Message count by direction
                self.redis.incr(f"whatsapp:{direction}:{today}")

                # Message count by type
                self.redis.hincrby(f"whatsapp:types:{today}", message_type, 1)

                # Unique users (phone numbers)
                self.redis.sadd(f"whatsapp:unique_users:{today}", phone_number)

                # Set expiration
                for key in [
                    f"whatsapp:{direction}:{today}",
                    f"whatsapp:types:{today}",
                    f"whatsapp:unique_users:{today}"
                ]:
                    self.redis.expire(key, 86400 * 7)

            except Exception as e:
                self.logger.error(f"Failed to track WhatsApp message: {e}")

    def get_metrics(self, date: Optional[str] = None) -> Dict[str, Any]:
        """Get aggregated metrics for a specific date"""
        if not self.redis:
            return {}

        if date is None:
            date = datetime.now().strftime('%Y%m%d')

        try:
            metrics = {}

            # OCR metrics
            ocr_total = int(self.redis.get(f"ocr:total:{date}") or 0)
            ocr_success = int(self.redis.get(f"ocr:success:{date}") or 0)
            metrics['ocr'] = {
                'total': ocr_total,
                'success': ocr_success,
                'success_rate': (ocr_success / ocr_total * 100) if ocr_total > 0 else 0,
                'item_counts': self.redis.hgetall(f"ocr:item_counts:{date}"),
                'confidence_distribution': self.redis.hgetall(f"ocr:confidence:{date}")
            }

            # API metrics
            api_errors = int(self.redis.get(f"api:errors:total:{date}") or 0)
            status_codes = self.redis.hgetall(f"api:status_codes:{date}")
            metrics['api'] = {
                'total_errors': api_errors,
                'status_codes': status_codes
            }

            # WhatsApp metrics
            whatsapp_inbound = int(self.redis.get(f"whatsapp:inbound:{date}") or 0)
            whatsapp_outbound = int(self.redis.get(f"whatsapp:outbound:{date}") or 0)
            unique_users = self.redis.scard(f"whatsapp:unique_users:{date}")
            metrics['whatsapp'] = {
                'inbound': whatsapp_inbound,
                'outbound': whatsapp_outbound,
                'unique_users': unique_users,
                'message_types': self.redis.hgetall(f"whatsapp:types:{date}")
            }

            # Cost metrics
            daily_costs = self.redis.hgetall(f"costs:daily:{date}")
            metrics['costs'] = {
                'total': sum(float(v) for v in daily_costs.values()),
                'by_service': daily_costs
            }

            return metrics

        except Exception as e:
            self.logger.error(f"Failed to get metrics: {e}")
            return {}

    def get_realtime_stats(self) -> Dict[str, Any]:
        """Get real-time statistics (last hour)"""
        if not self.redis:
            return {}

        try:
            current_hour = datetime.now().strftime('%Y%m%d%H')

            stats = {}

            # Event counts for current hour
            for event_type in EventType:
                count = int(self.redis.get(f"analytics:count:{event_type.value}:{current_hour}") or 0)
                stats[event_type.value] = count

            # Errors in last hour
            errors = int(self.redis.get(f"api:errors:hourly:{current_hour}") or 0)
            stats['errors_last_hour'] = errors

            # Alert if error rate is high
            if errors > 10:  # Threshold: 10 errors per hour
                stats['alert'] = 'high_error_rate'

            return stats

        except Exception as e:
            self.logger.error(f"Failed to get realtime stats: {e}")
            return {}

    def check_anomalies(self) -> List[Dict[str, Any]]:
        """Check for anomalies that should trigger alerts"""
        anomalies = []

        try:
            current_hour = datetime.now().strftime('%Y%m%d%H')
            today = datetime.now().strftime('%Y%m%d')

            if not self.redis:
                return anomalies

            # Check error rate
            errors = int(self.redis.get(f"api:errors:hourly:{current_hour}") or 0)
            if errors > 10:
                anomalies.append({
                    'type': 'high_error_rate',
                    'severity': 'critical',
                    'message': f'High error rate detected: {errors} errors in last hour',
                    'value': errors,
                    'threshold': 10
                })

            # Check OCR success rate
            ocr_total = int(self.redis.get(f"ocr:total:{today}") or 0)
            ocr_success = int(self.redis.get(f"ocr:success:{today}") or 0)
            if ocr_total > 10:  # Only check if we have enough data
                success_rate = (ocr_success / ocr_total * 100) if ocr_total > 0 else 0
                if success_rate < 70:  # Alert if success rate < 70%
                    anomalies.append({
                        'type': 'low_ocr_success_rate',
                        'severity': 'warning',
                        'message': f'OCR success rate below threshold: {success_rate:.1f}%',
                        'value': success_rate,
                        'threshold': 70
                    })

            # Check daily costs
            daily_costs = self.redis.hgetall(f"costs:daily:{today}")
            total_cost = sum(float(v) for v in daily_costs.values())
            if total_cost > 10:  # Alert if daily cost > $10
                anomalies.append({
                    'type': 'high_daily_cost',
                    'severity': 'warning',
                    'message': f'Daily cost exceeds threshold: ${total_cost:.2f}',
                    'value': total_cost,
                    'threshold': 10
                })

            return anomalies

        except Exception as e:
            self.logger.error(f"Failed to check anomalies: {e}")
            return []


# Global analytics instance
analytics = Analytics()


# Decorator for tracking function performance
def track_performance(event_type: str):
    """Decorator to track function performance"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            start_time = time.time()
            success = True
            error = None

            try:
                result = func(*args, **kwargs)
                return result
            except Exception as e:
                success = False
                error = str(e)
                raise
            finally:
                duration_ms = (time.time() - start_time) * 1000

                event = AnalyticsEvent(
                    event_type=event_type,
                    timestamp=datetime.utcnow().isoformat(),
                    duration_ms=duration_ms,
                    success=success,
                    error_message=error
                )

                analytics.track_event(event)

        return wrapper
    return decorator
