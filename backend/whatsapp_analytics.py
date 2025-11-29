"""
WhatsApp Analytics Module for Bill-e
Complete customer journey tracking from photo to bill completion

CRITICAL FLOW:
User sends photo → WhatsApp bot → OCR → Link sent → User clicks → Web app → Completion

This module tracks:
- Message delivery & read rates
- Photo-to-link conversion
- Link-to-completion funnel
- Response time distribution
- User retention patterns
- Viral coefficient (sharing)
- Cost per successful division
"""

import os
import json
import time
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
import redis
from dataclasses import dataclass, asdict
import logging

logger = logging.getLogger('whatsapp-analytics')

# Redis client
try:
    redis_client = redis.from_url(
        os.getenv("REDIS_URL"),
        decode_responses=True,
        ssl_cert_reqs=None
    )
except Exception as e:
    logger.warning(f"Redis not available: {e}")
    redis_client = None


@dataclass
class WhatsAppJourney:
    """Track complete user journey through WhatsApp"""
    phone_number: str
    timestamp: str

    # Journey steps
    photo_received: bool = False
    photo_timestamp: Optional[str] = None

    ocr_attempted: bool = False
    ocr_success: bool = False
    ocr_timestamp: Optional[str] = None
    ocr_processing_time_ms: float = 0
    ocr_items_found: int = 0

    link_sent: bool = False
    link_timestamp: Optional[str] = None
    session_id: Optional[str] = None

    link_clicked: bool = False
    link_click_timestamp: Optional[str] = None

    bill_completed: bool = False
    completion_timestamp: Optional[str] = None

    # Viral tracking
    shared_with_others: bool = False
    share_count: int = 0

    # Retention tracking
    returning_user: bool = False
    previous_uses: int = 0

    # Error tracking
    errors: List[str] = None

    def __post_init__(self):
        if self.errors is None:
            self.errors = []

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        data = asdict(self)
        # Calculate metrics
        if self.photo_timestamp and self.link_timestamp:
            photo_time = datetime.fromisoformat(self.photo_timestamp)
            link_time = datetime.fromisoformat(self.link_timestamp)
            data['photo_to_link_seconds'] = (link_time - photo_time).total_seconds()

        if self.link_timestamp and self.completion_timestamp:
            link_time = datetime.fromisoformat(self.link_timestamp)
            completion_time = datetime.fromisoformat(self.completion_timestamp)
            data['link_to_completion_seconds'] = (completion_time - link_time).total_seconds()

        return data


