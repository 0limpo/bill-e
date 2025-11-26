import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams } from 'react-router-dom';
import './App.css';

function SessionPage() {
  const { id } = useParams();
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [people, setPeople] = useState([]);
  const [newPersonName, setNewPersonName] = useState('');
  const [assignments, setAssignments] = useState({});
  const [tipPercentage, setTipPercentage] = useState(15);
  const [timeLeft, setTimeLeft] = useState(null);

  // Timer para mostrar tiempo restante
  useEffect(() => {
    if (sessionData?.expires_at) {
      const updateTimer = () => {
        const now = new Date();
        const expiresAt = new Date(sessionData.expires_at * 1000);
        const diff = expiresAt - now;
        
        if (diff > 0) {
          const minutes = Math.floor(diff / 60000);
          const seconds = Math.floor((diff % 60000) / 1000);
          setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);
        } else {
          setTimeLeft('Expirado');
        }
      };
      
      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    }
  }, [sessionData]);

  useEffect(() => {
    const sessionId = id; // Usar ID completo en lugar de split
    
    if (sessionId) {
      loadSessionData(sessionId);
    }
  }, []);

  const loadSessionData = async (sessionId) => {
    try {
      setLoading(true);
      const response = await fetch(`https://bill-e-backend-lfwp.onrender.com/api/session/${sessionId}`);
      
      if (!response.ok) {
        throw new Error('Sesión no encontrada o expirada');
      }
      
      const data = await response.json();
      setSessionData(data);
      
      // Inicializar personas vacío por defecto
      if (data.items && data.items.length > 0) {
        setPeople([]); // Empezar sin personas
        
        // Inicializar assignments vacío
        const initialAssignments = {};
        data.items.forEach(item => {
          initialAssignments[item.name] = [];
        });
        setAssignments(initialAssignments);
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const addPerson = () => {
    if (newPersonName.trim() && !people.find(p => p.name === newPersonName.trim())) {
      setPeople([...people, { name: newPersonName.trim(), amount: 0 }]);
      setNewPersonName('');
    }
  };

  const removePerson = (nameToRemove) => {
    setPeople(people.filter(p => p.name !== nameToRemove));
    // Remover de todas las asignaciones
    const updatedAssignments = { ...assignments };
    Object.keys(updatedAssignments).forEach(item => {
      updatedAssignments[item] = updatedAssignments[item].filter(name => name !== nameToRemove);
    });
    setAssignments(updatedAssignments);
  };

  const toggleItemAssignment = (itemName, personName) => {
    const currentAssignments = assignments[itemName] || [];
    const isAssigned = currentAssignments.includes(personName);
    
    const updatedAssignments = {
      ...assignments,
      [itemName]: isAssigned 
        ? currentAssignments.filter(name => name !== personName)
        : [...currentAssignments, personName]
    };
    
    setAssignments(updatedAssignments);
    calculatePersonAmounts(updatedAssignments);
  };

  const calculatePersonAmounts = (currentAssignments) => {
    const updatedPeople = people.map(person => {
      let totalAmount = 0;
      
      Object.entries(currentAssignments).forEach(([itemName, assignedPeople]) => {
        if (assignedPeople.includes(person.name)) {
          const item = sessionData.items.find(i => i.name === itemName);
          if (item && assignedPeople.length > 0) {
            totalAmount += item.price / assignedPeople.length;
          }
        }
      });
      
      // Agregar propina proporcional
      const tipAmount = (totalAmount * tipPercentage) / 100;
      
      return {
        ...person,
        amount: totalAmount + tipAmount
      };
    });
    
    setPeople(updatedPeople);
  };

  const splitEqually = () => {
    if (sessionData && people.length > 0) {
      const totalWithTip = sessionData.total * (1 + tipPercentage / 100);
      const amountPerPerson = totalWithTip / people.length;
      
      setPeople(people.map(person => ({
        ...person,
        amount: amountPerPerson
      })));
    }
  };

  if (loading) {
    return <div className="loading">Cargando sesión...</div>;
  }

  if (error) {
    return (
      <div className="error-container">
        <div className="error-icon">⚠️</div>
        <h2>Error</h2>
        <p>{error}</p>
        <small>La sesión puede haber expirado (1 hora de validez)</small>
      </div>
    );
  }

  if (!sessionData) {
    return <div className="error-container">No se pudo cargar la sesión</div>;
  }

  const formatCurrency = (amount) => {
    return `$${Math.round(amount).toLocaleString('es-CL')}`;
  };

  return (
    <div className="app">
      <div className="container">
        <div className="header">
          <h1>Dividir Cuenta</h1>
          {timeLeft && (
            <p className="timer">Sesión expira en: {timeLeft}</p>
          )}
        </div>

        <div className="summary-card">
          <div className="summary-row">
            <div className="summary-item">
              <span className="label">Subtotal</span>
              <span className="amount">{formatCurrency(sessionData.subtotal)}</span>
            </div>
            <div className="summary-item">
              <span className="label">Propina ({tipPercentage}%)</span>
              <span className="amount tip">{formatCurrency(sessionData.subtotal * tipPercentage / 100)}</span>
            </div>
            <div className="summary-item">
              <span className="label">Total</span>
              <span className="amount total">{formatCurrency(sessionData.subtotal * (1 + tipPercentage / 100))}</span>
            </div>
          </div>

          <div className="tip-controls">
            <span>Ajustar propina:</span>
            <div className="tip-buttons">
              {[10, 15, 20, 25].map(percentage => (
                <button
                  key={percentage}
                  className={`tip-btn ${tipPercentage === percentage ? 'active' : ''}`}
                  onClick={() => {
                    setTipPercentage(percentage);
                    calculatePersonAmounts(assignments);
                  }}
                >
                  {percentage}%
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="people-section">
          <div className="section-header">
            <h3>Personas ({people.length})</h3>
            <button className="divide-equal-btn" onClick={splitEqually}>
              Dividir Todo Igual
            </button>
          </div>
          
          <div className="people-grid">
            {people.map(person => (
              <div key={person.name} className="person-card">
                <div className="person-header">
                  <span className="person-name">{person.name}</span>
                  <button 
                    className="remove-btn"
                    onClick={() => removePerson(person.name)}
                  >
                    ×
                  </button>
                </div>
                <div className="person-amount">{formatCurrency(person.amount)}</div>
              </div>
            ))}
          </div>

          <div className="add-person">
            <input
              type="text"
              value={newPersonName}
              onChange={(e) => setNewPersonName(e.target.value)}
              placeholder="Nombre de la persona"
              onKeyPress={(e) => e.key === 'Enter' && addPerson()}
            />
            <button onClick={addPerson}>Agregar</button>
          </div>
        </div>

        {sessionData.items && sessionData.items.length > 0 && (
          <div className="items-section">
            <h3>Items de la cuenta</h3>
            <div className="items-list">
              {sessionData.items.map(item => (
                <div key={item.name} className="item-card">
                  <div className="item-info">
                    <span className="item-name">{item.name}</span>
                    <span className="item-price">{formatCurrency(item.price)}</span>
                  </div>
                  <div className="item-assignments">
                    {people.map(person => (
                      <button
                        key={person.name}
                        className={`assignment-btn ${
                          assignments[item.name]?.includes(person.name) ? 'assigned' : ''
                        }`}
                        onClick={() => toggleItemAssignment(item.name, person.name)}
                      >
                        {person.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/s/:id" element={<SessionPage />} />
        <Route path="/" element={<div>Bill-e - Dividir cuentas fácilmente</div>} />
      </Routes>
    </Router>
  );
}

export default App;
// Updated