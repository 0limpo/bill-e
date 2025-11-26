import React, { useState, useEffect } from 'react';
import { UserPlus, Trash2, Send, X, Loader2, CheckCircle } from 'lucide-react';

function BillSplitter() {
  const getSessionId = () => {
    const path = window.location.pathname;
    const match = path.match(/\/s\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  };

  const sessionId = getSessionId();
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  
  const [items, setItems] = useState([]);
  const [people, setPeople] = useState([
    { id: 1, name: 'Persona 1', phone: '' },
    { id: 2, name: 'Persona 2', phone: '' }
  ]);
  
  const [tip, setTip] = useState(15);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setError('No se encontró ID de sesión en la URL');
      setLoading(false);
      return;
    }

    loadSessionData();
  }, [sessionId]);

  const loadSessionData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/session/${sessionId}`);
      
      if (!response.ok) {
        throw new Error('Sesión no encontrada o expirada');
      }

      const data = await response.json();
      
      if (data.items && data.items.length > 0) {
        setItems(data.items.map(item => ({
          id: item.id,
          name: item.name,
          price: item.price,
          assignedTo: item.assigned_to || []
        })));
      } else {
        setItems([
          { id: 1, name: 'Pizza Margarita', price: 450, assignedTo: [] },
          { id: 2, name: 'Cerveza x2', price: 180, assignedTo: [] },
          { id: 3, name: 'Ensalada César', price: 220, assignedTo: [] },
          { id: 4, name: 'Postre', price: 150, assignedTo: [] }
        ]);
      }

      if (data.people && data.people.length > 0) {
        setPeople(data.people.map(p => ({
          id: p.id,
          name: p.name,
          phone: ''
        })));
      }

      if (data.tip_percentage) {
        setTip(data.tip_percentage * 100);
      }

      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const toggleAssignment = (itemId, personId) => {
    setItems(items.map(item => {
      if (item.id === itemId) {
        const isAssigned = item.assignedTo.includes(personId);
        return {
          ...item,
          assignedTo: isAssigned 
            ? item.assignedTo.filter(id => id !== personId)
            : [...item.assignedTo, personId]
        };
      }
      return item;
    }));
  };

  const addPerson = () => {
    if (newPersonName) {
      setPeople([...people, { 
        id: Date.now(), 
        name: newPersonName,
        phone: ''
      }]);
      setNewPersonName('');
      setShowAddPerson(false);
    }
  };

  const removePerson = (personId) => {
    if (people.length <= 2) {
      alert('Debe haber al menos 2 personas');
      return;
    }
    setPeople(people.filter(p => p.id !== personId));
    setItems(items.map(item => ({
      ...item,
      assignedTo: item.assignedTo.filter(id => id !== personId)
    })));
  };

  const addItem = () => {
    const name = prompt('Nombre del item:');
    const price = parseFloat(prompt('Precio:'));
    
    if (name && price && !isNaN(price)) {
      setItems([...items, {
        id: Date.now(),
        name,
        price,
        assignedTo: []
      }]);
    }
  };

  const removeItem = (itemId) => {
    setItems(items.filter(item => item.id !== itemId));
  };

  const calculateTotals = () => {
    const subtotal = items.reduce((sum, item) => sum + item.price, 0);
    const tipAmount = subtotal * (tip / 100);
    const total = subtotal + tipAmount;
    
    const personTotals = people.map(person => {
      const itemsTotal = items.reduce((sum, item) => {
        if (item.assignedTo.includes(person.id)) {
          return sum + (item.price / item.assignedTo.length);
        }
        return sum;
      }, 0);
      
      const personTip = (itemsTotal / subtotal) * tipAmount;
      
      return {
        ...person,
        subtotal: itemsTotal,
        tip: personTip,
        total: itemsTotal + personTip
      };
    });
    
    return { subtotal, tipAmount, total, personTotals };
  };

  const splitEqually = () => {
    const allPersonIds = people.map(p => p.id);
    setItems(items.map(item => ({
      ...item,
      assignedTo: allPersonIds
    })));
  };

  const sendResults = async () => {
    try {
      setSending(true);
      const { subtotal, tipAmount, total, personTotals } = calculateTotals();

      const payload = {
        total: total,
        subtotal: subtotal,
        tip: tipAmount,
        per_person: personTotals.map(p => ({
          id: p.id,
          name: p.name,
          subtotal: p.subtotal,
          tip: p.tip,
          total: p.total
        }))
      };

      const response = await fetch(`${API_URL}/api/session/${sessionId}/calculate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Error al enviar los resultados');
      }

      setSuccess(true);
      setSending(false);

    } catch (err) {
      alert('Error al enviar: ' + err.message);
      setSending(false);
    }
  };

  const { subtotal, tipAmount, total, personTotals } = calculateTotals();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 style={{ width: '48px', height: '48px', animation: 'spin 1s linear infinite', color: '#667eea', margin: '0 auto 16px' }} />
          <p style={{ color: '#4a5568' }}>Cargando tu cuenta...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #fc8181 0%, #f56565 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '32px', maxWidth: '448px', textAlign: 'center' }}>
          <div style={{ fontSize: '60px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#2d3748', marginBottom: '8px' }}>Error</h2>
          <p style={{ color: '#4a5568', marginBottom: '24px' }}>{error}</p>
          <p style={{ fontSize: '14px', color: '#718096' }}>La sesión puede haber expirado (1 hora de validez)</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #48bb78 0%, #38a169 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '32px', maxWidth: '448px', textAlign: 'center' }}>
          <CheckCircle style={{ width: '80px', height: '80px', color: '#48bb78', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: '30px', fontWeight: 'bold', color: '#2d3748', marginBottom: '8px' }}>¡Listo! ✅</h2>
          <p style={{ color: '#4a5568', marginBottom: '24px' }}>
            La cuenta fue dividida y enviada por WhatsApp a todos.
          </p>
          <div style={{ background: '#f0fff4', borderRadius: '12px', padding: '16px', marginBottom: '24px' }}>
            <p style={{ fontSize: '14px', color: '#2f855a' }}>
              Cada persona recibirá un mensaje con su monto exacto.
            </p>
          </div>
          <p style={{ fontSize: '12px', color: '#718096' }}>
            Puedes cerrar esta ventana
          </p>
        </div>
      </div>
    );
  }

  if (showPreview) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #48bb78 0%, #38a169 100%)', padding: '16px' }}>
        <div style={{ maxWidth: '672px', margin: '0 auto', background: 'white', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#2d3748' }}>Vista Previa</h2>
            <button
              onClick={() => setShowPreview(false)}
              style={{ padding: '8px', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
            >
              <X style={{ width: '20px', height: '20px' }} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
            {personTotals.map(person => (
              <div key={person.id} style={{ border: '2px solid #48bb78', borderRadius: '12px', padding: '16px', background: '#f0fff4' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ fontWeight: 'bold', fontSize: '18px', color: '#2d3748' }}>{person.name}</h3>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#48bb78' }}>
                      ${person.total.toFixed(2)}
                    </p>
                  </div>
                </div>

                <div style={{ background: 'white', borderRadius: '8px', padding: '12px' }}>
                  <p style={{ fontSize: '14px', color: '#4a5568', fontWeight: '600', marginBottom: '8px' }}>Su consumo:</p>
                  {items
                    .filter(item => item.assignedTo.includes(person.id))
                    .map(item => (
                      <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '4px' }}>
                        <span style={{ color: '#2d3748' }}>
                          {item.name} {item.assignedTo.length > 1 && `(÷${item.assignedTo.length})`}
                        </span>
                        <span style={{ fontWeight: '500' }}>
                          ${(item.price / item.assignedTo.length).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '8px', marginTop: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                      <span style={{ color: '#4a5568' }}>Subtotal:</span>
                      <span style={{ fontWeight: '500' }}>${person.subtotal.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                      <span style={{ color: '#4a5568' }}>Propina ({tip}%):</span>
                      <span style={{ fontWeight: '500' }}>${person.tip.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={sendResults}
            disabled={sending}
            style={{
              width: '100%',
              background: sending ? '#cbd5e0' : '#48bb78',
              color: 'white',
              padding: '16px',
              border: 'none',
              borderRadius: '12px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: sending ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            {sending ? (
              <>
                <Loader2 style={{ width: '20px', height: '20px', animation: 'spin 1s linear infinite' }} />
                Enviando...
              </>
            ) : (
              <>
                <Send style={{ width: '20px', height: '20px' }} />
                Enviar por WhatsApp
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: '16px' }}>
      <div style={{ maxWidth: '896px', margin: '0 auto' }}>
        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '24px', marginBottom: '16px' }}>
          <h1 style={{ fontSize: '30px', fontWeight: 'bold', color: '#2d3748', marginBottom: '8px' }}>Dividir Cuenta</h1>
          <p style={{ color: '#4a5568' }}>Sesión expira en: <span style={{ fontWeight: '600', color: '#ed8936' }}>54:32</span></p>
        </div>

        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '24px', marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', textAlign: 'center' }}>
            <div>
              <p style={{ color: '#4a5568', fontSize: '14px' }}>Subtotal</p>
              <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#2d3748' }}>${subtotal}</p>
            </div>
            <div>
              <p style={{ color: '#4a5568', fontSize: '14px' }}>Propina ({tip}%)</p>
              <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#667eea' }}>${tipAmount.toFixed(0)}</p>
            </div>
            <div>
              <p style={{ color: '#4a5568', fontSize: '14px' }}>Total</p>
              <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#48bb78' }}>${total.toFixed(0)}</p>
            </div>
          </div>
          
          <div style={{ marginTop: '16px' }}>
            <label style={{ fontSize: '14px', color: '#4a5568', display: 'block', marginBottom: '8px' }}>Ajustar propina:</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[10, 15, 20, 25].map(percent => (
                <button
                  key={percent}
                  onClick={() => setTip(percent)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    background: tip === percent ? '#667eea' : '#f7fafc',
                    color: tip === percent ? 'white' : '#2d3748'
                  }}
                >
                  {percent}%
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '24px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#2d3748' }}>Personas ({people.length})</h2>
            <button
              onClick={splitEqually}
              style={{
                fontSize: '14px',
                background: '#f3e8ff',
                color: '#7c3aed',
                padding: '8px 16px',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              Dividir Todo Igual
            </button>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            {people.map(person => {
              const personTotal = personTotals.find(p => p.id === person.id);
              return (
                <div key={person.id} style={{ border: '2px solid #bee3f8', borderRadius: '12px', padding: '12px', background: '#ebf8ff', position: 'relative' }}>
                  <button
                    onClick={() => removePerson(person.id)}
                    style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      padding: '4px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '50%',
                      color: '#f56565',
                      cursor: 'pointer'
                    }}
                  >
                    <X style={{ width: '16px', height: '16px' }} />
                  </button>
                  <p style={{ fontWeight: '600', color: '#2d3748' }}>{person.name}</p>
                  <p style={{ fontSize: '18px', fontWeight: 'bold', color: '#3182ce' }}>
                    ${personTotal?.total.toFixed(2) || '0.00'}
                  </p>
                </div>
              );
            })}
          </div>

          {showAddPerson ? (
            <div style={{ border: '2px dashed #cbd5e0', borderRadius: '12px', padding: '16px' }}>
              <input
                type="text"
                placeholder="Nombre"
                value={newPersonName}
                onChange={(e) => setNewPersonName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  marginBottom: '12px',
                  fontSize: '14px'
                }}
                onKeyPress={(e) => e.key === 'Enter' && addPerson()}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={addPerson}
                  style={{
                    flex: 1,
                    background: '#48bb78',
                    color: 'white',
                    padding: '8px',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  Agregar
                </button>
                <button
                  onClick={() => setShowAddPerson(false)}
                  style={{
                    flex: 1,
                    background: '#e2e8f0',
                    color: '#2d3748',
                    padding: '8px',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddPerson(true)}
              style={{
                width: '100%',
                border: '2px dashed #cbd5e0',
                borderRadius: '12px',
                padding: '16px',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                color: '#4a5568',
                fontWeight: '600'
              }}
            >
              <UserPlus style={{ width: '20px', height: '20px' }} />
              Agregar Persona
            </button>
          )}
        </div>

        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: '24px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#2d3748' }}>Items de la cuenta</h2>
            <button
              onClick={addItem}
              style={{
                fontSize: '14px',
                background: '#c6f6d5',
                color: '#22543d',
                padding: '8px 16px',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              + Agregar Item
            </button>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {items.map(item => (
              <div key={item.id} style={{ border: '2px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                  <div>
                    <p style={{ fontWeight: '600', color: '#2d3748' }}>{item.name}</p>
                    <p style={{ fontSize: '18px', fontWeight: 'bold', color: '#48bb78' }}>${item.price}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {item.assignedTo.length > 0 && (
                      <span style={{
                        background: '#bee3f8',
                        color: '#2c5282',
                        fontSize: '12px',
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontWeight: '600'
                      }}>
                        {item.assignedTo.length} {item.assignedTo.length === 1 ? 'persona' : 'personas'}
                      </span>
                    )}
                    <button
                      onClick={() => removeItem(item.id)}
                      style={{
                        padding: '4px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: '50%',
                        color: '#f56565',
                        cursor: 'pointer'
                      }}
                    >
                      <Trash2 style={{ width: '16px', height: '16px' }} />
                    </button>
                  </div>
                </div>
                
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {people.map(person => (
                    <button
                      key={person.id}
                      onClick={() => toggleAssignment(item.id, person.id)}
                      style={{
                        padding: '8px 12px',
                        border: 'none',
                        borderRadius: '20px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        background: item.assignedTo.includes(person.id) ? '#667eea' : '#e2e8f0',
                        color: item.assignedTo.includes(person.id) ? 'white' : '#2d3748'
                      }}
                    >
                      {person.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={() => setShowPreview(true)}
          style={{
            width: '100%',
            background: 'linear-gradient(135deg, #48bb78 0%, #38a169 100%)',
            color: 'white',
            padding: '16px',
            border: 'none',
            borderRadius: '12px',
            fontWeight: 'bold',
            fontSize: '18px',
            cursor: 'pointer',
            boxShadow: '0 10px 30px rgba(72, 187, 120, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          <Send style={{ width: '24px', height: '24px' }} />
          Ver Resumen y Enviar
        </button>
      </div>
    </div>
  );
}

export default BillSplitter;