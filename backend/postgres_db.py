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


class AuthProvider(enum.Enum):
    GOOGLE = "google"
    FACEBOOK = "facebook"
    MICROSOFT = "microsoft"


class SessionStatus(enum.Enum):
    IN_PROGRESS = "in_progress"
    FINALIZED = "finalized"
    ABANDONED = "abandoned"


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


class User(Base):
    """
    Authenticated users via OAuth (Google/Facebook/Microsoft).
    Links to device_ids for premium access across devices.
    """
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # OAuth provider info
    provider = Column(SQLEnum(AuthProvider), nullable=False)
    provider_id = Column(String(255), nullable=False)  # ID from OAuth provider

    # User info from OAuth
    email = Column(String(255), nullable=False, index=True)
    name = Column(String(255))
    picture_url = Column(Text)

    # Linked devices (stored as JSON array of device_ids)
    device_ids = Column(JSON, default=list)  # ["device_id_1", "device_id_2", ...]

    # Premium status
    is_premium = Column(Boolean, default=False)
    premium_expires = Column(DateTime)
    premium_payment_id = Column(UUID(as_uuid=True))  # FK to payments

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at = Column(DateTime, default=datetime.utcnow)

    # Unique constraint: one account per provider+email combination
    __table_args__ = (
        Index('ix_users_provider_email', 'provider', 'email', unique=True),
        Index('ix_users_provider_id', 'provider', 'provider_id', unique=True),
    )


class SessionSnapshot(Base):
    """
    Complete snapshot of bill-splitting sessions.
    Synced from Redis via cron job for analytics and history.
    """
    __tablename__ = "session_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(String(100), unique=True, nullable=False, index=True)

    # Status
    status = Column(SQLEnum(SessionStatus), default=SessionStatus.IN_PROGRESS, index=True)
    host_step = Column(Integer)  # 1=Review, 2=Assign, 3=Share

    # Session data (stored as JSON for flexibility)
    items = Column(JSON)  # [{name, price, quantity, mode}, ...]
    participants = Column(JSON)  # [{id, name, phone}, ...]
    assignments = Column(JSON)  # {item_id: [{participant_id, quantity}], ...}
    charges = Column(JSON)  # [{id, name, value, valueType, isDiscount, distribution}, ...]

    # Totals
    subtotal = Column(Integer)  # In smallest currency unit
    total = Column(Integer)
    original_subtotal = Column(Integer)  # OCR detected subtotal
    original_total = Column(Integer)  # OCR detected total

    # Counts (denormalized for quick queries)
    items_count = Column(Integer, default=0)
    participants_count = Column(Integer, default=0)

    # Host info
    host_device_id = Column(String(100), index=True)
    host_phone = Column(String(50))

    # Device/location info
    device_type = Column(String(20))  # mobile, desktop, tablet
    os = Column(String(50))
    country_code = Column(String(5))
    currency = Column(String(10), default="CLP")

    # Timing
    created_at = Column(DateTime)  # When session was created in Redis
    started_at = Column(DateTime)  # When OCR completed (step 1 started)
    step1_completed_at = Column(DateTime)  # When moved to step 2
    step2_completed_at = Column(DateTime)  # When moved to step 3
    finalized_at = Column(DateTime)  # When session was finalized
    abandoned_at = Column(DateTime)  # When marked as abandoned

    # Duration (in seconds, calculated)
    duration_total = Column(Integer)  # Total session duration
    duration_step1 = Column(Integer)  # Time in review step
    duration_step2 = Column(Integer)  # Time in assign step

    # Sync metadata
    redis_ttl_at_sync = Column(Integer)  # TTL remaining when synced
    synced_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index('ix_session_snapshots_status_created', 'status', 'created_at'),
        Index('ix_session_snapshots_host', 'host_device_id'),
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


# Helper functions for OAuth Users

