// CollaborativeSession.js
// Componente principal para sesiones colaborativas de Bill-e
// Diseño Mobile First con lógica completa de producción

import React, { useState, useEffect, useCallback } from 'react';
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
  onToggleEdit
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
      </div>

      {itemMode === 'grupal' ? (
        // MODO GRUPAL
        <div className="grupal-container">
          <span className="grupal-instruction">Reparte las {item.quantity} unidades:</span>
          {participants.map(p => {
             const assignment = itemAssignments.find(a => a.participant_id === p.id);
             const qty = assignment?.quantity || 0;
             const canEdit = !isFinalized && (isOwner || p.id === currentParticipant?.id);

             return (
               <div key={p.id} className="quantity-row">
                 <div className="quantity-row-info">
                    <Avatar name={p.name} size="small" />
                    <span className="quantity-row-name">{p.name}</span>
                 </div>
                 <div className="qty-controls-small">
                   <button 
                     className="qty-btn-small"
                     disabled={!canEdit || qty <= 0}
                     onClick={() => onAssign(itemId, p.id, qty - 1, qty - 1 > 0)}
                   >-</button>
                   <span className="qty-val-small">{qty}</span>
                   <button 
                     className="qty-btn-small"
                     disabled={!canEdit || remaining <= 0}
                     onClick={() => onAssign(itemId, p.id, qty + 1, true)}
                   >+</button>
                 </div>
               </div>
             )
          })}
          {remaining > 0 && (
             <div className="grupal-warning">
               ⚠️ Faltan {remaining} por asignar
             </div>
          )}
        </div>
      ) : (
        // MODO INDIVIDUAL SIMPLE
        <div className="simple-assignment">
          {participants.map(p => {
            const isAssigned = itemAssignments.some(a => a.participant_id === p.id);
            const canToggle = !isFinalized && (isOwner || p.id === currentParticipant?.id);
            
            return (
              <button
                key={p.id}
                className={`assign-avatar-btn ${isAssigned ? 'assigned' : ''}`}
                onClick={() => canToggle && onAssign(itemId, p.id, 1, !isAssigned)}
                disabled={!canToggle}
              >
                <Avatar name={p.name} />
                <span>{p.id === currentParticipant?.id ? 'Yo' : p.name}</span>
              </button>
            );
          })}
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
  const [isEditingHostName, setIsEditingHostName] = useState(false);
  const [tempHostName, setTempHostName] = useState('');
  const [newParticipantName, setNewParticipantName] = useState('');
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');

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

  // --- HANDLERS (Lógica de Negocio) ---

  const handleJoin = async (name, phone) => {
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

  const handleEditHostName = () => {
    const owner = session.participants.find(p => p.role === 'owner');
    if (owner) {
      setTempHostName(owner.name);
      setIsEditingHostName(true);
    }
  };

  const handleCancelHostNameEdit = () => {
    setIsEditingHostName(false);
    setTempHostName('');
  };

  const handleSaveHostName = async () => {
    const owner = session.participants.find(p => p.role === 'owner');
    if (!owner || !tempHostName.trim() || owner.name === tempHostName) {
      setIsEditingHostName(false);
      return;
    }
    try {
      await fetch(`${API_URL}/api/session/${sessionId}/participant/${owner.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tempHostName })
      });
      // Optimistic update
      setSession(prev => ({
        ...prev,
        participants: prev.participants.map(p => p.id === owner.id ? { ...p, name: tempHostName } : p)
      }));
    } catch (err) {
      console.error(err);
      alert('No se pudo actualizar el nombre.');
    } finally {
      setIsEditingHostName(false);
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
    if (!newItemName.trim() || !newItemPrice) return;
    try {
      const res = await fetch(`${API_URL}/api/session/${sessionId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newItemName,
          price: parseInt(newItemPrice),
          quantity: 1
        })
      });
      if (res.ok) {
        await loadSession();
        setShowAddItemModal(false);
        setNewItemName('');
        setNewItemPrice('');
      }
    } catch (err) {
      alert('Error creando item');
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
           {session.participants.map(p => ( 
             p.role === 'owner' && isEditingHostName ? (
              <div key={p.id} className="participant-chip editing">
                <input
                  value={tempHostName}
                  onChange={(e) => setTempHostName(e.target.value)}
                  onBlur={handleSaveHostName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveHostName();
                    if (e.key === 'Escape') handleCancelHostNameEdit();
                  }}
                  className="host-edit-input"
                  autoFocus
                />
              </div>
             ) : (
              <div key={p.id} className={`participant-chip ${p.id === currentParticipant?.id ? 'current' : ''}`}>
                <Avatar name={p.name} size="small" />
                <span className="participant-name">{p.id === currentParticipant?.id ? 'Tú' : p.name}</span>
                {p.role === 'owner' && (
                  <>
                    <span className="badge-owner">Host</span>
                    {session.status !== 'finalized' && (
                      <button className="host-edit-btn" onClick={handleEditHostName}>✏️</button>
                    )}
                  </>
                )}
              </div>
             )
           ))}
           {isOwner && (
             <button className="add-participant-btn" onClick={() => setShowAddParticipant(true)}>+</button>
           )}
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
              placeholder="Nombre"
              autoFocus
            />
            <button
              className="btn-main"
              disabled={!newParticipantName.trim()}
              onClick={async () => {
                try {
                  const res = await fetch(`${API_URL}/api/session/${sessionId}/join`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newParticipantName })
                  });
                  if (res.ok) {
                    await loadSession();
                    setShowAddParticipant(false);
                    setNewParticipantName('');
                  } else {
                    alert('Error al agregar participante');
                  }
                } catch (e) {
                  alert('Error de conexión');
                }
              }}
            >
              Agregar
            </button>
          </div>
        </div>
      )}

      {showAddItemModal && (
        <div className="modal-overlay" onClick={() => setShowAddItemModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Nuevo Consumo</h3>
            <input
              className="join-input"
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              placeholder="¿Qué pidieron?"
              autoFocus
            />
            <input
              className="join-input"
              type="number"
              value={newItemPrice}
              onChange={e => setNewItemPrice(e.target.value)}
              placeholder="Precio ($)"
            />
            <button className="btn-main" onClick={handleAddNewItem}>
              Crear Item
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default CollaborativeSession;