class WhatsAppAnalytics:
    """WhatsApp-specific analytics tracking"""

    def __init__(self):
        self.redis = redis_client
        self.logger = logger

    # ================ JOURNEY TRACKING ================

    def start_journey(self, phone_number: str) -> str:
        """Start tracking a user journey"""
        journey_id = f"{phone_number}_{int(time.time())}"

        journey = WhatsAppJourney(
            phone_number=phone_number,
            timestamp=datetime.utcnow().isoformat(),
            photo_received=True,
            photo_timestamp=datetime.utcnow().isoformat()
        )

        # Check if returning user
        previous_journeys = self.get_user_journey_count(phone_number)
        if previous_journeys > 0:
            journey.returning_user = True
            journey.previous_uses = previous_journeys

        self._save_journey(journey_id, journey)

        # Track in Redis for retention analysis
        if self.redis:
            # Add to user's journey list
            self.redis.lpush(f"user:journeys:{phone_number}", journey_id)
            self.redis.expire(f"user:journeys:{phone_number}", 86400 * 90)  # 90 days

            # Track daily active users
            today = datetime.now().strftime('%Y%m%d')
            self.redis.sadd(f"whatsapp:active_users:{today}", phone_number)
            self.redis.expire(f"whatsapp:active_users:{today}", 86400 * 30)

        self.logger.info(f"📊 Journey started: {journey_id} (returning: {journey.returning_user})")
        return journey_id

    def track_ocr_attempt(
        self,
        phone_number: str,
        success: bool,
        processing_time_ms: float,
        items_found: int = 0,
        error: Optional[str] = None
    ):
        """Track OCR processing"""
        journey = self._get_active_journey(phone_number)
        if not journey:
            return

        journey.ocr_attempted = True
        journey.ocr_success = success
        journey.ocr_timestamp = datetime.utcnow().isoformat()
        journey.ocr_processing_time_ms = processing_time_ms
        journey.ocr_items_found = items_found

        if error:
            journey.errors.append(f"OCR: {error}")

        self._save_journey(self._get_journey_id(phone_number), journey)

        # Track OCR metrics
        if self.redis:
            today = datetime.now().strftime('%Y%m%d')

            # OCR success/failure by source
            self.redis.incr(f"whatsapp:ocr:total:{today}")
            if success:
                self.redis.incr(f"whatsapp:ocr:success:{today}")
            else:
                self.redis.incr(f"whatsapp:ocr:failed:{today}")
                # Track error types
                if error:
                    self.redis.hincrby(f"whatsapp:ocr:errors:{today}", error[:50], 1)

            # Processing time distribution
            self.redis.zadd(
                f"whatsapp:ocr:processing_times:{today}",
                {str(time.time()): processing_time_ms}
            )

            self.redis.expire(f"whatsapp:ocr:total:{today}", 86400 * 7)
            self.redis.expire(f"whatsapp:ocr:success:{today}", 86400 * 7)
            self.redis.expire(f"whatsapp:ocr:failed:{today}", 86400 * 7)
            self.redis.expire(f"whatsapp:ocr:errors:{today}", 86400 * 7)
            self.redis.expire(f"whatsapp:ocr:processing_times:{today}", 86400 * 7)

        self.logger.info(f"📊 OCR tracked: {phone_number} - Success: {success}")

    def track_link_sent(self, phone_number: str, session_id: str):
        """Track when link is sent to user"""
        journey = self._get_active_journey(phone_number)
        if not journey:
            return

        journey.link_sent = True
        journey.link_timestamp = datetime.utcnow().isoformat()
        journey.session_id = session_id

        self._save_journey(self._get_journey_id(phone_number), journey)

        # Track conversion funnel
        if self.redis:
            today = datetime.now().strftime('%Y%m%d')
            self.redis.incr(f"whatsapp:funnel:link_sent:{today}")
            self.redis.expire(f"whatsapp:funnel:link_sent:{today}", 86400 * 7)

        self.logger.info(f"📊 Link sent tracked: {phone_number} → {session_id}")

    def track_link_click(self, session_id: str, phone_number: Optional[str] = None):
        """Track when user clicks the link (from web app)"""
        if not phone_number:
            # Try to get phone from session
            phone_number = self._get_phone_from_session(session_id)

        if not phone_number:
            return

        journey = self._get_active_journey(phone_number)
        if not journey:
            return

        journey.link_clicked = True
        journey.link_click_timestamp = datetime.utcnow().isoformat()

        self._save_journey(self._get_journey_id(phone_number), journey)

        # Track conversion funnel
        if self.redis:
            today = datetime.now().strftime('%Y%m%d')
            self.redis.incr(f"whatsapp:funnel:link_clicked:{today}")
            self.redis.expire(f"whatsapp:funnel:link_clicked:{today}", 86400 * 7)

        self.logger.info(f"📊 Link click tracked: {session_id}")

    def track_bill_completion(self, session_id: str, phone_number: Optional[str] = None):
        """Track when bill split is completed"""
        if not phone_number:
            phone_number = self._get_phone_from_session(session_id)

        if not phone_number:
            return

        journey = self._get_active_journey(phone_number)
        if not journey:
            return

        journey.bill_completed = True
        journey.completion_timestamp = datetime.utcnow().isoformat()

        self._save_journey(self._get_journey_id(phone_number), journey)

        # Track conversion funnel
        if self.redis:
            today = datetime.now().strftime('%Y%m%d')
            self.redis.incr(f"whatsapp:funnel:completed:{today}")
            self.redis.expire(f"whatsapp:funnel:completed:{today}", 86400 * 7)

        self.logger.info(f"📊 Completion tracked: {session_id}")

    def track_share(self, session_id: str, phone_number: Optional[str] = None):
        """Track when user shares the link (viral coefficient)"""
        if not phone_number:
            phone_number = self._get_phone_from_session(session_id)

        if not phone_number:
            return

        journey = self._get_active_journey(phone_number)
        if not journey:
            return

        journey.shared_with_others = True
        journey.share_count += 1

        self._save_journey(self._get_journey_id(phone_number), journey)

        # Track viral coefficient
        if self.redis:
            today = datetime.now().strftime('%Y%m%d')
            self.redis.incr(f"whatsapp:viral:shares:{today}")
            self.redis.expire(f"whatsapp:viral:shares:{today}", 86400 * 30)

        self.logger.info(f"📊 Share tracked: {phone_number}")

    # ================ METRICS CALCULATION ================

    def get_conversion_funnel(self, days: int = 7) -> Dict[str, Any]:
        """Get WhatsApp conversion funnel metrics"""
        if not self.redis:
            return {}

        metrics = {
            'period_days': days,
            'funnel_steps': [],
            'conversion_rates': {},
            'drop_off_points': {}
        }

        # Get metrics for each day
        total_photos = 0
        total_links_sent = 0
        total_links_clicked = 0
        total_completed = 0

        for i in range(days):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')

            photos = int(self.redis.get(f"whatsapp:ocr:total:{date}") or 0)
            links_sent = int(self.redis.get(f"whatsapp:funnel:link_sent:{date}") or 0)
            links_clicked = int(self.redis.get(f"whatsapp:funnel:link_clicked:{date}") or 0)
            completed = int(self.redis.get(f"whatsapp:funnel:completed:{date}") or 0)

            total_photos += photos
            total_links_sent += links_sent
            total_links_clicked += links_clicked
            total_completed += completed

        # Calculate funnel
        metrics['funnel_steps'] = [
            {
                'step': 'Photo Received',
                'count': total_photos,
                'percentage': 100.0
            },
            {
                'step': 'Link Sent (OCR Success)',
                'count': total_links_sent,
                'percentage': (total_links_sent / total_photos * 100) if total_photos > 0 else 0
            },
            {
                'step': 'Link Clicked',
                'count': total_links_clicked,
                'percentage': (total_links_clicked / total_photos * 100) if total_photos > 0 else 0
            },
            {
                'step': 'Bill Completed',
                'count': total_completed,
                'percentage': (total_completed / total_photos * 100) if total_photos > 0 else 0
            }
        ]

        # Conversion rates
        metrics['conversion_rates'] = {
            'photo_to_link': (total_links_sent / total_photos * 100) if total_photos > 0 else 0,
            'link_to_click': (total_links_clicked / total_links_sent * 100) if total_links_sent > 0 else 0,
            'click_to_completion': (total_completed / total_links_clicked * 100) if total_links_clicked > 0 else 0,
            'overall': (total_completed / total_photos * 100) if total_photos > 0 else 0
        }

        # Drop-off points
        metrics['drop_off_points'] = {
            'ocr_failure': total_photos - total_links_sent,
            'link_not_clicked': total_links_sent - total_links_clicked,
            'not_completed': total_links_clicked - total_completed
        }

        return metrics

    def get_retention_metrics(self, days: int = 30) -> Dict[str, Any]:
        """Calculate user retention metrics"""
        if not self.redis:
            return {}

        metrics = {
            'period_days': days,
            'total_users': 0,
            'new_users': 0,
            'returning_users': 0,
            'retention_rate': 0,
            'daily_breakdown': []
        }

        all_users = set()
        new_users = set()
        returning_users = set()

        for i in range(days):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')

            # Get active users for this day
            day_users = self.redis.smembers(f"whatsapp:active_users:{date}") or set()

            for user in day_users:
                if user not in all_users:
                    new_users.add(user)
                else:
                    returning_users.add(user)
                all_users.add(user)

            metrics['daily_breakdown'].append({
                'date': date,
                'active_users': len(day_users),
                'new_users': len([u for u in day_users if u in new_users]),
                'returning_users': len([u for u in day_users if u in returning_users])
            })

        metrics['total_users'] = len(all_users)
        metrics['new_users'] = len(new_users)
        metrics['returning_users'] = len(returning_users)
        metrics['retention_rate'] = (len(returning_users) / len(all_users) * 100) if len(all_users) > 0 else 0

        return metrics

    def get_viral_coefficient(self, days: int = 7) -> Dict[str, Any]:
        """Calculate viral coefficient (K-factor)"""
        if not self.redis:
            return {}

        total_users = 0
        total_shares = 0

        for i in range(days):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')

            users = len(self.redis.smembers(f"whatsapp:active_users:{date}") or set())
            shares = int(self.redis.get(f"whatsapp:viral:shares:{date}") or 0)

            total_users += users
            total_shares += shares

        # K-factor = (invites sent per user) * (conversion rate of invites)
        # Simplified: shares / users (assuming some conversion)
        k_factor = (total_shares / total_users) if total_users > 0 else 0

        return {
            'period_days': days,
            'total_users': total_users,
            'total_shares': total_shares,
            'shares_per_user': k_factor,
            'k_factor': k_factor * 0.3,  # Assume 30% conversion of shares to new users
            'viral_status': 'Growing' if k_factor > 1 else 'Not Viral'
        }

    def get_response_time_stats(self, days: int = 7) -> Dict[str, Any]:
        """Get response time distribution"""
        if not self.redis:
            return {}

        processing_times = []

        for i in range(days):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')

            # Get all processing times for this day
            times_data = self.redis.zrange(
                f"whatsapp:ocr:processing_times:{date}",
                0, -1,
                withscores=True
            )

            for _, time_ms in times_data:
                processing_times.append(time_ms)

        if not processing_times:
            return {
                'period_days': days,
                'count': 0
            }

        processing_times.sort()
        n = len(processing_times)

        return {
            'period_days': days,
            'count': n,
            'avg_ms': sum(processing_times) / n,
            'p50_ms': processing_times[n // 2],
            'p95_ms': processing_times[int(n * 0.95)] if n > 20 else processing_times[-1],
            'p99_ms': processing_times[int(n * 0.99)] if n > 100 else processing_times[-1],
            'min_ms': processing_times[0],
            'max_ms': processing_times[-1]
        }

    def get_cost_per_completion(self, days: int = 7) -> Dict[str, Any]:
        """Calculate cost per successful bill division"""
        if not self.redis:
            return {}

        total_cost = 0.0
        total_completions = 0

        for i in range(days):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')

            # OCR costs ($0.0015 per image)
            ocr_requests = int(self.redis.get(f"whatsapp:ocr:total:{date}") or 0)
            ocr_cost = ocr_requests * 0.0015

            # WhatsApp costs (estimate $0.005 per message, 2 messages per flow)
            messages = ocr_requests * 2  # Approx
            whatsapp_cost = messages * 0.005

            total_cost += (ocr_cost + whatsapp_cost)

            completions = int(self.redis.get(f"whatsapp:funnel:completed:{date}") or 0)
            total_completions += completions

        cost_per_completion = (total_cost / total_completions) if total_completions > 0 else 0

        return {
            'period_days': days,
            'total_cost_usd': round(total_cost, 2),
            'total_completions': total_completions,
            'cost_per_completion_usd': round(cost_per_completion, 4),
            'breakdown': {
                'ocr_cost': round(total_cost * 0.23, 2),  # Approx ratio
                'whatsapp_cost': round(total_cost * 0.77, 2)
            }
        }

    def get_error_analytics(self, days: int = 7) -> Dict[str, Any]:
        """Get detailed error analytics"""
        if not self.redis:
            return {}

        error_types = {}
        total_errors = 0

        for i in range(days):
            date = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')

            # Get error distribution
            errors = self.redis.hgetall(f"whatsapp:ocr:errors:{date}") or {}

            for error_type, count in errors.items():
                error_types[error_type] = error_types.get(error_type, 0) + int(count)
                total_errors += int(count)

        # Sort by frequency
        sorted_errors = sorted(error_types.items(), key=lambda x: x[1], reverse=True)

        return {
            'period_days': days,
            'total_errors': total_errors,
            'error_types': [
                {
                    'error': error,
                    'count': count,
                    'percentage': (count / total_errors * 100) if total_errors > 0 else 0
                }
                for error, count in sorted_errors
            ],
            'top_error': sorted_errors[0][0] if sorted_errors else None
        }

    # ================ HELPER METHODS ================

    def _save_journey(self, journey_id: str, journey: WhatsAppJourney):
        """Save journey to Redis"""
        if not self.redis:
            return

        try:
            self.redis.setex(
                f"journey:{journey_id}",
                86400 * 7,  # Keep for 7 days
                json.dumps(journey.to_dict())
            )
        except Exception as e:
            self.logger.error(f"Failed to save journey: {e}")

    def _get_active_journey(self, phone_number: str) -> Optional[WhatsAppJourney]:
        """Get the most recent active journey for a user"""
        journey_id = self._get_journey_id(phone_number)
        if not journey_id:
            return None

        if not self.redis:
            return None

        try:
            data = self.redis.get(f"journey:{journey_id}")
            if data:
                journey_dict = json.loads(data)
                # Reconstruct WhatsAppJourney from dict
                return WhatsAppJourney(**{k: v for k, v in journey_dict.items() if k in WhatsAppJourney.__annotations__})
        except Exception as e:
            self.logger.error(f"Failed to get journey: {e}")

        return None

    def _get_journey_id(self, phone_number: str) -> Optional[str]:
        """Get the most recent journey ID for a user"""
        if not self.redis:
            return None

        journey_ids = self.redis.lrange(f"user:journeys:{phone_number}", 0, 0)
        return journey_ids[0] if journey_ids else None

    def _get_phone_from_session(self, session_id: str) -> Optional[str]:
        """Get phone number from session ID"""
        if not self.redis:
            return None

        try:
            session_data = self.redis.get(f"session:{session_id}")
            if session_data:
                data = json.loads(session_data)
                return data.get('phone_number')
        except Exception as e:
            self.logger.error(f"Failed to get phone from session: {e}")

        return None

    def get_user_journey_count(self, phone_number: str) -> int:
        """Get number of previous journeys for a user"""
        if not self.redis:
            return 0

        return self.redis.llen(f"user:journeys:{phone_number}") or 0


# Global instance
whatsapp_analytics = WhatsAppAnalytics()