def find_or_create_user(
    provider: str,
    provider_id: str,
    email: str,
    name: str = None,
    picture_url: str = None,
    device_id: str = None
) -> Optional[Dict]:
    """
    Find existing user by provider+provider_id or create new one.
    Optionally links a device_id to the user.
    """
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        # Try to find existing user
        user = db.query(User).filter(
            User.provider == AuthProvider(provider),
            User.provider_id == provider_id
        ).first()

        if user:
            # Update last login
            user.last_login_at = datetime.utcnow()

            # Update info if changed
            if name and name != user.name:
                user.name = name
            if picture_url and picture_url != user.picture_url:
                user.picture_url = picture_url

            # Link device if provided and not already linked
            if device_id:
                current_devices = user.device_ids or []
                if device_id not in current_devices:
                    current_devices.append(device_id)
                    user.device_ids = current_devices

            db.flush()

            return {
                "id": str(user.id),
                "provider": user.provider.value,
                "email": user.email,
                "name": user.name,
                "picture_url": user.picture_url,
                "device_ids": user.device_ids or [],
                "is_premium": user.is_premium,
                "premium_expires": user.premium_expires.isoformat() if user.premium_expires else None,
                "is_new": False
            }

        # Create new user
        user = User(
            provider=AuthProvider(provider),
            provider_id=provider_id,
            email=email,
            name=name,
            picture_url=picture_url,
            device_ids=[device_id] if device_id else []
        )
        db.add(user)
        db.flush()

        return {
            "id": str(user.id),
            "provider": user.provider.value,
            "email": user.email,
            "name": user.name,
            "picture_url": user.picture_url,
            "device_ids": user.device_ids or [],
            "is_premium": False,
            "premium_expires": None,
            "is_new": True
        }


def get_user_by_id(user_id: str) -> Optional[Dict]:
    """Get user by ID."""
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()

        if not user:
            return None

        return {
            "id": str(user.id),
            "provider": user.provider.value,
            "email": user.email,
            "name": user.name,
            "picture_url": user.picture_url,
            "device_ids": user.device_ids or [],
            "is_premium": user.is_premium,
            "premium_expires": user.premium_expires.isoformat() if user.premium_expires else None
        }


def get_user_by_email(email: str) -> Optional[Dict]:
    """Get user by email (returns first match if multiple providers)."""
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        user = db.query(User).filter(User.email == email).first()

        if not user:
            return None

        return {
            "id": str(user.id),
            "provider": user.provider.value,
            "email": user.email,
            "name": user.name,
            "picture_url": user.picture_url,
            "device_ids": user.device_ids or [],
            "is_premium": user.is_premium,
            "premium_expires": user.premium_expires.isoformat() if user.premium_expires else None
        }


def link_device_to_user(user_id: str, device_id: str) -> Optional[Dict]:
    """Link a device_id to an existing user."""
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()

        if not user:
            return None

        current_devices = user.device_ids or []
        if device_id not in current_devices:
            current_devices.append(device_id)
            user.device_ids = current_devices
            db.flush()

        return {
            "id": str(user.id),
            "device_ids": user.device_ids
        }


def transfer_premium_to_user(
    user_id: str,
    device_id: str = None
) -> Optional[Dict]:
    """
    Transfer premium from a device_id to a user account.
    Called after OAuth sign-in post-payment.
    """
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        if not user:
            return None

        # If device_id provided, try to find premium from UserProfile
        if device_id:
            profile = db.query(UserProfile).filter(
                UserProfile.device_id == device_id,
                UserProfile.is_premium == True
            ).first()

            if profile and profile.premium_expires:
                user.is_premium = True
                user.premium_expires = profile.premium_expires
                user.premium_payment_id = profile.premium_payment_id

                # Link device if not already
                current_devices = user.device_ids or []
                if device_id not in current_devices:
                    current_devices.append(device_id)
                    user.device_ids = current_devices

                db.flush()

                return {
                    "id": str(user.id),
                    "is_premium": True,
                    "premium_expires": user.premium_expires.isoformat(),
                    "transferred_from_device": device_id
                }

        return {
            "id": str(user.id),
            "is_premium": user.is_premium,
            "premium_expires": user.premium_expires.isoformat() if user.premium_expires else None,
            "transferred_from_device": None
        }


