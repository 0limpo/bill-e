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
  const [tipPercentage, setTipPercentage] = useState(10);
  const [customTipAmount, setCustomTipAmount] = useState('');
  const [editingItems, setEditingItems] = useState({});
  const [timeLeft, setTimeLeft] = useState(null);

  // Timer para mostrar tiempo restante
  useEffect(() => {
    if (sessionData?.expires_at) {
      const updateTimer = () => {
        const now = new Date();
        const expiresAt = new Date(sessionData.expires_at);
        const diff = expiresAt - now;
        
        if (diff > 0) {
          const hours = Math.floor(diff / 3600000);
          const minutes = Math.floor((diff % 3600000) / 60000);
          const seconds = Math.floor((diff % 60000) / 1000);
          
          if (hours > 0) {
            setTimeLeft(`${hours}h ${minutes}m`);
          } else if (minutes > 0) {
            setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);
          } else {
            setTimeLeft(`${seconds}s`);
          }
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
    const sessionId = id;
    
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
      
      // Calcular propina inicial (10% del subtotal)
      const initialTip = data.subtotal * 0.1;
      setCustomTipAmount(Math.round(initialTip).toString());
      
      // Inicializar personas vacío por defecto
      if (data.items && data.items.length > 0) {
        setPeople([]);
        
        // Consolidar items por nombre (para manejar duplicados)
        const consolidatedItems = {};
        data.items.forEach(item => {
          if (consolidatedItems[item.name]) {
            consolidatedItems[item.name].quantity += 1;
            consolidatedItems[item.name].price += item.price;
          } else {
            consolidatedItems[item.name] = {
              name: item.name,
              quantity: 1,
              price: item.price,
              unitPrice: item.price
            };
          }
        });
        
        // Actualizar sessionData con items consolidados
        setSessionData(prev => ({
          ...prev,
          items: Object.values(consolidatedItems)
        }));
        
        // Inicializar assignments vacío
        const initialAssignments = {};
        Object.keys(consolidatedItems).forEach(itemName => {
          initialAssignments[itemName] = [];
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
      calculatePersonAmounts(assignments);
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
    calculatePersonAmounts(updatedAssignments);
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
    if (!sessionData || people.length === 0) return;
    
    const totalTip = parseFloat(customTipAmount) || 0;
    
    const updatedPeople = people.map(person => {
      let subtotalAmount = 0;
      
      Object.entries(currentAssignments).forEach(([itemName, assignedPeople]) => {
        if (assignedPeople.includes(person.name)) {
          const item = sessionData.items.find(i => i.name === itemName);
          if (item && assignedPeople.length > 0) {
            subtotalAmount += item.price / assignedPeople.length;
          }
        }
      });
      
      // Calcular propina proporcional basada en lo que consumió
      const totalSubtotal = sessionData.subtotal;
      const personTipRatio = totalSubtotal > 0 ? subtotalAmount / totalSubtotal : 1 / people.length;
      const personTip = totalTip * personTipRatio;
      
      return {
        ...person,
        amount: subtotalAmount + personTip
      };
    });
    
    setPeople(updatedPeople);
  };

  const splitEqually = () => {
    if (sessionData && people.length > 0) {
      const totalAmount = getCurrentTotal();
      const amountPerPerson = totalAmount / people.length;
      
      setPeople(people.map(person => ({
        ...person,
        amount: amountPerPerson
      })));
    }
  };

  const getCurrentSubtotal = () => {
    if (!sessionData) return 0;
    return sessionData.items.reduce((sum, item) => sum + item.price, 0);
  };

  const getCurrentTip = () => {
    if (customTipAmount) {
      return parseFloat(customTipAmount) || 0;
    }
    return getCurrentSubtotal() * tipPercentage / 100;
  };

  const getCurrentTotal = () => {
    return getCurrentSubtotal() + getCurrentTip();
  };

  const handleTipPercentageChange = (e) => {
    const percentage = parseFloat(e.target.value) || 0;
    setTipPercentage(percentage);
    setCustomTipAmount(''); // Clear custom amount when using percentage
    calculatePersonAmounts(assignments);
  };

  const handleTipAmountChange = (e) => {
    const amount = e.target.value;
    setCustomTipAmount(amount);
    calculatePersonAmounts(assignments);
  };

  const handleItemEdit = (itemName, field, value) => {
    setSessionData(prev => ({
      ...prev,
      items: prev.items.map(item => {
        if (item.name === itemName) {
          const updatedItem = { ...item };
          if (field === 'price') {
            updatedItem.price = parseFloat(value) || 0;
          } else if (field === 'quantity') {
            updatedItem.quantity = parseInt(value) || 1;
            updatedItem.price = updatedItem.unitPrice * updatedItem.quantity;
          } else if (field === 'name') {
            updatedItem.name = value;
          }
          return updatedItem;
        }
        return item;
      })
    }));
    calculatePersonAmounts(assignments);
  };

  const toggleItemEdit = (itemName) => {
    setEditingItems(prev => ({
      ...prev,
      [itemName]: !prev[itemName]
    }));
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
        <small>La sesión puede haber expirado (2 horas de validez)</small>
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
              <span className="amount">{formatCurrency(getCurrentSubtotal())}</span>
            </div>
            <div className="summary-item">
              <span className="label">Propina</span>
              <div className="tip-controls">
                <div className="tip-input-group">
                  <input
                    type="number"
                    value={tipPercentage}
                    onChange={handleTipPercentageChange}
                    className="tip-percentage-input"
                    min="0"
                    max="30"
                  />
                  <span className="tip-percentage-label">%</span>
                </div>
                <span className="tip-or">o</span>
                <input
                  type="number"
                  value={customTipAmount}
                  onChange={handleTipAmountChange}
                  placeholder="Monto"
                  className="tip-amount-input"
                />
              </div>
              <span className="amount tip">{formatCurrency(getCurrentTip())}</span>
            </div>
            <div className="summary-item">
              <span className="label">Total</span>
              <span className="amount total">{formatCurrency(getCurrentTotal())}</span>
            </div>
          </div>
        </div>

        <div className="people-section">
          <div className="section-header">
            <h3>Personas ({people.length})</h3>
            {people.length > 0 && (
              <button className="divide-equal-btn" onClick={splitEqually}>
                Dividir Todo Igual
              </button>
            )}
          </div>
          
          {people.length > 0 && (
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
          )}

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
              {sessionData.items.map((item, index) => (
                <div key={index} className="item-card">
                  <div className="item-info">
                    <div className="item-name-section">
                      {editingItems[item.name] ? (
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => handleItemEdit(item.name, 'name', e.target.value)}
                          className="edit-item-input"
                        />
                      ) : (
                        <span className="item-name">
                          {item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                        </span>
                      )}
                      <button 
                        className="edit-item-btn"
                        onClick={() => toggleItemEdit(item.name)}
                      >
                        {editingItems[item.name] ? '💾' : '✏️'}
                      </button>
                    </div>
                    <div className="item-price-section">
                      {editingItems[item.name] ? (
                        <div className="edit-price-controls">
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => handleItemEdit(item.name, 'quantity', e.target.value)}
                            className="edit-quantity-input"
                            min="1"
                          />
                          <span>×</span>
                          <input
                            type="number"
                            value={Math.round(item.price / item.quantity)}
                            onChange={(e) => {
                              const unitPrice = parseFloat(e.target.value) || 0;
                              handleItemEdit(item.name, 'price', unitPrice * item.quantity);
                            }}
                            className="edit-unit-price-input"
                          />
                        </div>
                      ) : null}
                      <span className="item-price">{formatCurrency(item.price)}</span>
                    </div>
                  </div>
                  {people.length > 0 && (
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
                  )}
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