import redis
import json
from typing import Optional
from datetime import timedelta
import os
from dotenv import load_dotenv
from models import SessionData, UserProfile, ConversionEvent, PricingVariant

load_dotenv()

redis_client = redis.from_url(
    os.getenv("REDIS_URL"),
    decode_responses=True,
    ssl_cert_reqs=None
)

class Database:
    @staticmethod
    def save_session(session: SessionData) -> None:
        key = f"session:{session.session_id}"
        redis_client.setex(
            key,
            timedelta(hours=1),
            session.model_dump_json()
        )
    
    @staticmethod
    def get_session(session_id: str) -> Optional[SessionData]:
        key = f"session:{session_id}"
        data = redis_client.get(key)
        if data:
            return SessionData.model_validate_json(data)
        return None
    
    @staticmethod
    def save_user(user: UserProfile) -> None:
        key = f"user:{user.phone}"
        redis_client.set(key, user.model_dump_json())
    
    @staticmethod
    def get_user(phone: str) -> Optional[UserProfile]:
        key = f"user:{phone}"
        data = redis_client.get(key)
        if data:
            return UserProfile.model_validate_json(data)
        return None
    
    @staticmethod
    def get_or_create_user(phone: str) -> UserProfile:
        user = Database.get_user(phone)
        if user:
            return user
        
        variants = list(PricingVariant)
        variant_index = hash(phone) % len(variants)
        variant = variants[variant_index]
        
        user = UserProfile(
            phone=phone,
            pricing_variant=variant
        )
        Database.save_user(user)
        return user