def restore_premium_to_device(user_id: str, device_id: str) -> Optional[Dict]:
    """
    Restore premium from user account to a new device.
    Called when user signs in on a new device.
    """
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        if not user:
            return None

        if not user.is_premium or not user.premium_expires:
            return {
                "success": False,
                "error": "User does not have active premium"
            }

        if user.premium_expires < datetime.utcnow():
            return {
                "success": False,
                "error": "Premium has expired"
            }

        # Link device to user
        current_devices = user.device_ids or []
        if device_id not in current_devices:
            current_devices.append(device_id)
            user.device_ids = current_devices

        # Create or update UserProfile with premium
        profile = db.query(UserProfile).filter(UserProfile.device_id == device_id).first()

        if not profile:
            profile = UserProfile(device_id=device_id)
            db.add(profile)

        profile.is_premium = True
        profile.premium_expires = user.premium_expires
        profile.premium_payment_id = user.premium_payment_id
        profile.email = user.email

        db.flush()

        return {
            "success": True,
            "user_id": str(user.id),
            "device_id": device_id,
            "premium_expires": user.premium_expires.isoformat()
        }


# Helper functions for Session Snapshots

def upsert_session_snapshot(session_data: Dict, redis_ttl: int = None) -> Optional[Dict]:
    """
    Upsert a session snapshot from Redis data.
    Creates if new, updates if exists.
    """
    if not db_available:
        return None

    session_id = session_data.get("id") or session_data.get("session_id")
    if not session_id:
        return None

    with get_db() as db:
        if db is None:
            return None

        # Check if exists
        snapshot = db.query(SessionSnapshot).filter(
            SessionSnapshot.session_id == session_id
        ).first()

        is_new = snapshot is None
        if is_new:
            snapshot = SessionSnapshot(session_id=session_id)
            db.add(snapshot)

        # Determine status
        session_status = session_data.get("status", "assigning")
        if session_status == "finalized":
            snapshot.status = SessionStatus.FINALIZED
        elif redis_ttl is not None and redis_ttl < 3600:  # Less than 1 hour TTL
            snapshot.status = SessionStatus.ABANDONED
            if not snapshot.abandoned_at:
                snapshot.abandoned_at = datetime.utcnow()
        else:
            snapshot.status = SessionStatus.IN_PROGRESS

        # Basic info
        snapshot.host_step = session_data.get("host_step", 1)

        # Session data as JSON
        snapshot.items = session_data.get("items", [])
        snapshot.participants = session_data.get("participants", [])
        snapshot.assignments = session_data.get("assignments", {})
        snapshot.charges = session_data.get("charges", [])

        # Totals
        snapshot.subtotal = session_data.get("subtotal")
        snapshot.total = session_data.get("total")
        snapshot.original_subtotal = session_data.get("original_subtotal")
        snapshot.original_total = session_data.get("original_total")

        # Counts
        snapshot.items_count = len(snapshot.items) if snapshot.items else 0
        snapshot.participants_count = len(snapshot.participants) if snapshot.participants else 0

        # Host info
        snapshot.host_device_id = session_data.get("owner_device_id")
        snapshot.host_phone = session_data.get("owner_phone")

        # Timing from session data
        if session_data.get("created_at"):
            try:
                snapshot.created_at = datetime.fromisoformat(session_data["created_at"].replace("Z", "+00:00"))
            except:
                pass

        if session_data.get("step1_completed_at"):
            try:
                snapshot.step1_completed_at = datetime.fromisoformat(session_data["step1_completed_at"].replace("Z", "+00:00"))
            except:
                pass

        if session_data.get("step2_completed_at"):
            try:
                snapshot.step2_completed_at = datetime.fromisoformat(session_data["step2_completed_at"].replace("Z", "+00:00"))
            except:
                pass

        if session_status == "finalized" and not snapshot.finalized_at:
            snapshot.finalized_at = datetime.utcnow()

        # Calculate durations if we have timestamps
        if snapshot.created_at and snapshot.step1_completed_at:
            snapshot.duration_step1 = int((snapshot.step1_completed_at - snapshot.created_at).total_seconds())

        if snapshot.step1_completed_at and snapshot.step2_completed_at:
            snapshot.duration_step2 = int((snapshot.step2_completed_at - snapshot.step1_completed_at).total_seconds())

        if snapshot.created_at:
            end_time = snapshot.finalized_at or snapshot.abandoned_at or datetime.utcnow()
            snapshot.duration_total = int((end_time - snapshot.created_at).total_seconds())

        # Sync metadata
        snapshot.redis_ttl_at_sync = redis_ttl
        snapshot.synced_at = datetime.utcnow()

        db.flush()

        return {
            "session_id": session_id,
            "status": snapshot.status.value,
            "is_new": is_new,
            "items_count": snapshot.items_count,
            "participants_count": snapshot.participants_count
        }


