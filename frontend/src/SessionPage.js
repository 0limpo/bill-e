import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
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
  const [appliedCorrections, setAppliedCorrections] = useState(new Set());
  const [totalConfirmed, setTotalConfirmed] = useState(false);
  const [confirmedSubtotal, setConfirmedSubtotal] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState(1);

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

  // Pre-llenar confirmedSubtotal con subtotal del OCR
  useEffect(() => {
    if (sessionData && confirmedSubtotal === null) {
      // Prioridad 1: Subtotal del OCR (si está disponible)
      if (sessionData.subtotal && sessionData.subtotal > 0) {
        setConfirmedSubtotal(sessionData.subtotal);
      }
      // Prioridad 2: Suma de items (solo si no hay subtotal del OCR)
      else if (sessionData.items && sessionData.items.length > 0) {
        const itemsSum = sessionData.items.reduce((sum, item) => sum + item.price, 0);
        setConfirmedSubtotal(itemsSum);
      }
    }
  }, [sessionData, confirmedSubtotal]);

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

        console.log('Items después de cargar:', data.items.map(i => ({
          name: i.name,
          quantity: i.quantity,
          duplicates_found: i.duplicates_found,
          price: i.price,
          group_total: i.group_total
        })));

        // Inicializar assignments vacío (usar items directamente del backend)
        const initialAssignments = {};
        data.items.forEach(item => {
          initialAssignments[item.name] = [];
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

  const getItemsSum = () => {
    if (!sessionData?.items) return 0;
    return sessionData.items.reduce((sum, item) => {
      const price = item.price || 0;
      const quantity = item.quantity || 1;
      return sum + (price * quantity);
    }, 0);
  };

  const getCurrentSubtotal = () => {
    if (!sessionData) return 0;

    // PRIORIZAR subtotal del OCR si está disponible
    if (sessionData.subtotal && sessionData.subtotal > 0) {
      return sessionData.subtotal;  // ✅ Usar subtotal del OCR
    }

    // Fallback: calcular desde items solo si no hay subtotal del OCR
    return getItemsSum();
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

  const getCalculatedSubtotal = () => {
    if (!sessionData?.items) return 0;

    // Usar subtotal del OCR si está disponible
    if (sessionData.subtotal && sessionData.subtotal > 0) {
      return sessionData.subtotal;
    }

    // Fallback: suma de items
    return getItemsSum();
  };

  const calculateSubtotalDifference = () => {
    if (!confirmedSubtotal) return 0;
    return confirmedSubtotal - getItemsSum();
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

  const applyCorrection = (correction, correctionIndex) => {
    const newItems = [...sessionData.items];
    const item = newItems[correction.item_index];

    if (item) {
      item.price = correction.suggested_price;

      setSessionData({
        ...sessionData,
        items: newItems
      });

      // Marcar como aplicada
      setAppliedCorrections(prev => new Set([...prev, correctionIndex]));

      // Recalcular montos
      calculatePersonAmounts(assignments);
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

  return (
    <div className="app">
      <div className="container">
        <div className="header">
          <h1>Dividir Cuenta</h1>
          {timeLeft && (
            <p className="timer">Sesión expira en: {timeLeft}</p>
          )}
        </div>

        {sessionData && !totalConfirmed && (
          <div style={{
            padding: '20px',
            backgroundColor: '#e6f3ff',
            borderRadius: '12px',
            marginBottom: '20px',
            border: '2px solid #3182ce'
          }}>
            <h3 style={{ marginTop: 0, color: '#2c5282' }}>
              📋 Confirma el subtotal de la boleta
            </h3>
            <p style={{ color: '#4a5568', marginBottom: '16px' }}>
              {sessionData.items && sessionData.items.length > 0
                ? `Hemos calculado ${formatCurrency(getCalculatedSubtotal())} desde los items. Confirma o modifica:`
                : 'Ingresa el subtotal SIN propina que aparece en tu boleta:'
              }
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', color: '#4a5568', marginBottom: '4px' }}>
                Subtotal SIN propina:
              </label>
              <input
                type="number"
                value={confirmedSubtotal !== null ? confirmedSubtotal : ''}
                onChange={(e) => setConfirmedSubtotal(parseFloat(e.target.value) || 0)}
                style={{
                  padding: '12px',
                  fontSize: '24px',
                  fontWeight: 'bold',
                  border: '2px solid #3182ce',
                  borderRadius: '6px',
                  width: '200px'
                }}
                placeholder={`Suma items: ${getCalculatedSubtotal().toLocaleString('es-CL')}`}
              />
            </div>

            <button
              onClick={() => setTotalConfirmed(true)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#3182ce',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                cursor: 'pointer'
              }}
            >
              ✓ Confirmar subtotal
            </button>
          </div>
        )}

        <div className="summary-card">
          <div className="summary-row">
            <div className="summary-item">
              <span className="label">Subtotal</span>
              <span className="amount">{formatCurrency(getCurrentSubtotal())}</span>
              {sessionData.subtotal && sessionData.subtotal > 0 && (() => {
                const itemsSum = getItemsSum();
                const diff = Math.abs(sessionData.subtotal - itemsSum);
                const diffPercent = (diff / sessionData.subtotal * 100).toFixed(1);

                if (diff > sessionData.subtotal * 0.05) {  // Si diferencia > 5%
                  return (
                    <div style={{
                      fontSize: '12px',
                      color: '#d69e2e',
                      marginTop: '4px'
                    }}>
                      ⚠️ OCR: {formatCurrency(sessionData.subtotal)} | Items: {formatCurrency(itemsSum)} | Dif: {diffPercent}%
                    </div>
                  );
                }
                return null;
              })()}
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

        {totalConfirmed && confirmedSubtotal && (
          <div style={{
            padding: '16px',
            backgroundColor: calculateSubtotalDifference() === 0 ? '#d4edda' : '#fff3cd',
            borderRadius: '8px',
            marginBottom: '20px',
            border: `1px solid ${calculateSubtotalDifference() === 0 ? '#28a745' : '#ffc107'}`
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span>Subtotal confirmado:</span>
              <strong>${confirmedSubtotal.toLocaleString('es-CL')}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span>Subtotal calculado (suma items):</span>
              <strong>${getItemsSum().toLocaleString('es-CL')}</strong>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              color: (() => {
                const diff = Math.abs(calculateSubtotalDifference());
                const diffPercent = confirmedSubtotal > 0 ? (diff / confirmedSubtotal) * 100 : 0;
                return diff === 0 ? '#155724' : '#856404';
              })(),
              fontWeight: 'bold'
            }}>
              <span>Diferencia:</span>
              <span>
                {(() => {
                  const diff = Math.abs(calculateSubtotalDifference());
                  const diffPercent = confirmedSubtotal > 0 ? (diff / confirmedSubtotal) * 100 : 0;

                  if (diff === 0) {
                    return '✅ ¡Coincide!';
                  } else {
                    return `⚠️ $${diff.toLocaleString('es-CL')} (${diffPercent.toFixed(1)}%)`;
                  }
                })()}
              </span>
            </div>
          </div>
        )}

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
              {sessionData.items.map((item, index) => {
                // Buscar si hay corrección sugerida para este item
                const correction = sessionData?.validation?.corrections?.find(
                  c => c.item_index === index && !appliedCorrections.has(sessionData.validation.corrections.indexOf(c))
                );

                const isEditing = editingItems[item.name];

                return (
                  <div key={item.id || index} className="item-card" style={{
                    backgroundColor: correction ? '#fff3cd' : 'white'
                  }}>
                    <div className="item-info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {isEditing ? (
                          <input
                            type="text"
                            value={item.name}
                            onChange={(e) => handleItemEdit(item.name, 'name', e.target.value)}
                            style={{ flex: 1, padding: '4px', border: '1px solid #cbd5e0', borderRadius: '4px' }}
                          />
                        ) : (
                          <>
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => {
                                const newQuantity = parseInt(e.target.value) || 1;
                                // ✅ Solo actualizar quantity, NO modificar price (que es unitario)
                                const newItems = sessionData.items.map(i =>
                                  i === item
                                    ? { ...i, quantity: newQuantity }
                                    : i
                                );
                                setSessionData({ ...sessionData, items: newItems });
                              }}
                              style={{
                                width: '40px',
                                padding: '4px',
                                textAlign: 'center',
                                border: '1px solid #cbd5e0',
                                borderRadius: '4px'
                              }}
                              min="1"
                            />
                            <span>×</span>
                            <strong>{item.name}</strong>
                          </>
                        )}
                      </div>

                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => handleItemEdit(item.name, 'quantity', parseInt(e.target.value))}
                            style={{ width: '60px', padding: '4px', border: '1px solid #cbd5e0', borderRadius: '4px' }}
                          />
                          <span>×</span>
                          <input
                            type="number"
                            value={Math.round(item.price / item.quantity)}
                            onChange={(e) => {
                              const unitPrice = parseFloat(e.target.value) || 0;
                              handleItemEdit(item.name, 'price', unitPrice * item.quantity);
                            }}
                            style={{ width: '100px', padding: '4px', border: '1px solid #cbd5e0', borderRadius: '4px' }}
                          />
                          <span>=</span>
                          <span style={{ fontWeight: 'bold' }}>{formatCurrency(item.price)}</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="item-price">{formatCurrency(item.price)}</span>

                          {correction && (
                            <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
                              <span style={{ fontSize: '12px', color: '#856404' }}>
                                Sugerido: {formatCurrency(correction.suggested_price)}
                              </span>
                              <button
                                onClick={() => {
                                  applyCorrection(correction, sessionData.validation.corrections.indexOf(correction));
                                }}
                                style={{
                                  padding: '2px 8px',
                                  fontSize: '11px',
                                  backgroundColor: '#28a745',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: 'pointer'
                                }}
                              >
                                ✓
                              </button>
                              <button
                                onClick={() => {
                                  setAppliedCorrections(prev => new Set([...prev, sessionData.validation.corrections.indexOf(correction)]));
                                }}
                                style={{
                                  padding: '2px 8px',
                                  fontSize: '11px',
                                  backgroundColor: '#6c757d',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '3px',
                                  cursor: 'pointer'
                                }}
                              >
                                ✗
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      className="edit-button"
                      onClick={() => toggleItemEdit(item.name)}
                      style={{ alignSelf: 'flex-start', marginTop: '8px' }}
                    >
                      {isEditing ? '💾' : '✏️'}
                    </button>

                    <button
                      onClick={() => {
                        if (window.confirm(`¿Eliminar "${item.name}"?`)) {
                          const newItems = sessionData.items.filter(i => i !== item);
                          setSessionData({ ...sessionData, items: newItems });
                        }
                      }}
                      style={{
                        padding: '6px 10px',
                        backgroundColor: '#e53e3e',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        alignSelf: 'flex-start',
                        marginTop: '8px'
                      }}
                      title="Eliminar item"
                    >
                      🗑️
                    </button>

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
                );
              })}
            </div>

            <div style={{
              padding: '16px',
              backgroundColor: '#f0fff4',
              borderRadius: '8px',
              marginTop: '16px',
              border: '1px dashed #38a169'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '12px', color: '#276749' }}>
                ➕ Agregar item manualmente
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  type="number"
                  placeholder="Cant."
                  value={newItemQuantity}
                  onChange={(e) => setNewItemQuantity(parseInt(e.target.value) || 1)}
                  style={{ width: '60px', padding: '8px', border: '1px solid #cbd5e0', borderRadius: '4px' }}
                  min="1"
                />
                <input
                  type="text"
                  placeholder="Nombre del item"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  style={{ flex: 1, minWidth: '150px', padding: '8px', border: '1px solid #cbd5e0', borderRadius: '4px' }}
                />
                <input
                  type="number"
                  placeholder="Precio unitario"
                  value={newItemPrice}
                  onChange={(e) => setNewItemPrice(e.target.value)}
                  style={{ width: '120px', padding: '8px', border: '1px solid #cbd5e0', borderRadius: '4px' }}
                />
                <button
                  onClick={() => {
                    if (newItemName && newItemPrice) {
                      const unitPrice = parseFloat(newItemPrice) || 0;
                      const newItem = {
                        id: `item-manual-${Date.now()}`,
                        name: newItemName,
                        price: unitPrice * newItemQuantity,
                        quantity: newItemQuantity,
                        assigned_to: []
                      };
                      setSessionData({
                        ...sessionData,
                        items: [...sessionData.items, newItem]
                      });
                      setNewItemName('');
                      setNewItemPrice('');
                      setNewItemQuantity(1);
                    }
                  }}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#38a169',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Agregar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SessionPage;
