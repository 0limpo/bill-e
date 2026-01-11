"""
PostgreSQL Database Module for Bill-e
Handles persistent storage for payments and user analytics.
"""

import os
import uuid
from datetime import datetime
from typing import Optional, Dict, Any, List
from contextlib import contextmanager

from sqlalchemy import (
    create_engine, Column, String, Integer, Boolean, DateTime,
    Text, JSON, Enum as SQLEnum, Index
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
import enum


# Database URL from environment
DATABASE_URL = os.getenv("DATABASE_URL", "")

# SQLAlchemy setup
Base = declarative_base()
engine = None
SessionLocal = None
db_available = False


def init_db():
    """Initialize database connection and create tables."""
    global engine, SessionLocal, db_available

    if not DATABASE_URL:
        print("WARNING: DATABASE_URL not configured - PostgreSQL features disabled")
        return False

    try:
        # Handle Render's postgres:// vs postgresql:// URL format
        db_url = DATABASE_URL
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)

        engine = create_engine(db_url, pool_pre_ping=True, pool_size=5, max_overflow=10)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

        # Create tables
        Base.metadata.create_all(bind=engine)
        db_available = True
        print("PostgreSQL database initialized successfully")
        return True

    except Exception as e:
        print(f"WARNING: Failed to initialize PostgreSQL: {e}")
        db_available = False
        return False


@contextmanager
def get_db():
    """Get database session context manager."""
    if SessionLocal is None:
        yield None
        return

    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# Enums
class PaymentStatus(enum.Enum):
    PENDING = "pending"
    PAID = "paid"
    REJECTED = "rejected"
    REFUNDED = "refunded"
    CANCELLED = "cancelled"


class UserRole(enum.Enum):
    HOST = "host"
    EDITOR = "editor"


class DeviceType(enum.Enum):
    MOBILE = "mobile"
    DESKTOP = "desktop"
    TABLET = "tablet"
    UNKNOWN = "unknown"


# Models
class Payment(Base):
    """
    Payment transactions from all processors.
    This is the source of truth for who has paid.
    """
    __tablename__ = "payments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    commerce_order = Column(String(100), unique=True, nullable=False, index=True)

    # Processor info (mercadopago, stripe, paddle, lemonsqueezy, etc.)
    processor = Column(String(50), nullable=False)
    processor_payment_id = Column(String(100), index=True)
    processor_response = Column(JSON)  # Full response for debugging

    # User identification
    device_id = Column(String(100), index=True)
    phone = Column(String(50), index=True)
    email = Column(String(255), index=True)

    # Payment details
    amount = Column(Integer, nullable=False)  # In smallest currency unit (cents/pesos)
    currency = Column(String(10), nullable=False, default="CLP")
    country_code = Column(String(5))  # ISO country code (CL, US, MX, etc.)

    # Status and type
    status = Column(SQLEnum(PaymentStatus), default=PaymentStatus.PENDING, index=True)
    user_type = Column(SQLEnum(UserRole))  # Was user host or editor when paying

    # Session info
    session_id = Column(String(100))

    # Premium info
    premium_expires = Column(DateTime)

    # Timestamps
    paid_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Indexes for common queries
    __table_args__ = (
        Index('ix_payments_phone_status', 'phone', 'status'),
        Index('ix_payments_device_status', 'device_id', 'status'),
    )


