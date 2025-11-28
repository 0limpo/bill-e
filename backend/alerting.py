"""
Automated Alerting System for Bill-e
Monitors metrics and sends alerts via email, Slack, or webhooks
"""

import os
import json
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
import httpx
from analytics import analytics

logger = logging.getLogger('alerting')


class AlertChannel:
    """Base class for alert channels"""

    async def send_alert(self, alert: Dict[str, Any]):
        """Send an alert via this channel"""
        raise NotImplementedError


class SlackChannel(AlertChannel):
    """Send alerts to Slack"""

    def __init__(self, webhook_url: str):
        self.webhook_url = webhook_url

    async def send_alert(self, alert: Dict[str, Any]):
        """Send alert to Slack"""
        try:
            severity_emoji = {
                'critical': '🚨',
                'warning': '⚠️',
                'info': 'ℹ️'
            }

            emoji = severity_emoji.get(alert.get('severity', 'info'), '📊')

            payload = {
                "text": f"{emoji} *{alert['type']}*",
                "blocks": [
                    {
                        "type": "header",
                        "text": {
                            "type": "plain_text",
                            "text": f"{emoji} {alert['type'].replace('_', ' ').title()}"
                        }
                    },
                    {
                        "type": "section",
                        "fields": [
                            {
                                "type": "mrkdwn",
                                "text": f"*Severity:*\n{alert.get('severity', 'unknown')}"
                            },
                            {
                                "type": "mrkdwn",
                                "text": f"*Time:*\n{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
                            }
                        ]
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*Message:*\n{alert.get('message', 'No message')}"
                        }
                    }
                ]
            }

            # Add value and threshold if available
            if 'value' in alert and 'threshold' in alert:
                payload["blocks"].append({
                    "type": "section",
                    "fields": [
                        {
                            "type": "mrkdwn",
                            "text": f"*Current Value:*\n{alert['value']}"
                        },
                        {
                            "type": "mrkdwn",
                            "text": f"*Threshold:*\n{alert['threshold']}"
                        }
                    ]
                })

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.webhook_url,
                    json=payload,
                    timeout=10
                )

                if response.status_code == 200:
                    logger.info(f"Alert sent to Slack: {alert['type']}")
                else:
                    logger.error(f"Failed to send Slack alert: {response.status_code}")

        except Exception as e:
            logger.error(f"Error sending Slack alert: {e}")


class EmailChannel(AlertChannel):
    """Send alerts via email"""

    def __init__(self, smtp_config: Dict[str, str]):
        self.smtp_config = smtp_config

    async def send_alert(self, alert: Dict[str, Any]):
        """Send alert via email"""
        try:
            # TODO: Implement SMTP email sending
            # For now, just log
            logger.info(f"Would send email alert: {alert}")

        except Exception as e:
            logger.error(f"Error sending email alert: {e}")


class WebhookChannel(AlertChannel):
    """Send alerts to custom webhook"""

    def __init__(self, webhook_url: str, headers: Optional[Dict[str, str]] = None):
        self.webhook_url = webhook_url
        self.headers = headers or {}

    async def send_alert(self, alert: Dict[str, Any]):
        """Send alert to webhook"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.webhook_url,
                    json=alert,
                    headers=self.headers,
                    timeout=10
                )

                if response.status_code == 200:
                    logger.info(f"Alert sent to webhook: {alert['type']}")
                else:
                    logger.error(f"Failed to send webhook alert: {response.status_code}")

        except Exception as e:
            logger.error(f"Error sending webhook alert: {e}")


class AlertManager:
    """Manages alert channels and sending"""

    def __init__(self):
        self.channels: List[AlertChannel] = []
        self.alert_history = []  # Store recent alerts to avoid spam

    def add_channel(self, channel: AlertChannel):
        """Add an alert channel"""
        self.channels.append(channel)

    async def send_alert(self, alert: Dict[str, Any]):
        """Send alert to all configured channels"""

        # Check if this alert was recently sent (avoid spam)
        if self._is_duplicate_alert(alert):
            logger.info(f"Skipping duplicate alert: {alert['type']}")
            return

        # Send to all channels
        for channel in self.channels:
            try:
                await channel.send_alert(alert)
            except Exception as e:
                logger.error(f"Failed to send alert via {channel.__class__.__name__}: {e}")

        # Store in history
        self.alert_history.append({
            **alert,
            'sent_at': datetime.now().isoformat()
        })

        # Keep only last 100 alerts
        self.alert_history = self.alert_history[-100:]

    def _is_duplicate_alert(self, alert: Dict[str, Any]) -> bool:
        """Check if alert was sent recently"""
        # Consider duplicate if same type sent in last hour
        alert_type = alert.get('type')
        cutoff_time = datetime.now().timestamp() - 3600  # 1 hour ago

        for historical_alert in reversed(self.alert_history):
            if historical_alert.get('type') == alert_type:
                sent_at = datetime.fromisoformat(historical_alert['sent_at']).timestamp()
                if sent_at > cutoff_time:
                    return True

        return False

    async def check_and_alert(self):
        """Check for anomalies and send alerts"""
        try:
            anomalies = analytics.check_anomalies()

            for anomaly in anomalies:
                await self.send_alert(anomaly)

        except Exception as e:
            logger.error(f"Error checking anomalies: {e}")


# Global alert manager instance
alert_manager = AlertManager()


# Initialize alert channels from environment
def init_alerting():
    """Initialize alerting based on environment variables"""

    # Slack
    slack_webhook = os.getenv('SLACK_WEBHOOK_URL')
    if slack_webhook:
        alert_manager.add_channel(SlackChannel(slack_webhook))
        logger.info("✅ Slack alerting enabled")

    # Custom webhook
    custom_webhook = os.getenv('ALERT_WEBHOOK_URL')
    if custom_webhook:
        headers = {}
        auth_header = os.getenv('ALERT_WEBHOOK_AUTH_HEADER')
        if auth_header:
            headers['Authorization'] = auth_header

        alert_manager.add_channel(WebhookChannel(custom_webhook, headers))
        logger.info("✅ Custom webhook alerting enabled")

    # Email (TODO)
    # smtp_config = {...}
    # alert_manager.add_channel(EmailChannel(smtp_config))

    if not alert_manager.channels:
        logger.warning("⚠️ No alert channels configured")


# Background task to check for anomalies periodically
async def periodic_anomaly_check():
    """Background task to check for anomalies every 5 minutes"""
    import asyncio

    while True:
        try:
            await alert_manager.check_and_alert()
            await asyncio.sleep(300)  # 5 minutes

        except Exception as e:
            logger.error(f"Error in periodic anomaly check: {e}")
            await asyncio.sleep(60)  # Retry in 1 minute


# Manual alert function
async def send_custom_alert(
    alert_type: str,
    message: str,
    severity: str = 'info',
    metadata: Optional[Dict[str, Any]] = None
):
    """Send a custom alert"""
    alert = {
        'type': alert_type,
        'severity': severity,
        'message': message,
        'metadata': metadata or {},
        'timestamp': datetime.now().isoformat()
    }

    await alert_manager.send_alert(alert)
