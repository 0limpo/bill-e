// CollaborativeSession.js
// Componente principal para sesiones colaborativas de Bill-e

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import './CollaborativeSession.css';

const API_URL = 'https://bill-e-backend-lfwp.onrender.com';

const formatCurrency = (amount) => {
  return `${Math.round(amount).toLocaleString('es-CL')}`;
};

// Pantalla de unirse (para editores)
const JoinScreen = ({ onJoin, isLoading }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim() && phone.trim()) {
      onJoin(name.trim(), phone.trim());
    }
  };

  return (
    <div className="join-screen">
      <div className="join-card">
        <h1>👋 ¡Únete a dividir!</h1>
        <p>Ingresa tus datos para participar en la división de la cuenta</p>

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Nombre *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre"
              required
              autoFocus
            />
          </div>

          <div className="input-group">
            <label>Teléfono * (para recibir tu total)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+56 9 1234 5678"
              required
            />
            <small>⚠️ Si el teléfono está incorrecto, no recibirás tu monto por WhatsApp.</small>
          </div>

          <button type="submit" disabled={isLoading || !name.trim() || !phone.trim()}>
            {isLoading ? 'Entrando...' : 'Entrar a la sesión'}
          </button>
        </form>
      </div>
    </div>
  );
};

// Item de la boleta
const BillItem = ({
  item,
  assignments,
  participants,
  currentParticipant,
  isOwner,
  onAssign,
  onEditItem,
  isFinalized,
  itemMode,
  onToggleMode,
  onSubItemAssign,
  isSubItemAssigned
}) => {
  // Estados para edición inline
  const [editingField, setEditingField] = useState(null); // 'name', 'price', 'quantity'
  const [tempValue, setTempValue] = useState('');

  const itemId = item.id || item.name;
  const itemAssignments = assignments[itemId] || [];
  const hasQuantity = item.quantity && item.quantity > 1;

  const totalAssigned = itemAssignments.reduce((sum, a) => sum + (a.quantity || 1), 0);
  const remaining = hasQuantity ? item.quantity - totalAssigned : null;

  const myAssignment = itemAssignments.find(a => a.participant_id === currentParticipant?.id);
  const myQuantity = myAssignment?.quantity || 0;

  // Obtener asignación de un participante específico
  const getParticipantAssignment = (participantId) => {
    return itemAssignments.find(a => a.participant_id === participantId);
  };

  // Manejar cambio de cantidad para cualquier participante
  const handleQuantityChange = (participantId, newQty) => {
    if (isFinalized) return;
    if (newQty < 0) return;

    // Verificar permisos: owner puede editar cualquiera, editor solo el suyo
    if (!isOwner && participantId !== currentParticipant?.id) return;

    // Verificar que no exceda el total disponible
    const currentParticipantQty = getParticipantAssignment(participantId)?.quantity || 0;
    const otherAssigned = totalAssigned - currentParticipantQty;

    if (newQty + otherAssigned > item.quantity) {
      return; // No permitir exceder
    }

    onAssign(itemId, participantId, newQty, newQty > 0);
  };

  const handleToggle = (participantId) => {
    if (isFinalized) return;
    if (!isOwner && participantId !== currentParticipant?.id) return;

    const isCurrentlyAssigned = itemAssignments.some(a => a.participant_id === participantId);
    onAssign(itemId, participantId, 1, !isCurrentlyAssigned);
  };

  // Iniciar edición inline
  const startEdit = (field, value) => {
    if (!isOwner || isFinalized) return;
    setEditingField(field);
    setTempValue(value.toString());
  };

  // Guardar edición inline
  const saveEdit = () => {
    if (!editingField || !onEditItem) {
      setEditingField(null);
      return;
    }

    const updates = {};
    if (editingField === 'name') {
      updates.name = tempValue || item.name;
    } else if (editingField === 'price') {
      updates.price = parseFloat(tempValue) || item.price;
    } else if (editingField === 'quantity') {
      updates.quantity = parseInt(tempValue) || item.quantity || 1;
    }

    onEditItem(itemId, updates);
    setEditingField(null);
  };

  // Cancelar edición
  const cancelEdit = () => {
    setEditingField(null);
    setTempValue('');
  };

  return (
    <div className={`bill-item ${isFinalized ? 'finalized' : ''}`}>
      <div className="item-header">
        <div className="item-info">
          {/* Cantidad del item - SIEMPRE mostrar, editable inline (solo owner) */}
          {isOwner && !isFinalized ? (
            editingField === 'quantity' ? (
              <input
                type="number"
                min="1"
                value={tempValue}
                onChange={(e) => setTempValue(e.target.value)}
                onBlur={saveEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEdit();
                  if (e.key === 'Escape') cancelEdit();
                }}
                autoFocus
                className="inline-edit-input inline-edit-qty"
              />
            ) : (
              <span
                className="item-qty editable-qty"
                onClick={() => startEdit('quantity', item.quantity || 1)}
              >
                {item.quantity || 1}x
                <span className="edit-hint"> ✏️</span>
              </span>
            )
          ) : (
            <span className="item-qty">{item.quantity || 1}x </span>
          )}

          {/* Nombre del item - editable inline */}
          {editingField === 'name' ? (
            <input
              type="text"
              value={tempValue}
              onChange={(e) => setTempValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
              autoFocus
              className="inline-edit-input inline-edit-name"
            />
          ) : (
            <span
              className={`item-name ${isOwner && !isFinalized ? 'editable-text' : ''}`}
              onClick={() => startEdit('name', item.name)}
            >
              {item.name}
              {isOwner && !isFinalized && <span className="edit-hint"> ✏️</span>}
            </span>
          )}

          {/* Precio del item - editable inline (solo owner) */}
          <div className="item-right">
            {isOwner && (
              editingField === 'price' ? (
                <input
                  type="number"
                  value={tempValue}
                  onChange={(e) => setTempValue(e.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  autoFocus
                  className="inline-edit-input inline-edit-price"
                />
              ) : (
                <span
                  className={`item-price ${!isFinalized ? 'editable-price' : ''}`}
                  onClick={() => startEdit('price', item.price)}
                >
                  {formatCurrency(item.price * (item.quantity || 1))}
                  {hasQuantity && (
                    <span className="unit-price">
                      ({formatCurrency(item.price)} c/u)
                    </span>
                  )}
                  {!isFinalized && <span className="edit-hint"> ✏️</span>}
                </span>
              )
            )}
          </div>
        </div>
      </div>

      {/* Switch Individual/Grupal - disponible para todos (una pizza puede ser compartida aunque sea 1 sola) */}
      {!isFinalized && (
        <div className="item-mode-switch">
          <span className={itemMode !== 'grupal' ? 'active' : ''}>Individual</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={itemMode === 'grupal'}
              onChange={() => onToggleMode(itemId)}
            />
            <span className="slider"></span>
          </label>
          <span className={itemMode === 'grupal' ? 'active' : ''}>Grupal</span>
        </div>
      )}

      {/* Modo Grupal: mostrar cada unidad por separado */}
      {itemMode === 'grupal' && hasQuantity ? (
        <div className="sub-items-list">
          {Array.from({ length: item.quantity }, (_, idx) => (
            <div key={idx} className="sub-item">
              <div className="sub-item-header">
                <span className="sub-item-name">{item.name} #{idx + 1}</span>
                <span className="sub-item-price">{formatCurrency(item.price)}</span>
              </div>
              <div className="sub-item-participants">
                {participants.map(p => {
                  const assigned = isSubItemAssigned(itemId, idx, p.id);
                  const canToggle = isOwner || p.id === currentParticipant?.id;
                  return (
                    <button
                      key={p.id}
                      className={`assign-btn ${assigned ? 'assigned' : ''} ${!canToggle ? 'disabled' : ''}`}
                      onClick={() => canToggle && onSubItemAssign(itemId, idx, p.id)}
                      disabled={isFinalized || !canToggle}
                    >
                      {p.name}
                      {assigned && ' ✓'}
                      {p.id === currentParticipant?.id && !assigned && ' (yo)'}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : hasQuantity ? (
        /* Modo Individual con quantity > 1: contadores por participante */
        <div className="quantity-assignments">
          {participants.map(participant => {
            const assignment = getParticipantAssignment(participant.id);
            const assignedQty = assignment?.quantity || 0;
            const canEdit = isOwner || participant.id === currentParticipant?.id;

            return (
              <div key={participant.id} className="participant-quantity-row">
                <span className="participant-name">
                  {participant.name}
                  {participant.id === currentParticipant?.id && ' (yo)'}:
                </span>
                <div className="quantity-controls">
                  <button
                    onClick={() => handleQuantityChange(participant.id, assignedQty - 1)}
                    disabled={isFinalized || !canEdit || assignedQty <= 0}
                    className="qty-btn"
                  >
                    -
                  </button>
                  <span className="qty-value">{assignedQty}</span>
                  <button
                    onClick={() => handleQuantityChange(participant.id, assignedQty + 1)}
                    disabled={isFinalized || !canEdit || remaining <= 0}
                    className="qty-btn"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}

          {remaining > 0 && (
            <div className="unassigned-info">
              {remaining} sin asignar de {item.quantity}
            </div>
          )}
        </div>
      ) : (
        /* Items con quantity = 1: botones toggle */
        <div className="simple-assignment">
          {participants.map(p => {
            const isAssigned = itemAssignments.some(a => a.participant_id === p.id);
            const canToggle = isOwner || p.id === currentParticipant?.id;

            return (
              <button
                key={p.id}
                className={`assign-btn ${isAssigned ? 'assigned' : ''} ${!canToggle ? 'disabled' : ''}`}
                onClick={() => canToggle && handleToggle(p.id)}
                disabled={isFinalized || !canToggle}
              >
                {p.name}
                {isAssigned && ' ✓'}
                {p.id === currentParticipant?.id && !isAssigned && ' (yo)'}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Resumen del editor (sin montos)
const EditorSummary = ({ items, assignments, participantId }) => {
  const myItems = [];

  Object.entries(assignments).forEach(([itemId, itemAssignments]) => {
    const myAssignment = itemAssignments.find(a => a.participant_id === participantId);
    if (myAssignment) {
      const item = items.find(i => (i.id || i.name) === itemId);
      if (item) {
        const qty = myAssignment.quantity || 1;
        const itemQty = item.quantity || 1;
        const isShared = itemAssignments.length > 1;

        let display = item.name;
        if (itemQty > 1) {
          display += ` (${qty} de ${itemQty})`;
        } else if (isShared) {
          display += ' (compartido)';
        }

        myItems.push({ name: item.name, display });
      }
    }
  });

  if (myItems.length === 0) {
    return (
      <div className="editor-summary">
        <p>📝 Aún no has marcado ningún item</p>
      </div>
    );
  }

  return (
    <div className="editor-summary">
      <h4>📝 Tu consumo registrado:</h4>
      <ul>
        {myItems.map((item, idx) => (
          <li key={idx}>{item.display}</li>
        ))}
      </ul>
    </div>
  );
};

// Vista del consolidado final (solo owner)
const FinalSummary = ({ totals, total, tip }) => {
  const generateMessage = () => {
    let msg = '🧾 *Cuenta dividida con Bill-e*\n\n';

    totals.forEach(t => {
      msg += `👤 ${t.name}: *${formatCurrency(t.total)}*\n`;
    });

    msg += `\n────────────────\n`;
    msg += `💰 Total: ${formatCurrency(total)}\n`;
    msg += `🎁 Propina incluida: ${formatCurrency(tip)}\n`;
    msg += `\n_Dividido con bill-e.app_ 🤖`;

    return msg;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generateMessage());
    alert('¡Mensaje copiado!');
  };

  const shareWhatsApp = () => {
    const msg = encodeURIComponent(generateMessage());
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  return (
    <div className="final-summary">
      <h2>📊 Cuenta Finalizada</h2>

      <div className="totals-list">
        {totals.map((t, idx) => (
          <div key={idx} className="person-total">
            <div className="person-header">
              <span className="person-name">
                {t.role === 'owner' ? '👑' : '👤'} {t.name}
              </span>
              <span className="person-amount">{formatCurrency(t.total)}</span>
            </div>

            <div className="person-details">
              {t.items.map((item, i) => (
                <div key={i} className="detail-item">
                  <span>• {item.name} {item.shared && '(compartido)'}</span>
                  <span>{formatCurrency(item.amount)}</span>
                </div>
              ))}
              <div className="detail-item tip">
                <span>• 🎁 Propina</span>
                <span>{formatCurrency(t.tip)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="summary-footer">
        <div className="total-line">
          <span>💰 Total cuenta:</span>
          <span>{formatCurrency(total)}</span>
        </div>
        <div className="total-line">
          <span>🎁 Propina incluida:</span>
          <span>{formatCurrency(tip)}</span>
        </div>
      </div>

      <div className="share-buttons">
        <button onClick={copyToClipboard} className="btn-copy">
          📋 Copiar resumen
        </button>
        <button onClick={shareWhatsApp} className="btn-whatsapp">
          📱 Compartir en WhatsApp
        </button>
      </div>
    </div>
  );
};

// Componente Principal
const CollaborativeSession = () => {
  const { id: sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const ownerToken = searchParams.get('owner');

  const [session, setSession] = useState(null);
  const [currentParticipant, setCurrentParticipant] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [timeLeft, setTimeLeft] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [ownerName, setOwnerName] = useState('');

  // Estados para edición de subtotal
  const [editingSubtotal, setEditingSubtotal] = useState(false);
  const [tempSubtotal, setTempSubtotal] = useState(0);

  // Estados para agregar participantes manualmente
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [newParticipantPhone, setNewParticipantPhone] = useState('');

  // Estados para agregar items manualmente
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemForm, setNewItemForm] = useState({ name: '', quantity: 1, price: 0 });

  // Estados para modos de items (individual/grupal)
  const [itemModes, setItemModes] = useState({});

  // Calcular suma de items (price es unitario, multiplicar por quantity)
  const calculateItemsTotal = useCallback(() => {
    if (!session?.items) return 0;
    return session.items.reduce((sum, item) => {
      return sum + ((item.price || 0) * (item.quantity || 1));
    }, 0);
  }, [session?.items]);

  // Calcular subtotal asignado (solo items que tienen asignaciones)
  const calculateAssignedTotal = useCallback(() => {
    if (!session?.items || !session?.assignments) return 0;
    let total = 0;
    Object.entries(session.assignments).forEach(([itemId, itemAssignments]) => {
      const item = session.items.find(i => (i.id || i.name) === itemId);
      if (item && itemAssignments.length > 0) {
        // price es unitario, multiplicar por quantity para el total del item
        total += (item.price || 0) * (item.quantity || 1);
      }
    });
    return total;
  }, [session?.items, session?.assignments]);

  const loadSession = useCallback(async () => {
    try {
      const url = ownerToken
        ? `${API_URL}/api/session/${sessionId}/collaborative?owner=${ownerToken}`
        : `${API_URL}/api/session/${sessionId}/collaborative`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Sesión no encontrada o expirada');
      }

      const data = await response.json();
      setSession(data);
      setIsOwner(data.is_owner);
      setLastUpdate(data.last_updated);

      if (data.is_owner) {
        const ownerParticipant = data.participants.find(p => p.role === 'owner');
        setCurrentParticipant(ownerParticipant);
      }

      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [sessionId, ownerToken]);

  const handleJoin = async (name, phone) => {
    setJoining(true);
    try {
      const response = await fetch(`${API_URL}/api/session/${sessionId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Error al unirse');
      }

      const data = await response.json();
      setCurrentParticipant(data.participant);

      await loadSession();
    } catch (err) {
      alert(err.message);
    } finally {
      setJoining(false);
    }
  };

  const handleAssign = async (itemId, participantId, quantity, isAssigned) => {
    // 1. ACTUALIZACIÓN OPTIMISTA - cambiar UI inmediatamente
    setSession(prev => {
      const currentAssignments = prev.assignments[itemId] || [];

      let newAssignments;
      if (!isAssigned) {
        // Quitar asignación
        newAssignments = currentAssignments.filter(a => a.participant_id !== participantId);
      } else {
        // Agregar o actualizar asignación
        const existingIdx = currentAssignments.findIndex(a => a.participant_id === participantId);
        if (existingIdx >= 0) {
          newAssignments = currentAssignments.map((a, i) =>
            i === existingIdx ? { ...a, quantity } : a
          );
        } else {
          newAssignments = [...currentAssignments, { participant_id: participantId, quantity }];
        }
      }

      return {
        ...prev,
        assignments: {
          ...prev.assignments,
          [itemId]: newAssignments
        }
      };
    });

    // 2. SINCRONIZAR CON SERVIDOR en background (sin await)
    fetch(`${API_URL}/api/session/${sessionId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_id: itemId,
        participant_id: participantId,
        quantity,
        is_assigned: isAssigned,
        updated_by: currentParticipant?.name || 'unknown'
      })
    }).catch(err => {
      console.error('Error sincronizando asignación:', err);
    });
  };

  const handleFinalize = async () => {
    if (!window.confirm('¿Finalizar la sesión? Los editores ya no podrán hacer cambios.')) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/session/${sessionId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_token: ownerToken })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Error al finalizar');
      }

      const data = await response.json();
      setSession(prev => ({
        ...prev,
        status: 'finalized',
        totals: data.totals
      }));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleEditItem = async (itemId, updates) => {
    try {
      // Actualizar localmente primero
      setSession(prev => ({
        ...prev,
        items: prev.items.map(item =>
          (item.id || item.name) === itemId
            ? { ...item, ...updates }
            : item
        )
      }));

      // Enviar al servidor
      await fetch(`${API_URL}/api/session/${sessionId}/update-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_token: ownerToken,
          item_id: itemId,
          updates
        })
      });
    } catch (err) {
      console.error('Error editando item:', err);
    }
  };

  const handleUpdateOwnerName = async () => {
    if (!ownerName.trim()) return;

    try {
      await fetch(`${API_URL}/api/session/${sessionId}/update-participant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_token: ownerToken,
          participant_id: currentParticipant.id,
          name: ownerName.trim()
        })
      });

      // Actualizar localmente
      setSession(prev => ({
        ...prev,
        participants: prev.participants.map(p =>
          p.id === currentParticipant.id
            ? { ...p, name: ownerName.trim() }
            : p
        )
      }));

      setCurrentParticipant(prev => ({ ...prev, name: ownerName.trim() }));
      setIsEditingName(false);
    } catch (err) {
      console.error('Error actualizando nombre:', err);
    }
  };

  // Guardar subtotal editado
  const handleSaveSubtotal = async () => {
    if (!tempSubtotal || tempSubtotal === session.subtotal) {
      setEditingSubtotal(false);
      return;
    }

    try {
      const newSubtotal = tempSubtotal;
      const tipPercentage = session.tip_percentage || 10;
      const newTip = Math.round(newSubtotal * tipPercentage / 100);
      const newTotal = newSubtotal + newTip;

      const response = await fetch(`${API_URL}/api/session/${sessionId}/update-totals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subtotal: newSubtotal,
          tip: newTip,
          total: newTotal,
          owner_token: ownerToken
        })
      });

      if (response.ok) {
        setSession(prev => ({
          ...prev,
          subtotal: newSubtotal,
          tip: newTip,
          total: newTotal
        }));
      }
    } catch (error) {
      console.error('Error actualizando subtotal:', error);
    }

    setEditingSubtotal(false);
  };

  // Agregar participante manualmente (owner)
  const handleAddParticipant = async () => {
    if (!newParticipantName.trim()) return;

    try {
      const response = await fetch(`${API_URL}/api/session/${sessionId}/add-participant-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newParticipantName.trim(),
          phone: newParticipantPhone.trim() || null,
          owner_token: ownerToken
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSession(prev => ({
          ...prev,
          participants: [...prev.participants, data.participant]
        }));
        setNewParticipantName('');
        setNewParticipantPhone('');
        setShowAddParticipant(false);
      }
    } catch (error) {
      console.error('Error agregando participante:', error);
    }
  };

  // Agregar item manualmente (owner)
  const handleAddItem = async () => {
    if (!newItemForm.name || !newItemForm.price) return;

    try {
      const response = await fetch(`${API_URL}/api/session/${sessionId}/add-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newItemForm.name,
          quantity: newItemForm.quantity,
          price: newItemForm.price,
          owner_token: ownerToken
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSession(prev => ({
          ...prev,
          items: [...prev.items, data.item]
        }));
        setShowAddItemModal(false);
        setNewItemForm({ name: '', quantity: 1, price: 0 });
      }
    } catch (error) {
      console.error('Error agregando item:', error);
    }
  };

  // Toggle modo individual/grupal para un item
  const toggleItemMode = (itemId) => {
    setItemModes(prev => ({
      ...prev,
      [itemId]: prev[itemId] === 'grupal' ? 'individual' : 'grupal'
    }));
  };

  // Verificar si un sub-item está asignado a un participante
  const isSubItemAssigned = (itemId, subIndex, participantId) => {
    const key = `${itemId}_${subIndex}`;
    const assignments = session.assignments?.[key] || [];
    return assignments.some(a => a.participant_id === participantId);
  };

  // Manejar asignación de sub-item en modo grupal
  const handleSubItemAssignment = async (itemId, subIndex, participantId) => {
    const key = `${itemId}_${subIndex}`;
    const isAssigned = isSubItemAssigned(itemId, subIndex, participantId);

    // Actualizar localmente primero (UI optimista)
    setSession(prev => {
      const newAssignments = { ...prev.assignments };
      if (!newAssignments[key]) newAssignments[key] = [];

      if (isAssigned) {
        newAssignments[key] = newAssignments[key].filter(a => a.participant_id !== participantId);
      } else {
        newAssignments[key].push({ participant_id: participantId, quantity: 1 });
      }

      return { ...prev, assignments: newAssignments };
    });

    // Luego sincronizar con backend
    try {
      await fetch(`${API_URL}/api/session/${sessionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: key,
          participant_id: participantId,
          quantity: 1,
          is_assigned: !isAssigned
        })
      });
    } catch (error) {
      console.error('Error en asignación:', error);
    }
  };

  // Polling para sincronización
  useEffect(() => {
    if (!session || !currentParticipant) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/session/${sessionId}/poll?last_update=${encodeURIComponent(lastUpdate || '')}`
        );

        if (response.ok) {
          const data = await response.json();

          if (data.has_changes) {
            setSession(prev => ({
              ...prev,
              participants: data.participants,
              assignments: data.assignments,
              status: data.status
            }));
            setLastUpdate(data.last_updated);
          }
        }
      } catch (err) {
        console.error('Error en polling:', err);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [sessionId, lastUpdate, session, currentParticipant]);

  // Timer de expiración
  useEffect(() => {
    if (!session?.expires_at) return;

    const updateTimer = () => {
      const now = new Date();
      const expires = new Date(session.expires_at);
      const diff = expires - now;

      if (diff <= 0) {
        setTimeLeft('Expirada');
        return;
      }

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
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [session?.expires_at]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Inicializar nombre del owner cuando carga la sesión
  useEffect(() => {
    if (session && isOwner) {
      const owner = session.participants.find(p => p.role === 'owner');
      if (owner && !ownerName) {
        setOwnerName(owner.name);
      }
    }
  }, [session, isOwner, ownerName]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Cargando sesión...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-screen">
        <h2>⚠️ Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!isOwner && !currentParticipant) {
    return <JoinScreen onJoin={handleJoin} isLoading={joining} />;
  }

  if (session.status === 'finalized' && !isOwner) {
    return (
      <div className="collaborative-session finalized-editor">
        <div className="header">
          <h1>✅ Sesión Finalizada</h1>
        </div>
        <div className="finalized-message">
          <p>El anfitrión ha finalizado la división.</p>
          <p>Recibirás tu monto por WhatsApp al número que proporcionaste.</p>

          <EditorSummary
            items={session.items}
            assignments={session.assignments}
            participantId={currentParticipant?.id}
          />
        </div>
      </div>
    );
  }

  if (session.status === 'finalized' && isOwner && session.totals) {
    return (
      <div className="collaborative-session">
        <div className="header">
          <h1>🧾 Bill-e</h1>
          <span className="owner-badge">👑 Anfitrión</span>
        </div>

        <FinalSummary
          totals={session.totals}
          total={session.total}
          tip={session.tip}
        />
      </div>
    );
  }

  return (
    <div className="collaborative-session">
      <div className="header">
        <div className="header-left">
          <h1>🧾 Dividir Cuenta</h1>
          {isOwner && <span className="owner-badge">👑 Anfitrión</span>}
        </div>
        <div className="header-right">
          <span className="timer">⏱️ {timeLeft}</span>
        </div>
      </div>

      <div className="section participants-section">
        <h3>👥 Participantes ({session.participants.length})</h3>
        <div className="participants-list">
          {session.participants.map(p => (
            <span
              key={p.id}
              className={`participant-tag ${p.id === currentParticipant?.id ? 'current' : ''}`}
            >
              {p.role === 'owner' ? '👑' : '👤'}{' '}

              {/* Si es owner y está editando su nombre - inline sin botones */}
              {p.id === currentParticipant?.id && isOwner && isEditingName ? (
                <input
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  onBlur={handleUpdateOwnerName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleUpdateOwnerName();
                    if (e.key === 'Escape') {
                      setOwnerName(p.name);
                      setIsEditingName(false);
                    }
                  }}
                  className="input-name-inline"
                  autoFocus
                />
              ) : (
                <span
                  className={p.id === currentParticipant?.id && isOwner ? 'editable-name' : ''}
                  onClick={() => {
                    if (p.id === currentParticipant?.id && isOwner) {
                      setOwnerName(p.name);
                      setIsEditingName(true);
                    }
                  }}
                >
                  {p.name}
                  {p.id === currentParticipant?.id && ' (tú)'}
                  {p.id === currentParticipant?.id && isOwner && <span className="edit-hint"> ✏️</span>}
                </span>
              )}
            </span>
          ))}
          {isOwner && (
            <button
              onClick={() => setShowAddParticipant(true)}
              className="add-participant-btn"
            >
              + Agregar
            </button>
          )}
        </div>
      </div>

      {isOwner && (
        <div className="section summary-section sticky-summary">
          <div className="summary-row">
            <span>📝 Subtotal confirmado:</span>
            {editingSubtotal ? (
              <input
                type="number"
                value={tempSubtotal}
                onChange={(e) => setTempSubtotal(parseInt(e.target.value) || 0)}
                onBlur={() => handleSaveSubtotal()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveSubtotal();
                  if (e.key === 'Escape') setEditingSubtotal(false);
                }}
                autoFocus
                className="edit-subtotal-input"
              />
            ) : (
              <span
                className="editable-value"
                onClick={() => {
                  setTempSubtotal(session.subtotal || 0);
                  setEditingSubtotal(true);
                }}
              >
                {formatCurrency(session.subtotal)}
                <span className="edit-hint"> ✏️</span>
              </span>
            )}
          </div>
          {/* Subtotal calculado con validación visual */}
          {(() => {
            const calculado = calculateItemsTotal();
            const confirmado = session.subtotal || 0;
            const diferencia = Math.abs(confirmado - calculado);
            const coincide = diferencia < 100; // Tolerancia de $100

            return (
              <div className={`summary-row calculated ${coincide ? 'match' : 'mismatch'}`}>
                <div className="calculated-header">
                  <span>📋 Subtotal calculado:</span>
                  <span className={coincide ? 'success' : 'warning'}>
                    {formatCurrency(calculado)}
                    {coincide ? ' ✅' : ' ⚠️'}
                  </span>
                </div>
                {coincide ? (
                  <small className="validation-message success">Boleta leída correctamente</small>
                ) : (
                  <small className="validation-message warning">
                    La suma no coincide (dif: {formatCurrency(diferencia)}). Revisa los items y/o precios.
                  </small>
                )}
              </div>
            );
          })()}
          <div className="summary-row assigned">
            <span>✅ Subtotal asignado:</span>
            <span className={calculateAssignedTotal() < calculateItemsTotal() ? 'warning-assigned' : 'complete-assigned'}>
              {formatCurrency(calculateAssignedTotal())}
              {calculateAssignedTotal() < calculateItemsTotal() && (
                <span className="pending-text">
                  {' '}(faltan: {formatCurrency(calculateItemsTotal() - calculateAssignedTotal())})
                </span>
              )}
            </span>
          </div>
          <div className="summary-row">
            <span>🎁 Propina ({session.tip_percentage || 10}%):</span>
            <span>{formatCurrency(session.tip)}</span>
          </div>
          <div className="summary-row total">
            <span>💰 Total:</span>
            <span>{formatCurrency(session.total)}</span>
          </div>
        </div>
      )}

      <div className="section items-section">
        <h3>📋 Items - Marca lo que consumiste</h3>

        {session.items.map((item, idx) => (
          <BillItem
            key={item.id || idx}
            item={item}
            assignments={session.assignments}
            participants={session.participants}
            currentParticipant={currentParticipant}
            isOwner={isOwner}
            onAssign={handleAssign}
            onEditItem={handleEditItem}
            isFinalized={session.status === 'finalized'}
            itemMode={itemModes[item.id || item.name]}
            onToggleMode={toggleItemMode}
            onSubItemAssign={handleSubItemAssignment}
            isSubItemAssigned={isSubItemAssigned}
          />
        ))}

        {/* Botón para agregar item manualmente (solo owner) */}
        {isOwner && !session.status?.includes('finalized') && (
          <div className="add-item-section">
            <button
              className="btn-add-item"
              onClick={() => setShowAddItemModal(true)}
            >
              ➕ Agregar item manualmente
            </button>
          </div>
        )}
      </div>

      {!isOwner && (
        <div className="section editor-footer">
          <EditorSummary
            items={session.items}
            assignments={session.assignments}
            participantId={currentParticipant?.id}
          />
          <p className="waiting-message">⏳ Esperando que el anfitrión finalice...</p>
        </div>
      )}

      {isOwner && (
        <div className="section owner-footer">
          <button className="btn-finalize" onClick={handleFinalize}>
            🔒 Finalizar y Ver Totales
          </button>
          <p className="finalize-hint">Los editores ya no podrán hacer cambios</p>
        </div>
      )}

      {/* Modal para agregar participante */}
      {showAddParticipant && (
        <div className="modal-overlay" onClick={() => setShowAddParticipant(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Agregar participante</h3>
            <input
              type="text"
              value={newParticipantName}
              onChange={(e) => setNewParticipantName(e.target.value)}
              placeholder="Nombre *"
              autoFocus
            />
            <input
              type="tel"
              value={newParticipantPhone}
              onChange={(e) => setNewParticipantPhone(e.target.value)}
              placeholder="Teléfono (opcional)"
            />
            <div className="modal-actions">
              <button onClick={() => setShowAddParticipant(false)}>Cancelar</button>
              <button onClick={handleAddParticipant} disabled={!newParticipantName.trim()}>
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para agregar item */}
      {showAddItemModal && (
        <div className="modal-overlay" onClick={() => setShowAddItemModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Agregar item</h3>
            <div className="input-group">
              <label>Nombre:</label>
              <input
                type="text"
                value={newItemForm.name}
                onChange={e => setNewItemForm(prev => ({...prev, name: e.target.value}))}
                placeholder="Ej: Hamburguesa"
                autoFocus
              />
            </div>
            <div className="input-group">
              <label>Cantidad:</label>
              <input
                type="number"
                min="1"
                value={newItemForm.quantity}
                onChange={e => setNewItemForm(prev => ({...prev, quantity: parseInt(e.target.value) || 1}))}
              />
            </div>
            <div className="input-group">
              <label>Precio total:</label>
              <input
                type="number"
                value={newItemForm.price}
                onChange={e => setNewItemForm(prev => ({...prev, price: parseInt(e.target.value) || 0}))}
                placeholder="Precio total (no unitario)"
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowAddItemModal(false)}>Cancelar</button>
              <button onClick={handleAddItem} disabled={!newItemForm.name || !newItemForm.price}>
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollaborativeSession;