class UserProfile(Base):
    """
    User analytics profile tracked by device_id.
    Captures how users interact with Bill-e.
    """
    __tablename__ = "user_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id = Column(String(100), unique=True, nullable=False, index=True)

    # Contact info (optional, collected during payment)
    phone = Column(String(50), index=True)
    email = Column(String(255))

    # First interaction analytics
    first_role = Column(SQLEnum(UserRole))  # First seen as host or editor
    first_session_id = Column(String(100))

    # Device analytics
    device_type = Column(SQLEnum(DeviceType), default=DeviceType.UNKNOWN)
    os = Column(String(50))  # iOS, Android, Windows, macOS, Linux
    browser = Column(String(50))  # Chrome, Safari, Firefox, etc.
    user_agent = Column(Text)  # Full user agent for debugging

    # Location
    country_code = Column(String(5))
    timezone = Column(String(50))
    language = Column(String(10))  # Browser language preference

    # Premium status (denormalized for quick checks)
    is_premium = Column(Boolean, default=False)
    premium_expires = Column(DateTime)
    premium_payment_id = Column(UUID(as_uuid=True))  # FK to payments

    # Usage stats
    sessions_as_host = Column(Integer, default=0)
    sessions_as_editor = Column(Integer, default=0)
    total_bills_split = Column(Integer, default=0)

    # Timestamps
    first_seen_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Indexes
    __table_args__ = (
        Index('ix_user_profiles_premium', 'is_premium', 'premium_expires'),
        Index('ix_user_profiles_country', 'country_code'),
    )


# Helper functions for Payments

def create_payment(
    commerce_order: str,
    processor: str,
    amount: int,
    currency: str,
    device_id: str = None,
    phone: str = None,
    email: str = None,
    user_type: str = None,
    country_code: str = None,
    session_id: str = None
) -> Optional[Dict]:
    """Create a new payment record."""
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        payment = Payment(
            commerce_order=commerce_order,
            processor=processor,
            device_id=device_id,
            phone=phone,
            email=email,
            amount=amount,
            currency=currency,
            country_code=country_code,
            session_id=session_id,
            user_type=UserRole(user_type) if user_type else None,
            status=PaymentStatus.PENDING
        )
        db.add(payment)
        db.flush()

        return {
            "id": str(payment.id),
            "commerce_order": payment.commerce_order,
            "status": payment.status.value
        }


def update_payment_status(
    commerce_order: str,
    status: str,
    processor_payment_id: str = None,
    processor_response: dict = None,
    premium_expires: datetime = None
) -> Optional[Dict]:
    """Update payment status after processor callback."""
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        payment = db.query(Payment).filter(Payment.commerce_order == commerce_order).first()

        if not payment:
            return None

        payment.status = PaymentStatus(status)

        if processor_payment_id:
            payment.processor_payment_id = processor_payment_id

        if processor_response:
            payment.processor_response = processor_response

        if status == "paid":
            payment.paid_at = datetime.utcnow()
            if premium_expires:
                payment.premium_expires = premium_expires

        db.flush()

        return {
            "id": str(payment.id),
            "commerce_order": payment.commerce_order,
            "status": payment.status.value,
            "paid_at": payment.paid_at.isoformat() if payment.paid_at else None
        }


def get_payment_by_order(commerce_order: str) -> Optional[Dict]:
    """Get payment by commerce order ID."""
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        payment = db.query(Payment).filter(Payment.commerce_order == commerce_order).first()

        if not payment:
            return None

        return {
            "id": str(payment.id),
            "commerce_order": payment.commerce_order,
            "processor": payment.processor,
            "processor_payment_id": payment.processor_payment_id,
            "device_id": payment.device_id,
            "phone": payment.phone,
            "email": payment.email,
            "amount": payment.amount,
            "currency": payment.currency,
            "status": payment.status.value,
            "user_type": payment.user_type.value if payment.user_type else None,
            "premium_expires": payment.premium_expires.isoformat() if payment.premium_expires else None,
            "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
            "created_at": payment.created_at.isoformat() if payment.created_at else None
        }


# Helper functions for User Profiles

