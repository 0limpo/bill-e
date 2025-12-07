import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams } from 'react-router-dom';
import './App.css';
import {
  trackPageView,
  trackSessionLoad,
  trackPersonAdded,
  trackItemAssignment,
  trackCalculationComplete,
  trackTipChange,
  trackItemEdit,
  trackError,
  trackFunnelStep,
  trackEngagement
} from './analytics';

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

  // Track page view and engagement time
  useEffect(() => {
    if (id) {
      // Track page view
      trackPageView(`/s/${id}`, `Session ${id}`);
      trackFunnelStep('session_loaded', id);

      // Track engagement time on unmount
      const startTime = Date.now();
      return () => {
        const timeSpent = Math.floor((Date.now() - startTime) / 1000);
        if (timeSpent > 5) {
          trackEngagement(id, timeSpent);
        }
      };
    }
  }, [id]);

  useEffect(() => {
    const sessionId = id;

    if (sessionId) {
      loadSessionData(sessionId);
    }
  }, [id]);

  const loadSessionData = async (sessionId) => {
    const startTime = performance.now();

    try {
      setLoading(true);
      const response = await fetch(`https://bill-e-backend-lfwp.onrender.com/api/session/${sessionId}`);

      if (!response.ok) {
        throw new Error('Sesión no encontrada o expirada');
      }

      const data = await response.json();
      setSessionData(data);

      // Track session load
      const loadTime = performance.now() - startTime;
      trackSessionLoad(
        sessionId,
        data.items?.length || 0,
        data.total || 0,
        data.phone_number ? 'whatsapp' : 'web'
      );

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
      // Track error
      trackError('session_load_failed', error.message, sessionId);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const addPerson = () => {
    if (newPersonName.trim() && !people.find(p => p.name === newPersonName.trim())) {
      const newPeople = [...people, { name: newPersonName.trim(), amount: 0 }];
      setPeople(newPeople);
      setNewPersonName('');

      // Track person added
      trackPersonAdded(id, newPeople.length);
      trackFunnelStep('person_added', id, { person_count: newPeople.length });

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

    // Track item assignment (only when assigning, not unassigning)
    if (!isAssigned) {
      trackItemAssignment(id, itemName, personName);

      // Check if this is first assignment (funnel step)
      const totalAssignments = Object.values(updatedAssignments)
        .reduce((sum, arr) => sum + arr.length, 0);

      if (totalAssignments === 1) {
        trackFunnelStep('items_assigned', id, { first_assignment: itemName });
      }
    }

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
    const oldTip = customTipAmount;
    const amount = e.target.value;
    setCustomTipAmount(amount);

    // Track tip change
    if (oldTip && amount && oldTip !== amount) {
      trackTipChange(id, parseFloat(oldTip) || 0, parseFloat(amount) || 0, false);
    }

    calculatePersonAmounts(assignments);
  };

  const handleItemEdit = (itemName, field, value) => {
    const oldItem = sessionData.items.find(i => i.name === itemName);
    const oldValue = oldItem ? oldItem[field] : null;

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

    // Track item edit
    if (oldValue !== value) {
      trackItemEdit(id, itemName, field, oldValue, value);
    }

    calculatePersonAmounts(assignments);
  };

  const toggleItemEdit = (itemName) => {
    setEditingItems(prev => ({
      ...prev,
      [itemName]: !prev[itemName]
    }));
  };

  const applyCorrection = (correction) => {
    const newItems = [...sessionData.items];
    const item = newItems[correction.item_index];

    if (item) {
      item.price = correction.suggested_price;

      setSessionData({
        ...sessionData,
        items: newItems
      });

      // Recalcular montos
      calculatePersonAmounts(assignments);

      alert(`✅ Corrección aplicada: ${item.name} ahora cuesta $${correction.suggested_price.toLocaleString('es-CL')}`);
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

  // Componente de indicador de calidad
  const QualityIndicator = ({ validation }) => {
    if (!validation) return null;

    const { quality_score, quality_level, warnings } = validation;

    const getColor = () => {
      if (quality_level === 'high') return '#38a169'; // verde
      if (quality_level === 'medium') return '#ed8936'; // naranja
      return '#e53e3e'; // rojo
    };

    return (
      <div style={{
        padding: '16px',
        backgroundColor: '#f7fafc',
        borderRadius: '8px',
        marginBottom: '20px',
        border: `2px solid ${getColor()}`
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: getColor()
          }}>
            {quality_score}/100
          </div>
          <div>
            <div style={{ fontWeight: 'bold' }}>Calidad del escaneo</div>
            <div style={{ fontSize: '14px', color: '#718096' }}>
              {quality_level === 'high' && '✅ Excelente'}
              {quality_level === 'medium' && '⚠️ Aceptable - Revisa los datos'}
              {quality_level === 'low' && '❌ Baja - Verifica manualmente'}
            </div>
          </div>
        </div>

        {warnings && warnings.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            {warnings.map((warning, i) => (
              <div key={i} style={{
                padding: '8px',
                backgroundColor: warning.severity === 'high' ? '#fed7d7' : '#feebc8',
                borderRadius: '4px',
                fontSize: '14px',
                marginTop: '4px'
              }}>
                {warning.severity === 'high' ? '🔴' : '🟡'} {warning.message}
              </div>
            ))}
          </div>
        )}

        {validation.corrections && validation.corrections.length > 0 && (
          <div style={{ marginTop: '12px', fontSize: '14px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>💡 Correcciones sugeridas:</div>
            {validation.corrections.map((corr, i) => (
              <div key={i} style={{ color: '#2d3748' }}>
                • {corr.item_name}: ${corr.original_price.toLocaleString('es-CL')} → ${corr.suggested_price.toLocaleString('es-CL')}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const CorrectionButtons = ({ corrections, onApplyCorrection }) => {
    if (!corrections || corrections.length === 0) return null;

    return (
      <div style={{
        padding: '16px',
        backgroundColor: '#fff3cd',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #ffc107'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '12px' }}>
          💡 Correcciones automáticas disponibles:
        </div>
        {corrections.map((corr, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px',
            backgroundColor: 'white',
            borderRadius: '4px',
            marginBottom: '8px'
          }}>
            <div>
              <strong>{corr.item_name}</strong>
              <div style={{ fontSize: '14px', color: '#666' }}>
                ${corr.original_price.toLocaleString('es-CL')} → ${corr.suggested_price.toLocaleString('es-CL')}
              </div>
            </div>
            <button
              onClick={() => onApplyCorrection(corr)}
              style={{
                padding: '6px 12px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Aplicar
            </button>
          </div>
        ))}
      </div>
    );
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

        {sessionData?.validation && (
          <QualityIndicator validation={sessionData.validation} />
        )}

        {sessionData?.validation?.corrections && (
          <CorrectionButtons
            corrections={sessionData.validation.corrections}
            onApplyCorrection={applyCorrection}
          />
        )}

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
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span className="amount total">{formatCurrency(getCurrentTotal())}</span>
                {sessionData?.validation && !sessionData.validation.is_valid && (
                  <div style={{ fontSize: '12px', color: '#e53e3e', marginTop: '4px' }}>
                    Diferencia: ${sessionData.validation.total_difference?.toLocaleString('es-CL')} ({sessionData.validation.difference_percent}%)
                  </div>
                )}
              </div>
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
                        <>
                          <span className="item-name">
                            {item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                          </span>
                          {item.duplicates_found > 0 && (
                            <span style={{
                              fontSize: '12px',
                              color: '#3182ce',
                              marginLeft: '8px',
                              backgroundColor: '#bee3f8',
                              padding: '2px 6px',
                              borderRadius: '4px'
                            }}>
                              🔗 {item.duplicates_found + 1} agrupados
                            </span>
                          )}
                        </>
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