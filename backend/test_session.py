import sys
from models import SessionData, Item, Person
from database import Database
from datetime import datetime, timedelta
import uuid

def create_test_session():
    session_id = str(uuid.uuid4())[:8]
    
    session = SessionData(
        session_id=session_id,
        phone="+56912345678",
        expires_at=datetime.now() + timedelta(hours=1),
        items=[
            Item(id="1", name="Pizza Margarita", price=12000, quantity=1, assigned_to=[]),
            Item(id="2", name="Cerveza x2", price=8000, quantity=2, assigned_to=[]),
            Item(id="3", name="Papas Fritas", price=4500, quantity=1, assigned_to=[]),
            Item(id="4", name="Ensalada", price=6500, quantity=1, assigned_to=[])
        ],
        people=[
            Person(id="p1", name="Ana"),
            Person(id="p2", name="Carlos"),
            Person(id="p3", name="Maria")
        ],
        tip_percentage=0.15
    )
    
    Database.save_session(session)
    
    print("=" * 60)
    print("SESION DE PRUEBA CREADA")
    print("=" * 60)
    print(f"\nTelefono: {session.phone}")
    print(f"Session ID: {session_id}")
    print(f"Expira: {session.expires_at.strftime('%H:%M:%S')}")
    print(f"\nURL para abrir:")
    print(f"http://localhost:3000/s/{session_id}")
    print("\nItems cargados:")
    for item in session.items:
        print(f"  - {item.name}: ${item.price:,.0f}")
    print("\nPersonas:")
    for person in session.people:
        print(f"  - {person.name}")
    print("\n" + "=" * 60)
    
    return session_id

if __name__ == "__main__":
    create_test_session()