def parse_user_agent(user_agent: str) -> Dict[str, str]:
    """Parse user agent to extract device info."""
    if not user_agent:
        return {"device_type": "unknown", "os": None, "browser": None}

    ua_lower = user_agent.lower()

    # Device type
    if "mobile" in ua_lower or "android" in ua_lower or "iphone" in ua_lower:
        if "tablet" in ua_lower or "ipad" in ua_lower:
            device_type = "tablet"
        else:
            device_type = "mobile"
    else:
        device_type = "desktop"

    # OS
    if "iphone" in ua_lower or "ipad" in ua_lower:
        os = "iOS"
    elif "android" in ua_lower:
        os = "Android"
    elif "windows" in ua_lower:
        os = "Windows"
    elif "mac" in ua_lower:
        os = "macOS"
    elif "linux" in ua_lower:
        os = "Linux"
    else:
        os = "Other"

    # Browser
    if "chrome" in ua_lower and "edg" not in ua_lower:
        browser = "Chrome"
    elif "safari" in ua_lower and "chrome" not in ua_lower:
        browser = "Safari"
    elif "firefox" in ua_lower:
        browser = "Firefox"
    elif "edg" in ua_lower:
        browser = "Edge"
    else:
        browser = "Other"

    return {"device_type": device_type, "os": os, "browser": browser}


def track_user(
    device_id: str,
    role: str = None,
    session_id: str = None,
    user_agent: str = None,
    country_code: str = None,
    timezone: str = None,
    language: str = None
) -> Optional[Dict]:
    """Track user visit - creates profile if new, updates if existing."""
    if not db_available or not device_id:
        return None

    with get_db() as db:
        if db is None:
            return None

        profile = db.query(UserProfile).filter(UserProfile.device_id == device_id).first()

        # Parse user agent
        ua_info = parse_user_agent(user_agent)

        if profile:
            # Update last seen
            profile.last_seen_at = datetime.utcnow()

            # Update stats
            if role == "host":
                profile.sessions_as_host = (profile.sessions_as_host or 0) + 1
            elif role == "editor":
                profile.sessions_as_editor = (profile.sessions_as_editor or 0) + 1

            profile.total_bills_split = (profile.total_bills_split or 0) + 1

            # Update optional fields if provided and not set
            if country_code and not profile.country_code:
                profile.country_code = country_code
            if timezone and not profile.timezone:
                profile.timezone = timezone
            if language and not profile.language:
                profile.language = language

            db.flush()

            return {
                "id": str(profile.id),
                "device_id": profile.device_id,
                "is_new": False,
                "first_role": profile.first_role.value if profile.first_role else None,
                "is_premium": profile.is_premium
            }

        # Create new profile
        profile = UserProfile(
            device_id=device_id,
            first_role=UserRole(role) if role else None,
            first_session_id=session_id,
            device_type=DeviceType(ua_info["device_type"]) if ua_info["device_type"] != "unknown" else DeviceType.UNKNOWN,
            os=ua_info["os"],
            browser=ua_info["browser"],
            user_agent=user_agent,
            country_code=country_code,
            timezone=timezone,
            language=language,
            sessions_as_host=1 if role == "host" else 0,
            sessions_as_editor=1 if role == "editor" else 0,
            total_bills_split=1
        )
        db.add(profile)
        db.flush()

        return {
            "id": str(profile.id),
            "device_id": profile.device_id,
            "is_new": True,
            "first_role": profile.first_role.value if profile.first_role else None,
            "is_premium": False
        }


def set_user_premium(
    device_id: str,
    payment_id: str,
    premium_expires: datetime,
    phone: str = None,
    email: str = None
) -> Optional[Dict]:
    """Mark user as premium after successful payment."""
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        profile = db.query(UserProfile).filter(UserProfile.device_id == device_id).first()

        if not profile:
            # Create minimal profile
            profile = UserProfile(device_id=device_id)
            db.add(profile)

        profile.is_premium = True
        profile.premium_expires = premium_expires
        profile.premium_payment_id = uuid.UUID(payment_id) if isinstance(payment_id, str) else payment_id

        if phone:
            profile.phone = phone
        if email:
            profile.email = email

        db.flush()

        return {
            "device_id": profile.device_id,
            "is_premium": True,
            "premium_expires": premium_expires.isoformat()
        }


