"""
FastAPI Middleware for automatic API call tracking
Logs all requests, responses, and performance metrics
"""

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
import time
from typing import Callable
import logging

from analytics import analytics

logger = logging.getLogger('analytics-middleware')


class AnalyticsMiddleware(BaseHTTPMiddleware):
    """
    Middleware to track all API calls automatically
    Measures response times, tracks errors, and logs requests
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """
        Process each request and track analytics
        """
        # Skip analytics endpoints to avoid recursive tracking
        if request.url.path.startswith('/api/analytics'):
            return await call_next(request)

        # Record start time
        start_time = time.time()

        # Extract request metadata
        method = request.method
        path = request.url.path
        user_agent = request.headers.get('user-agent', 'unknown')

        # Process request
        try:
            response = await call_next(request)
            status_code = response.status_code

        except Exception as e:
            # Track error
            logger.error(f"Request failed: {method} {path} - {str(e)}")
            status_code = 500
            raise

        finally:
            # Calculate duration
            duration_ms = (time.time() - start_time) * 1000

            # Track API call
            analytics.track_api_call(
                endpoint=path,
                method=method,
                status_code=status_code,
                duration_ms=duration_ms,
                user_agent=user_agent
            )

            # Log request
            logger.info(
                f"{method} {path} - {status_code} - {duration_ms:.2f}ms"
            )

        return response


class PerformanceLogger:
    """
    Context manager for tracking performance of specific operations
    """

    def __init__(self, operation_name: str, session_id: str = None):
        self.operation_name = operation_name
        self.session_id = session_id
        self.start_time = None

    def __enter__(self):
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        duration_ms = (time.time() - self.start_time) * 1000

        # Track performance
        from analytics import AnalyticsEvent, EventType

        event = AnalyticsEvent(
            event_type=EventType.PERFORMANCE.value,
            timestamp=time.time(),
            session_id=self.session_id,
            metadata={
                'operation': self.operation_name,
                'duration_ms': duration_ms
            },
            duration_ms=duration_ms,
            success=exc_type is None,
            error_message=str(exc_val) if exc_val else None
        )

        analytics.track_event(event)

        if exc_type:
            logger.error(f"Operation {self.operation_name} failed: {exc_val}")
        else:
            logger.info(f"Operation {self.operation_name} completed in {duration_ms:.2f}ms")


# Decorator for tracking specific endpoint performance
def track_endpoint(endpoint_name: str = None):
    """
    Decorator to track endpoint-specific metrics
    """
    def decorator(func):
        async def wrapper(*args, **kwargs):
            name = endpoint_name or func.__name__

            start_time = time.time()
            success = True
            error = None

            try:
                result = await func(*args, **kwargs)
                return result

            except Exception as e:
                success = False
                error = str(e)
                raise

            finally:
                duration_ms = (time.time() - start_time) * 1000

                logger.info(
                    f"Endpoint {name} - {'success' if success else 'failed'} - {duration_ms:.2f}ms"
                )

        return wrapper
    return decorator