def get_session_metrics() -> Optional[Dict]:
    """Get aggregated session metrics for analytics."""
    if not db_available:
        return None

    with get_db() as db:
        if db is None:
            return None

        from sqlalchemy import func

        # Total sessions by status
        status_counts = dict(
            db.query(SessionSnapshot.status, func.count(SessionSnapshot.id))
            .group_by(SessionSnapshot.status)
            .all()
        )

        # Completed sessions stats
        completed = db.query(SessionSnapshot).filter(
            SessionSnapshot.status == SessionStatus.FINALIZED
        )

        completed_count = completed.count()

        if completed_count > 0:
            avg_items = db.query(func.avg(SessionSnapshot.items_count)).filter(
                SessionSnapshot.status == SessionStatus.FINALIZED
            ).scalar() or 0

            avg_participants = db.query(func.avg(SessionSnapshot.participants_count)).filter(
                SessionSnapshot.status == SessionStatus.FINALIZED
            ).scalar() or 0

            avg_total = db.query(func.avg(SessionSnapshot.total)).filter(
                SessionSnapshot.status == SessionStatus.FINALIZED,
                SessionSnapshot.total.isnot(None)
            ).scalar() or 0

            avg_duration = db.query(func.avg(SessionSnapshot.duration_total)).filter(
                SessionSnapshot.status == SessionStatus.FINALIZED,
                SessionSnapshot.duration_total.isnot(None)
            ).scalar() or 0

            avg_duration_step1 = db.query(func.avg(SessionSnapshot.duration_step1)).filter(
                SessionSnapshot.status == SessionStatus.FINALIZED,
                SessionSnapshot.duration_step1.isnot(None)
            ).scalar() or 0

            avg_duration_step2 = db.query(func.avg(SessionSnapshot.duration_step2)).filter(
                SessionSnapshot.status == SessionStatus.FINALIZED,
                SessionSnapshot.duration_step2.isnot(None)
            ).scalar() or 0
        else:
            avg_items = avg_participants = avg_total = avg_duration = 0
            avg_duration_step1 = avg_duration_step2 = 0

        # Abandonment by step
        abandoned_by_step = dict(
            db.query(SessionSnapshot.host_step, func.count(SessionSnapshot.id))
            .filter(SessionSnapshot.status == SessionStatus.ABANDONED)
            .group_by(SessionSnapshot.host_step)
            .all()
        )

        return {
            "total_sessions": sum(v for v in status_counts.values()),
            "by_status": {k.value if k else "unknown": v for k, v in status_counts.items()},
            "completed": {
                "count": completed_count,
                "avg_items": round(float(avg_items), 1),
                "avg_participants": round(float(avg_participants), 1),
                "avg_total": round(float(avg_total), 0),
                "avg_duration_seconds": round(float(avg_duration), 0),
                "avg_duration_step1_seconds": round(float(avg_duration_step1), 0),
                "avg_duration_step2_seconds": round(float(avg_duration_step2), 0),
            },
            "abandoned_by_step": abandoned_by_step
        }


def get_recent_sessions(limit: int = 50, status: str = None) -> List[Dict]:
    """Get recent session snapshots for admin view."""
    if not db_available:
        return []

    with get_db() as db:
        if db is None:
            return []

        query = db.query(SessionSnapshot)

        if status:
            query = query.filter(SessionSnapshot.status == SessionStatus(status))

        sessions = query.order_by(SessionSnapshot.synced_at.desc()).limit(limit).all()

        return [{
            "session_id": s.session_id,
            "status": s.status.value if s.status else None,
            "host_step": s.host_step,
            "items_count": s.items_count,
            "participants_count": s.participants_count,
            "total": s.total,
            "duration_total": s.duration_total,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "finalized_at": s.finalized_at.isoformat() if s.finalized_at else None,
            "abandoned_at": s.abandoned_at.isoformat() if s.abandoned_at else None,
            "synced_at": s.synced_at.isoformat() if s.synced_at else None
        } for s in sessions]
