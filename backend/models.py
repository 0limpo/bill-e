from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime
from enum import Enum

class PricingVariant(str, Enum):
    VARIANT_099 = "0.99"
    VARIANT_149 = "1.49"
    VARIANT_189 = "1.89"
    VARIANT_249 = "2.49"

class ConversationState(str, Enum):
    IDLE = "idle"
    WAITING_FOR_PHOTO = "waiting_for_photo"
    PHOTO_RECEIVED = "photo_received"
    WAITING_FOR_MANUAL_INPUT = "waiting_manual"
    PROCESSING_WEB = "processing_web"
    SHOWING_RESULT = "showing_result"
    PAYWALL = "paywall"

class Person(BaseModel):
    id: str
    name: str

class Item(BaseModel):
    id: str
    name: str
    price: float
    quantity: float = 1  # Float to support fractional assignments (e.g., 0.33 for 3-way split)
    assigned_to: List[str] = []
    mode: str = "individual"  # "individual" or "group" - synced across all participants

class SessionData(BaseModel):
    session_id: str
    phone: str
    created_at: datetime = Field(default_factory=datetime.now)
    expires_at: datetime
    items: List[Item] = []
    people: List[Person] = []
    tip_percentage: float = 0.15
    state: ConversationState = ConversationState.IDLE
    result: Optional[Dict] = None

class UserProfile(BaseModel):
    phone: str
    created_at: datetime = Field(default_factory=datetime.now)
    free_bills_used: int = 0  # For editors: counts sessions joined
    is_premium: bool = False
    premium_until: Optional[datetime] = None
    pricing_variant: PricingVariant
    country_code: Optional[str] = None
    total_bills_divided: int = 0
    last_active: datetime = Field(default_factory=datetime.now)
    # Editor verification
    pending_code: Optional[str] = None  # 6-digit code
    pending_code_expires: Optional[datetime] = None
    pending_session_id: Optional[str] = None  # Session they're trying to join

class ConversionEvent(BaseModel):
    phone: str
    timestamp: datetime = Field(default_factory=datetime.now)
    pricing_variant: PricingVariant
    converted: bool
    country_code: Optional[str] = None
    bill_total: Optional[float] = None
    bill_tip: Optional[float] = None
