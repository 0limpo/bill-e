// CollaborativeSession.js
// Componente principal para sesiones colaborativas de Bill-e
// Diseño Mobile First con lógica completa de producción

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import './CollaborativeSession.css';

const API_URL = 'https://bill-e-backend-lfwp.onrender.com';

// --- UTILS (Helpers visuales) ---
const formatCurrency = (amount) => `$${Math.round(amount).toLocaleString('es-CL')}`;

const getAvatarColor = (name) => {
  const colors = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

const getInitials = (name) => name ? name.substring(0, 2).toUpperCase() : '??';

// --- SUB-COMPONENTES VISUALES ---

const Avatar = ({ name, size = 'medium', className = '' }) => (
  <div 
    className={`avatar ${className}`}
    style={{ 
      backgroundColor: getAvatarColor(name || ''),
      width: size === 'small' ? '28px' : '40px',
      height: size === 'small' ? '28px' : '40px',
      fontSize: size === 'small' ? '12px' : '14px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '50%',
      color: 'white',
      fontWeight: 'bold',
      flexShrink: 0
    }}
  >
    {getInitials(name)}
  </div>
);

const JoinScreen = ({ onJoin, isLoading }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  return (
    <div className="join-screen">
      <div className="join-card">
        <div className="join-icon">👋</div>
        <h1>Bienvenido</h1>
        <p>Ingresa tus datos para unirte a la cuenta</p>
        
        <input
          className="join-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tu Nombre"
          autoFocus
        />
        <input
          className="join-input"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Tu Teléfono (para el total)"
        />
        
        <button 
          className="btn-main" 
          onClick={() => onJoin(name, phone)}
          disabled={isLoading || !name.trim()}
        >
          {isLoading ? 'Uniendo...' : 'Entrar a la mesa'}
        </button>
      </div>
    </div>
  );
};

const BillItem = ({
  item,
  assignments,
  participants,
  currentParticipant,
  isOwner,
  onAssign,
  onToggleMode,
  itemMode,
  isFinalized,
  onEditItem,
  onToggleEdit,
  onSplitItem,
  onDeleteItem
}) => {
  const itemId = item.id || item.name;
  const itemAssignments = assignments[itemId] || [];
  const isAssignedToMe = itemAssignments.some(a => a.participant_id === currentParticipant?.id);
  
  const totalAssigned = itemAssignments.reduce((sum, a) => sum + (a.quantity || 1), 0);
  const remaining = Math.max(0, (item.quantity || 1) - totalAssigned);

  const isEditing = item.isEditing;

  const handleFieldChange = (field, value) => {
    onEditItem(itemId, { [field]: value });
  };
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.target.blur(); // Trigger onBlur to save/close
    }
  };
  return (
    <div className={`bill-item ${isAssignedToMe ? 'selected' : ''} ${isFinalized ? 'finalized' : ''}`}>
      <div className="item-header">
        <div className="item-info">
          {isEditing ? (
            <input
              type="text"
              value={item.name}
              className="item-edit-input"
              onChange={(e) => handleFieldChange('name', e.target.value)}
              onBlur={() => onToggleEdit(itemId)} // Save and close on blur
              onKeyDown={handleKeyDown}
            />
          ) : (
            <span className="item-name">{item.name}</span>
          )}
          {isEditing ? (
            <div className="item-meta-edit">
              <input
                type="number"
                value={item.quantity || 1}
                className="item-edit-input qty"
                onChange={(e) => handleFieldChange('quantity', parseInt(e.target.value, 10) || 1)}
                onBlur={() => onToggleEdit(itemId)}
                onKeyDown={handleKeyDown}
              />
              <span>x</span>
              <input
                type="number"
                value={item.price}
                className="item-edit-input price"
                onChange={(e) => handleFieldChange('price', parseFloat(e.target.value) || 0)}
                onBlur={() => onToggleEdit(itemId)}
                onKeyDown={handleKeyDown}
              />
              <button
                className="btn-delete-item"
                onClick={(e) => { e.stopPropagation(); onDeleteItem(itemId); }}
                title="Eliminar item"
              >
                🗑️
              </button>
            </div>
          ) : (
            <div className="item-meta">
              <span className="item-qty-badge">{item.quantity || 1}x</span>
              <span className="item-price">{formatCurrency(item.price * (item.quantity || 1))}</span>
            </div>
          )}
        </div>
        
        {isOwner && !isFinalized && (
          <button className="item-edit-btn" onClick={() => onToggleEdit(itemId)}>
            {!isEditing && '✏️'}
          </button>
        )}
        
        {((item.quantity > 1) || isOwner) && !isFinalized && !isEditing && (
           <div className="item-mode-switch">
             <div
                className={`mode-option ${itemMode !== 'grupal' ? 'active' : ''}`}
                onClick={() => onToggleMode(itemId)}
             >
               Individual
             </div>
             <div
                className={`mode-option ${itemMode === 'grupal' ? 'active' : ''}`}
                onClick={() => onToggleMode(itemId)}
             >
               Grupal
             </div>
           </div>
        )}

        {/* Split Item Button - Only in Grupal mode for items with qty > 1 */}
        {isOwner && !isFinalized && !isEditing && item.quantity > 1 && itemMode === 'grupal' && (
          <button
            className="split-item-btn"
            onClick={() => onSplitItem(itemId)}
            title="Separar en items individuales"
          >
            ✂️ Separar
          </button>
        )}
      </div>

      {/* HORIZONTAL SCROLL LIST - Both modes use same layout */}
      <div className="consumer-scroll-list">
        {participants.map(p => {
          const assignment = itemAssignments.find(a => a.participant_id === p.id);
          const qty = assignment?.quantity || 0;
          const isAssigned = qty > 0;
          const canEdit = !isFinalized && (isOwner || p.id === currentParticipant?.id);
          const displayName = p.id === currentParticipant?.id ? 'Yo' : p.name;

          return (
            <div
              key={p.id}
              className={`consumer-item-wrapper ${isAssigned ? 'assigned' : 'dimmed'}`}
            >
              {itemMode === 'grupal' ? (
                // MODO GRUPAL: Simple toggle (checkmark), shared equally
                <div
                  className="avatar-wrapper"
                  onClick={() => canEdit && onAssign(itemId, p.id, 1, !isAssigned)}
                  style={{ position: 'relative', cursor: canEdit ? 'pointer' : 'default' }}
                >
                  <Avatar name={p.name} />
                  {isAssigned && <span className="check-badge">✓</span>}
                </div>
              ) : (
                // MODO INDIVIDUAL: Specific quantities per person
                <div
                  className="avatar-wrapper"
                  onClick={() => canEdit && !isAssigned && onAssign(itemId, p.id, 1, true)}
                  style={{ position: 'relative', cursor: canEdit && !isAssigned ? 'pointer' : 'default' }}
                >
                  <Avatar name={p.name} />
                  {isAssigned && <span className="check-badge">✓</span>}
                </div>
              )}
              <span className="consumer-name">{displayName}</span>

              {/* Stepper only in Individual mode when assigned */}
              {itemMode !== 'grupal' && isAssigned && (
                <div className="stepper-compact">
                  <button
                    className="stepper-btn"
                    disabled={!canEdit || qty <= 0}
                    onClick={() => onAssign(itemId, p.id, qty - 1, qty - 1 > 0)}
                  >−</button>
                  <span className="stepper-val">{qty}</span>
                  <button
                    className="stepper-btn"
                    disabled={!canEdit || remaining <= 0}
                    onClick={() => onAssign(itemId, p.id, qty + 1, true)}
                  >+</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Warning for Individual mode when items not fully assigned */}
      {itemMode !== 'grupal' && remaining > 0 && totalAssigned > 0 && (
        <div className="grupal-warning">
          ⚠️ Faltan {remaining} por asignar
        </div>
      )}
    </div>
  );
};

// --- COMPONENTE PRINCIPAL ---

const CollaborativeSession = () => {
  const { id: sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const ownerToken = searchParams.get('owner');

  // Estados Lógicos
  const [session, setSession] = useState(null);
  const [currentParticipant, setCurrentParticipant] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [timeLeft, setTimeLeft] = useState('');
  
  // Estados de UI
  const [itemModes, setItemModes] = useState({});
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [isAddingParticipant, setIsAddingParticipant] = useState(false);

  // Participant management modal
  const [editingParticipant, setEditingParticipant] = useState(null);
  const [editParticipantName, setEditParticipantName] = useState('');

  // Interaction lock to prevent polling race condition
  const lastInteraction = useRef(0);

  // 1. CARGA INICIAL
  const loadSession = useCallback(async () => {
    try {
      const url = ownerToken
        ? `${API_URL}/api/session/${sessionId}/collaborative?owner=${ownerToken}`
        : `${API_URL}/api/session/${sessionId}/collaborative`;

      const response = await fetch(url);
      if (!response.ok) throw new Error('Sesión no encontrada o expirada');

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

  useEffect(() => { loadSession(); }, [loadSession]);

  // 2. POLLING (Sincronización en tiempo real)
  useEffect(() => {
    if (!session || !currentParticipant) return;
    const pollInterval = setInterval(async () => {
      // Skip polling if user interacted recently (prevents race condition)
      if (Date.now() - lastInteraction.current < 4000) return;

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
              status: data.status,
              totals: data.totals // Si se finalizó
            }));
            setLastUpdate(data.last_updated);
          }
        }
      } catch (err) { console.error('Error polling:', err); }
    }, 3000);
    return () => clearInterval(pollInterval);
  }, [sessionId, lastUpdate, session, currentParticipant]);

  // 3. TIMER
  useEffect(() => {
    if (!session?.expires_at) return;
    const updateTimer = () => {
      const diff = new Date(session.expires_at) - new Date();
      if (diff <= 0) {
        setTimeLeft('Expirada'); 
        return;
      }
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      setTimeLeft(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 60000);
    return () => clearInterval(interval);
  }, [session?.expires_at]);

  // 4. BACK BUTTON HANDLER (Modal closing on Android back)
  useEffect(() => {
    const isModalOpen = editingParticipant || showAddParticipant || showAddItemModal;

    if (isModalOpen) {
      // Push a state so back button has something to pop
      window.history.pushState({ modal: true }, '', window.location.href);
    }

    const handlePopState = (event) => {
      if (editingParticipant) {
        setEditingParticipant(null);
        // Prevent actual navigation
        window.history.pushState(null, '', window.location.href);
      } else if (showAddParticipant) {
        setShowAddParticipant(false);
        window.history.pushState(null, '', window.location.href);
      } else if (showAddItemModal) {
        setShowAddItemModal(false);
        window.history.pushState(null, '', window.location.href);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [editingParticipant, showAddParticipant, showAddItemModal]);

  // --- HANDLERS (Lógica de Negocio) ---

  const handleJoin = async (name, phone) => {
    lastInteraction.current = Date.now();
    setJoining(true);
    try {
      const res = await fetch(`${API_URL}/api/session/${sessionId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone })
      });
      if (!res.ok) throw new Error('Error al unirse');
      const data = await res.json();
      setCurrentParticipant(data.participant);
      await loadSession();
    } catch (err) { alert(err.message); }
    finally { setJoining(false); }
  };

  const handleAssign = async (itemId, participantId, quantity, isAssigned) => {
    lastInteraction.current = Date.now();
    // Actualización Optimista UI
    setSession(prev => {
      const currentAssignments = prev.assignments[itemId] || [];
      let newAssignments;
      if (!isAssigned) {
        newAssignments = currentAssignments.filter(a => a.participant_id !== participantId);
      } else {
        const existingIdx = currentAssignments.findIndex(a => a.participant_id === participantId);
        if (existingIdx >= 0) {
          newAssignments = currentAssignments.map((a, i) => i === existingIdx ? { ...a, quantity } : a);
        } else {
          newAssignments = [...currentAssignments, { participant_id: participantId, quantity }];
        }
      }
      return { ...prev, assignments: { ...prev.assignments, [itemId]: newAssignments } };
    });

    // Envío al servidor (Background)
    fetch(`${API_URL}/api/session/${sessionId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_id: itemId,
        participant_id: participantId,
        quantity,
        is_assigned: isAssigned,
        updated_by: currentParticipant?.name
      })
    }).catch(console.error);
  };

  const handleFinalize = async () => {
    if (!window.confirm('¿Cerrar la cuenta? Los participantes ya no podrán editar.')) return;
    try {
      const res = await fetch(`${API_URL}/api/session/${sessionId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_token: ownerToken })
      });
      if (res.ok) {
        const data = await res.json();
        setSession(prev => ({ ...prev, status: 'finalized', totals: data.totals }));
      }
    } catch (err) { alert('Error al finalizar'); }
  };

  // Split an item into separate units
  const handleSplitItem = async (itemId) => {
    lastInteraction.current = Date.now();
    const item = session.items.find(i => (i.id || i.name) === itemId);
    if (!item || item.quantity <= 1) return;

    const pricePerUnit = item.price / item.quantity;
    const newItemId = `${itemId}_split_${Date.now()}`;

    // Optimistic update: reduce original qty, add new item
    setSession(prev => ({
      ...prev,
      items: [
        ...prev.items.map(i =>
          (i.id || i.name) === itemId
            ? { ...i, quantity: i.quantity - 1, price: i.price - pricePerUnit }
            : i
        ),
        {
          id: newItemId,
          name: item.name,
          quantity: 1,
          price: pricePerUnit
        }
      ]
    }));

    // API calls (background)
    try {
      // Update original item
      await fetch(`${API_URL}/api/session/${sessionId}/add-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_token: ownerToken,
          name: item.name,
          price: pricePerUnit,
          quantity: 1
        })
      });
      // Reload to get server-assigned ID
      await loadSession();
    } catch (err) {
      console.error('Error splitting item:', err);
      // Rollback on error
      await loadSession();
    }
  };

  // Delete an item from the session
  const handleDeleteItem = async (itemId) => {
    if (!window.confirm('¿Eliminar este item?')) return;

    lastInteraction.current = Date.now();

    // Store for rollback
    const previousItems = session.items;
    const previousAssignments = session.assignments;

    // Optimistic update
    setSession(prev => ({
      ...prev,
      items: prev.items.filter(i => (i.id || i.name) !== itemId),
      assignments: Object.fromEntries(
        Object.entries(prev.assignments).filter(([key]) => key !== itemId)
      )
    }));

    try {
      const res = await fetch(`${API_URL}/api/session/${sessionId}/items/${itemId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_token: ownerToken })
      });

      if (!res.ok) throw new Error('Error al eliminar');
    } catch (err) {
      console.error('Error deleting item:', err);
      // Rollback on error
      setSession(prev => ({
        ...prev,
        items: previousItems,
        assignments: previousAssignments
      }));
      alert('Error al eliminar el item');
    }
  };

  // Open participant edit modal
  const handleOpenParticipantEdit = (participant) => {
    if (!isOwner) return;
    setEditingParticipant(participant);
    setEditParticipantName(participant.name);
  };

  // Save participant name
  const handleSaveParticipantName = async () => {
    if (!editingParticipant || !editParticipantName.trim()) return;
    if (editParticipantName.trim() === editingParticipant.name) {
      setEditingParticipant(null);
      return;
    }

    const participantId = editingParticipant.id;
    const newName = editParticipantName.trim();

    // Optimistic update
    setSession(prev => ({
      ...prev,
      participants: prev.participants.map(p =>
        p.id === participantId ? { ...p, name: newName } : p
      )
    }));
    setEditingParticipant(null);

    try {
      const res = await fetch(`${API_URL}/api/session/${sessionId}/participant/${participantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      if (!res.ok) {
        // Rollback
        await loadSession();
        alert('Error al actualizar nombre');
      }
    } catch (err) {
      console.error(err);
      await loadSession();
      alert('Error de conexión');
    }
  };

  // Remove participant
  const handleRemoveParticipant = async () => {
    if (!editingParticipant || editingParticipant.role === 'owner') return;

    const participantId = editingParticipant.id;
    const participantName = editingParticipant.name;

    if (!window.confirm(`¿Eliminar a ${participantName} de la mesa?`)) return;

    // Optimistic update
    setSession(prev => ({
      ...prev,
      participants: prev.participants.filter(p => p.id !== participantId)
    }));
    setEditingParticipant(null);

    try {
      const res = await fetch(`${API_URL}/api/session/${sessionId}/participant/${participantId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_token: ownerToken })
      });
      if (!res.ok) {
        // Rollback
        await loadSession();
        alert('Error al eliminar participante');
      }
    } catch (err) {
      console.error(err);
      await loadSession();
      alert('Error de conexión');
    }
  };

  const handleToggleItemEdit = (itemId) => {
    setSession(prev => ({
      ...prev,
      items: prev.items.map(item => 
        (item.id || item.name) === itemId ? { ...item, isEditing: !item.isEditing } : item
      ).map(item => (item.id || item.name) !== itemId ? { ...item, isEditing: false } : item) // Close other items
    }));
  };

  const handleItemUpdate = (itemId, updates) => {
    // Optimistic UI update
    setSession(prev => ({ ...prev, items: prev.items.map(i => (i.id || i.name) === itemId ? { ...i, ...updates } : i) }));
  };
  // Cálculo de totales locales
  const getMyTotal = () => {
    if (!session || !currentParticipant) return 0;
    let total = 0;
    Object.entries(session.assignments).forEach(([itemId, assigns]) => {
      const myAssign = assigns.find(a => a.participant_id === currentParticipant.id);
      if (myAssign) {
        const item = session.items.find(i => (i.id || i.name) === itemId);
        if (item) total += item.price * (myAssign.quantity || 1);
      }
    });
    // Sumar propina proporcional (si existe en session)
    const tipPct = session.tip_percentage || 10;
    return total * (1 + tipPct / 100);
  };

  const toggleItemMode = (itemId) => {
    setItemModes(prev => ({
      ...prev,
      [itemId]: prev[itemId] === 'grupal' ? 'individual' : 'grupal'
    }));
  };

  const handleAddNewItem = async () => {
    // Validation
    const trimmedName = newItemName.trim();
    const priceNum = parseFloat(newItemPrice);

    if (!trimmedName) {
      alert('Por favor ingresa un nombre para el item');
      return;
    }
    if (isNaN(priceNum) || priceNum <= 0) {
      alert('Por favor ingresa un precio válido mayor a 0');
      return;
    }

    const tempId = `temp_item_${Date.now()}`;

    // Optimistic UI: Add item immediately
    const optimisticItem = {
      id: tempId,
      name: trimmedName,
      price: priceNum,
      quantity: 1
    };

    setSession(prev => ({
      ...prev,
      items: [...prev.items, optimisticItem]
    }));
    setShowAddItemModal(false);
    setNewItemName('');
    setNewItemPrice('');
    setIsCreatingItem(true);

    try {
      const res = await fetch(`${API_URL}/api/session/${sessionId}/add-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          price: priceNum,
          quantity: 1,
          owner_token: ownerToken
        })
      });
      if (res.ok) {
        // Replace temp item with real one from server
        await loadSession();
      } else {
        // Rollback on error
        const errorData = await res.json().catch(() => ({}));
        console.error('Error creating item:', res.status, errorData);
        setSession(prev => ({
          ...prev,
          items: prev.items.filter(i => i.id !== tempId)
        }));
        alert(`Error creando item: ${errorData.message || res.statusText}`);
      }
    } catch (err) {
      // Rollback on network error
      console.error('Network error creating item:', err);
      setSession(prev => ({
        ...prev,
        items: prev.items.filter(i => i.id !== tempId)
      }));
      alert('Error de conexión al crear item');
    } finally {
      setIsCreatingItem(false);
    }
  };

  const handleAddParticipant = async () => {
    const trimmedName = newParticipantName.trim();
    if (!trimmedName || isAddingParticipant) return;

    const tempId = `temp_${Date.now()}`;

    // Optimistic UI: Add participant immediately
    const optimisticParticipant = {
      id: tempId,
      name: trimmedName,
      phone: "N/A",
      role: "editor",
      joined_at: new Date().toISOString()
    };

    setSession(prev => ({
      ...prev,
      participants: [...prev.participants, optimisticParticipant]
    }));
    setShowAddParticipant(false);
    setNewParticipantName('');
    setIsAddingParticipant(true);

    try {
      const res = await fetch(`${API_URL}/api/session/${sessionId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, phone: "" })
      });
      if (res.ok) {
        // Replace temp participant with real one from server
        await loadSession();
      } else {
        // Rollback on error
        const errorData = await res.json().catch(() => ({}));
        console.error('Error adding participant:', res.status, errorData);
        setSession(prev => ({
          ...prev,
          participants: prev.participants.filter(p => p.id !== tempId)
        }));
        alert(`Error al agregar participante: ${errorData.message || res.statusText}`);
      }
    } catch (e) {
      // Rollback on network error
      console.error('Network error adding participant:', e);
      setSession(prev => ({
        ...prev,
        participants: prev.participants.filter(p => p.id !== tempId)
      }));
      alert('Error de conexión');
    } finally {
      setIsAddingParticipant(false);
    }
  };

  // --- RENDER ---

  if (loading) return <div className="join-screen"><div className="spinner"></div></div>;
  if (error) return <div className="join-screen"><h3>⚠️ Error: {error}</h3></div>;
  if (!isOwner && !currentParticipant) return <JoinScreen onJoin={handleJoin} isLoading={joining} />;

  // Vista Finalizada
  if (session.status === 'finalized') {
    return (
      <div className="collaborative-session finalized-view">
        <div className="header">
          <h1>✅ Cuenta Cerrada</h1>
        </div>
        <div className="join-card">
          <p className="finalized-message">
            El anfitrión ha finalizado la cuenta.
          </p>
          {session.totals && (
            <div className="my-total-amount success">
              {isOwner
                ? formatCurrency(session.total)
                : formatCurrency(session.totals.find(t => t.id === currentParticipant.id)?.total || 0)
              }
            </div>
          )}
          <p className="finalized-total-label">
            {isOwner ? 'Total Mesa' : 'Tu total a pagar'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="collaborative-session">
      {/* HEADER */}
      <div className="header">
        <div>
          <div className="header-meta">MESA #{sessionId.slice(0,4)}</div>
          <h1>Dividir Cuenta</h1>
        </div>
        <div className="timer">⏱️ {timeLeft}</div>
      </div>

      {/* VALIDACION OWNER (Resumen rápido) */}
      {isOwner && (
        <div className={`validation-box ${session.subtotal !== session.original_subtotal ? 'warning' : ''}`}>
           <div className="sheet-column">
             <span className="validation-label">Subtotal Boleta</span>
             <span className="validation-value">
                {formatCurrency(session.subtotal)}
             </span>
           </div>
        </div>
      )}

      {/* LISTA PARTICIPANTES */}
      <div className="participants-section">
        <div className="participants-list">
           {/* Add button first (ghost avatar style) */}
           {isOwner && (
             <button className="add-participant-btn" onClick={() => setShowAddParticipant(true)} />
           )}
           {session.participants.map(p => (
              <div
                key={p.id}
                className={`participant-chip ${p.id === currentParticipant?.id ? 'current' : ''} ${isOwner ? 'clickable' : ''}`}
                onClick={() => isOwner && session.status !== 'finalized' && handleOpenParticipantEdit(p)}
              >
                {p.role === 'owner' && <span className="badge-owner">Host</span>}
                <Avatar name={p.name} />
                <span className="participant-name">{p.id === currentParticipant?.id ? 'Tú' : p.name}</span>
              </div>
           ))}
        </div>
      </div>

      {/* LISTA ITEMS */}
      <div className="items-section">
        <h3>Consumo</h3>
        {session.items.map((item, idx) => (
          <BillItem
            key={item.id || idx}
            item={item}
            assignments={session.assignments}
            participants={session.participants}
            currentParticipant={currentParticipant}
            isOwner={isOwner}
            onAssign={handleAssign}
            itemMode={itemModes[item.id || item.name]}
            onToggleMode={toggleItemMode}
            isFinalized={session.status === 'finalized'}
            onEditItem={handleItemUpdate}
            onToggleEdit={handleToggleItemEdit}
            onSplitItem={handleSplitItem}
            onDeleteItem={handleDeleteItem}
          />
        ))}
        
        {isOwner && (
          <button className="add-item-btn" onClick={() => setShowAddItemModal(true)}>
            + Agregar Item Manual
          </button>
        )}
      </div>

      {/* BOTTOM SHEET (Barra inferior fija) */}
      <div className="bottom-sheet">
        <div className="sheet-handle"></div>
        
        {isOwner ? (
            // VISTA OWNER
            <>
              <div className="sheet-summary-row">
                <span className="my-total-label">Total Mesa (aprox)</span>
                <span className="my-total-amount">{formatCurrency(session.total)}</span>
              </div>
              <button className="btn-main btn-dark" onClick={handleFinalize}>
                🔒 Cerrar Cuenta y Cobrar
              </button>
            </>
        ) : (
            // VISTA PARTICIPANTE
            <>
              <div className="sheet-summary-row">
                <div className="sheet-column">
                   <span className="my-total-label">Tu parte (+ propina)</span>
                   <small className="sheet-subtitle">*Pendiente de cierre</small>
                </div>
                <span className="my-total-amount">{formatCurrency(getMyTotal())}</span>
              </div>
              <button className="btn-main" disabled>
                 Esperando al anfitrión...
              </button>
            </>
        )}
      </div>

      {/* MODAL AGREGAR PARTICIPANTE (Simple) */}
      {showAddParticipant && (
        <div className="modal-overlay" onClick={() => setShowAddParticipant(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Agregar Participante</h3>
            <input
              className="join-input"
              value={newParticipantName}
              onChange={e => setNewParticipantName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddParticipant(); }}
              placeholder="Nombre"
              autoFocus
            />
            <button
              className="btn-main"
              disabled={!newParticipantName.trim() || isAddingParticipant}
              onClick={handleAddParticipant}
            >
              {isAddingParticipant ? 'Agregando...' : 'Agregar'}
            </button>
          </div>
        </div>
      )}

      {showAddItemModal && (
        <div className="modal-overlay" onClick={() => !isCreatingItem && setShowAddItemModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Nuevo Consumo</h3>
            <input
              className="join-input"
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              placeholder="¿Qué pidieron?"
              autoFocus
              disabled={isCreatingItem}
            />
            <input
              className="join-input"
              type="number"
              value={newItemPrice}
              onChange={e => setNewItemPrice(e.target.value)}
              placeholder="Precio ($)"
              disabled={isCreatingItem}
            />
            <button
              className="btn-main"
              onClick={handleAddNewItem}
              disabled={isCreatingItem}
            >
              {isCreatingItem ? 'Creando...' : 'Crear Item'}
            </button>
          </div>
        </div>
      )}

      {/* Manage Participant Modal */}
      {editingParticipant && (
        <div className="modal-overlay" onClick={() => setEditingParticipant(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Editar Participante</h3>
            <input
              className="join-input"
              value={editParticipantName}
              onChange={e => setEditParticipantName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveParticipantName(); }}
              placeholder="Nombre"
              autoFocus
            />
            <button
              className="btn-main"
              disabled={!editParticipantName.trim() || editParticipantName === editingParticipant.name}
              onClick={handleSaveParticipantName}
            >
              Guardar Nombre
            </button>
            {editingParticipant.role !== 'owner' && (
              <button
                className="btn-danger"
                onClick={handleRemoveParticipant}
              >
                Eliminar de la mesa
              </button>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default CollaborativeSession;