def get_user_profile(device_id: str) -> Optional[Dict]:
    """Get user profile by device_id."""
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        profile = db.query(UserProfile).filter(UserProfile.device_id == device_id).first()

        if not profile:
            return None

        return {
            "id": str(profile.id),
            "device_id": profile.device_id,
            "phone": profile.phone,
            "email": profile.email,
            "first_role": profile.first_role.value if profile.first_role else None,
            "device_type": profile.device_type.value if profile.device_type else None,
            "os": profile.os,
            "browser": profile.browser,
            "country_code": profile.country_code,
            "is_premium": profile.is_premium,
            "premium_expires": profile.premium_expires.isoformat() if profile.premium_expires else None,
            "sessions_as_host": profile.sessions_as_host,
            "sessions_as_editor": profile.sessions_as_editor,
            "total_bills_split": profile.total_bills_split,
            "first_seen_at": profile.first_seen_at.isoformat() if profile.first_seen_at else None,
            "last_seen_at": profile.last_seen_at.isoformat() if profile.last_seen_at else None
        }


# Analytics functions

def get_analytics_summary() -> Optional[Dict]:
    """Get summary analytics."""
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        from sqlalchemy import func

        total_users = db.query(func.count(UserProfile.id)).scalar() or 0
        premium_users = db.query(func.count(UserProfile.id)).filter(
            UserProfile.is_premium == True,
            UserProfile.premium_expires > datetime.utcnow()
        ).scalar() or 0

        total_payments = db.query(func.count(Payment.id)).filter(
            Payment.status == PaymentStatus.PAID
        ).scalar() or 0

        total_revenue = db.query(func.sum(Payment.amount)).filter(
            Payment.status == PaymentStatus.PAID
        ).scalar() or 0

        # Users by first role
        hosts_first = db.query(func.count(UserProfile.id)).filter(
            UserProfile.first_role == UserRole.HOST
        ).scalar() or 0

        editors_first = db.query(func.count(UserProfile.id)).filter(
            UserProfile.first_role == UserRole.EDITOR
        ).scalar() or 0

        # Users by device type
        device_breakdown = dict(
            db.query(UserProfile.device_type, func.count(UserProfile.id))
            .group_by(UserProfile.device_type)
            .all()
        )

        # Users by country
        country_breakdown = dict(
            db.query(UserProfile.country_code, func.count(UserProfile.id))
            .filter(UserProfile.country_code.isnot(None))
            .group_by(UserProfile.country_code)
            .order_by(func.count(UserProfile.id).desc())
            .limit(20)
            .all()
        )

        # Payments by processor
        processor_breakdown = dict(
            db.query(Payment.processor, func.count(Payment.id))
            .filter(Payment.status == PaymentStatus.PAID)
            .group_by(Payment.processor)
            .all()
        )

        return {
            "total_users": total_users,
            "premium_users": premium_users,
            "conversion_rate": round((premium_users / total_users * 100), 2) if total_users > 0 else 0,
            "total_payments": total_payments,
            "total_revenue": total_revenue,
            "first_role": {
                "host": hosts_first,
                "editor": editors_first
            },
            "device_types": {k.value if k else "unknown": v for k, v in device_breakdown.items()},
            "countries": country_breakdown,
            "processors": processor_breakdown
        }


def get_recent_payments(limit: int = 50) -> List[Dict]:
    """Get recent payments for admin view."""
    if not db_available:
        return []

    with get_db() as db:
        if db is None:
            return []

        payments = db.query(Payment).order_by(Payment.created_at.desc()).limit(limit).all()

        return [{
            "id": str(p.id),
            "commerce_order": p.commerce_order,
            "processor": p.processor,
            "amount": p.amount,
            "currency": p.currency,
            "status": p.status.value,
            "phone": p.phone,
            "country_code": p.country_code,
            "paid_at": p.paid_at.isoformat() if p.paid_at else None,
            "created_at": p.created_at.isoformat() if p.created_at else None
        } for p in payments]
