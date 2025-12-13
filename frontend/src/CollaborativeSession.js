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

// Selection Screen - Pick existing participant or create new
const SelectionScreen = ({ participants, onSelectParticipant, onCreateNew, isLoading }) => {
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  // Filter out the host - editors can't claim the host avatar
  const editableParticipants = participants.filter(p => p.role !== 'owner');

  // Phone confirmation screen for existing participant
  if (selectedParticipant) {
    const phoneValid = phone.trim().length >= 8;  // Require at least 8 digits
    return (
      <div className="join-screen">
        <div className="join-card">
          <div
            className="join-avatar-large"
            style={{ backgroundColor: getAvatarColor(selectedParticipant.name) }}
          >
            {getInitials(selectedParticipant.name)}
          </div>
          <h1>Hola, {selectedParticipant.name}</h1>
          <p>Confirma tu teléfono para continuar</p>

          <input
            className={`join-input ${!phoneValid && phone.length > 0 ? 'input-error' : ''}`}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Tu Teléfono (requerido)"
            autoFocus
          />
          {!phoneValid && <span className="input-hint">* Teléfono requerido (min. 8 dígitos)</span>}

          <button
            className="btn-main"
            onClick={() => onSelectParticipant(selectedParticipant, phone)}
            disabled={isLoading || !phoneValid}
          >
            {isLoading ? 'Entrando...' : 'Confirmar y Entrar'}
          </button>
          <button
            className="btn-secondary"
            onClick={() => { setSelectedParticipant(null); setPhone(''); }}
          >
            ← Volver
          </button>
        </div>
      </div>
    );
  }

  // New participant form
  if (showNewForm) {
    const phoneValid = phone.trim().length >= 8;  // Require at least 8 digits
    return (
      <div className="join-screen">
        <div className="join-card">
          <div className="join-icon">✨</div>
          <h1>Nuevo Participante</h1>
          <p>Ingresa tus datos para unirte</p>

          <input
            className="join-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu Nombre"
            autoFocus
          />
          <input
            className={`join-input ${!phoneValid && phone.length > 0 ? 'input-error' : ''}`}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Tu Teléfono (requerido)"
          />
          {!phoneValid && <span className="input-hint">* Teléfono requerido (min. 8 dígitos)</span>}

          <button
            className="btn-main"
            onClick={() => onCreateNew(name, phone)}
            disabled={isLoading || !name.trim() || !phoneValid}
          >
            {isLoading ? 'Uniendo...' : 'Unirme a la mesa'}
          </button>
          <button
            className="btn-secondary"
            onClick={() => setShowNewForm(false)}
          >
            ← Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="join-screen">
      <div className="join-card selection-card">
        <div className="join-icon">👋</div>
        <h1>¿Quién eres?</h1>
        <p>Selecciona tu nombre de la lista</p>

        <div className="selection-grid">
          {editableParticipants.map(p => (
            <button
              key={p.id}
              className="selection-avatar-btn"
              onClick={() => setSelectedParticipant(p)}
            >
              <div
                className="selection-avatar"
                style={{ backgroundColor: getAvatarColor(p.name) }}
              >
                {getInitials(p.name)}
              </div>
              <span className="selection-name">{p.name}</span>
            </button>
          ))}
        </div>

        <button
          className="btn-new-participant"
          onClick={() => setShowNewForm(true)}
        >
          + No estoy en la lista
        </button>
      </div>
    </div>
  );
};

// Edit inputs with local state to prevent sticky "0" behavior
const EditableInput = ({ type, initialValue, onSave, className, defaultValue = 0 }) => {
  const [localVal, setLocalVal] = useState(initialValue?.toString() || '');

  const handleBlur = () => {
    let parsed;
    if (type === 'number') {
      parsed = parseFloat(localVal);
      if (isNaN(parsed) || parsed < 0) parsed = defaultValue;
    } else {
      parsed = localVal.trim() || defaultValue;
    }
    onSave(parsed);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.target.blur();
    }
  };

  return (
    <input
      type={type === 'number' ? 'number' : 'text'}
      value={localVal}
      className={className}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  );
};

// Validation Dashboard Component (Host Only)
const ValidationDashboard = ({ session, onUpdateSubtotal }) => {
  const [editingSubtotal, setEditingSubtotal] = useState(false);
  const [subtotalInput, setSubtotalInput] = useState(session.subtotal?.toString() || '0');

  // Calculate Total Items (sum of item price * quantity)
  const totalItems = session.items.reduce((sum, item) => {
    return sum + (item.price * (item.quantity || 1));
  }, 0);

  // Calculate Total Assigned (sum of assigned shares value)
  const totalAsignado = (() => {
    let total = 0;
    const itemsById = {};
    session.items.forEach(item => {
      itemsById[item.id || item.name] = item;
    });

    Object.entries(session.assignments).forEach(([itemId, assigns]) => {
      const item = itemsById[itemId];
      if (!item) return;

      const pricePerUnit = item.price / (item.quantity || 1);
      assigns.forEach(a => {
        total += pricePerUnit * (a.quantity || 1);
      });
    });
    return total;
  })();

  const totalBoleta = session.subtotal || 0;

  // Validation logic
  const itemsMatch = Math.abs(totalItems - totalBoleta) < 1;
  const assignedMatch = Math.abs(totalAsignado - totalBoleta) < 1;
  const isBalanced = itemsMatch && assignedMatch;

  const handleSaveSubtotal = () => {
    const parsed = parseFloat(subtotalInput);
    if (!isNaN(parsed) && parsed >= 0) {
      onUpdateSubtotal(parsed);
    }
    setEditingSubtotal(false);
  };

  return (
    <div className={`validation-dashboard ${isBalanced ? 'balanced' : 'warning'}`}>
      <div className="validation-header">
        {isBalanced ? (
          <span className="validation-status success">✅ Cuenta Cuadrada</span>
        ) : (
          <span className="validation-status warning">⚠️ Revisar Totales</span>
        )}
      </div>

      <div className="validation-metrics">
        <div className="metric">
          <span className="metric-label">Total Items</span>
          <span className={`metric-value ${itemsMatch ? 'match' : 'mismatch'}`}>
            {formatCurrency(totalItems)}
          </span>
        </div>

        <div className="metric">
          <span className="metric-label">Total Asignado</span>
          <span className={`metric-value ${assignedMatch ? 'match' : 'mismatch'}`}>
            {formatCurrency(totalAsignado)}
          </span>
        </div>

        <div className="metric editable">
          <span className="metric-label">Total Boleta</span>
          {editingSubtotal ? (
            <input
              type="number"
              className="metric-input"
              value={subtotalInput}
              onChange={(e) => setSubtotalInput(e.target.value)}
              onBlur={handleSaveSubtotal}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
              autoFocus
            />
          ) : (
            <span
              className="metric-value clickable"
              onClick={() => {
                setSubtotalInput(totalBoleta.toString());
                setEditingSubtotal(true);
              }}
            >
              {formatCurrency(totalBoleta)} ✏️
            </span>
          )}
        </div>
      </div>

      {!assignedMatch && totalAsignado < totalBoleta && (
        <div className="validation-warning">
          Faltan {formatCurrency(totalBoleta - totalAsignado)} por asignar
        </div>
      )}
      {!assignedMatch && totalAsignado > totalBoleta && (
        <div className="validation-warning">
          Sobrepasado por {formatCurrency(totalAsignado - totalBoleta)}
        </div>
      )}
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
  onGroupAssign,
  onUnitAssign,
  onClearUnitsAndAssignAll,
  onClearParent,
  onToggleMode,
  itemMode,
  isFinalized,
  onEditItem,
  onToggleEdit,
  onDeleteItem,
  isExpanded,
  onToggleExpand,
  isPerUnitMode,
  onSetPerUnitMode
}) => {
  const itemId = item.id || item.name;
  const itemAssignments = assignments[itemId] || [];
  const isAssignedToMe = itemAssignments.some(a => a.participant_id === currentParticipant?.id);

  // Derive perUnitMode from synced assignments (detects unit assignments from other users)
  // Check for actual assignments (non-empty arrays), not just existing keys
  const hasUnitAssignments = Object.entries(assignments).some(([key, assigns]) =>
    key.startsWith(`${itemId}_unit_`) && assigns && assigns.length > 0
  );
  // Use derived state from assignments OR local state for immediate UI feedback
  const effectivePerUnitMode = hasUnitAssignments || isPerUnitMode;

  const totalAssigned = itemAssignments.reduce((sum, a) => sum + (a.quantity || 1), 0);
  const remaining = Math.max(0, (item.quantity || 1) - totalAssigned);

  const isEditing = item.isEditing;
  const qty = item.quantity || 1;
  const unitPrice = item.price;
  const totalPrice = unitPrice * qty;

  const canEditItem = isOwner && !isFinalized;

  return (
    <>
      {/* Edit backdrop - click outside to save */}
      {isEditing && (
        <div className="edit-backdrop" onClick={() => onToggleEdit(itemId)} />
      )}

      <div className={`bill-item ${isAssignedToMe ? 'selected' : ''} ${isFinalized ? 'finalized' : ''} ${isEditing ? 'editing' : ''}`}>
        {/* GRID LAYOUT: Qty | Name | Price */}
        <div className="item-header" onClick={() => canEditItem && !isEditing && onToggleEdit(itemId)}>
          {isEditing ? (
            // EDIT MODE - Clean CSS Grid layout
            <div className="item-edit-grid" onClick={(e) => e.stopPropagation()}>
              {/* Row 1: Labels */}
              <label className="edit-label">Cant.</label>
              <label className="edit-label">Nombre del Item</label>
              <label className="edit-label">Precio Unit.</label>
              <span></span>

              {/* Row 2: Inputs */}
              <EditableInput
                type="number"
                initialValue={qty}
                className="clean-input qty"
                defaultValue={1}
                onSave={(val) => { onEditItem(itemId, { quantity: Math.max(1, Math.round(val)) }); }}
              />
              <EditableInput
                type="text"
                initialValue={item.name}
                className="clean-input name"
                defaultValue="Item"
                onSave={(val) => { onEditItem(itemId, { name: val }); }}
              />
              <EditableInput
                type="number"
                initialValue={unitPrice}
                className="clean-input price"
                defaultValue={0}
                onSave={(val) => { onEditItem(itemId, { price: val }); }}
              />
              <button
                className="btn-trash"
                onClick={(e) => { e.stopPropagation(); onDeleteItem(itemId); }}
                title="Eliminar item"
              >
                🗑️
              </button>

              {/* Row 3: Total helper */}
              <div className="edit-total-row">
                Total: <strong>{formatCurrency(totalPrice)}</strong>
              </div>
            </div>
          ) : (
            // VIEW MODE - Grid: Qty | Name | Price
            <>
              <span className="item-qty-badge">{qty}x</span>
              <span className={`item-name ${canEditItem ? 'editable' : ''}`}>{item.name}</span>
              <div className="item-price-col">
                <span className={`item-price ${canEditItem ? 'editable' : ''}`}>{formatCurrency(totalPrice)}</span>
                {qty > 1 && (
                  <span className="item-unit-price">{formatCurrency(unitPrice)} c/u</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Mode switch & controls - visible for all items, any participant can toggle */}
        {!isEditing && !isFinalized && (
           <div className="item-mode-switch">
             <div
                className={`mode-option ${itemMode !== 'grupal' ? 'active' : ''}`}
                onClick={() => onToggleMode(itemId)}
                style={{ cursor: 'pointer' }}
             >
               Individual
             </div>
             <div
                className={`mode-option ${itemMode === 'grupal' ? 'active' : ''}`}
                onClick={() => onToggleMode(itemId)}
                style={{ cursor: 'pointer' }}
             >
               Grupal
             </div>
           </div>
        )}

        {/* Grupal options for items with qty > 1 */}
        {!isEditing && item.quantity > 1 && itemMode === 'grupal' && !isFinalized && (() => {
          // Check if all participants are assigned to parent item
          const allAssignedToParent = participants.length > 0 &&
            participants.every(p => itemAssignments.some(a => a.participant_id === p.id));

          return (
            <div className="grupal-options">
              {/* Switch: Entre todos / Por unidad */}
              <div className="grupal-switch">
                <div
                  className={`grupal-switch-option ${!effectivePerUnitMode ? 'active' : ''}`}
                  onClick={() => {
                    if (effectivePerUnitMode) {
                      // Switching from "Por unidad" to "Entre todos"
                      // Clear unit assignments and assign all to parent
                      onClearUnitsAndAssignAll(itemId, qty);
                      onSetPerUnitMode(itemId, false);
                      // Also collapse if expanded
                      if (isExpanded) {
                        onToggleExpand(itemId);
                      }
                    } else if (!allAssignedToParent) {
                      // Already in "Entre todos" but not all assigned - assign all
                      onGroupAssign(itemId, '__ALL__', true);
                    }
                  }}
                >
                  {!effectivePerUnitMode && allAssignedToParent ? '✓ ' : ''}👥 Entre todos
                </div>
                <div
                  className={`grupal-switch-option ${effectivePerUnitMode ? 'active' : ''}`}
                  onClick={() => {
                    if (!effectivePerUnitMode) {
                      // Switching to "Por unidad" mode
                      onSetPerUnitMode(itemId, true);
                      // Clear parent assignments when switching to per-unit mode
                      onClearParent(itemId);
                      // Expand to show units
                      if (!isExpanded) {
                        onToggleExpand(itemId);
                      }
                    } else {
                      // Already in per-unit mode - just toggle expand/collapse
                      onToggleExpand(itemId);
                    }
                  }}
                >
                  Por unidad {isExpanded ? '▲' : '▼'}
                </div>
              </div>
            </div>
          );
        })()}

        {/* EXPANDED TREE VIEW - Per-unit independent assignments */}
        {isExpanded && itemMode === 'grupal' && qty > 1 ? (
          <div className="expanded-tree">
            {Array.from({ length: qty }, (_, unitIndex) => {
              const unitNum = unitIndex + 1;
              const unitId = `${itemId}_unit_${unitIndex}`;
              // Get assignments for THIS specific unit (independent per unit)
              const unitAssignments = assignments[unitId] || [];

              return (
                <div key={unitIndex} className="tree-unit">
                  <div className="tree-connector"></div>
                  <div className="tree-unit-content">
                    <span className="tree-unit-label">Unidad {unitNum}</span>
                    <div className="tree-unit-assignees">
                      {participants.map(p => {
                        // Check THIS unit's assignment (not parent item)
                        const unitAssignment = unitAssignments.find(a => a.participant_id === p.id);
                        const isAssigned = unitAssignment && unitAssignment.quantity > 0;
                        // Any authenticated participant can assign items to anyone
                        const canAssign = !isFinalized && currentParticipant;

                        return (
                          <div
                            key={p.id}
                            className={`tree-assignee ${isAssigned ? 'assigned' : 'dimmed'}`}
                            onClick={() => canAssign && onUnitAssign(itemId, unitIndex, p.id, !isAssigned)}
                            style={{ cursor: canAssign ? 'pointer' : 'default' }}
                          >
                            <Avatar name={p.name} size="small" />
                            {isAssigned && <span className="check-badge small">✓</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : itemMode === 'grupal' && qty > 1 ? (
          /* COLLAPSED GRUPAL VIEW - "Entre todos" mode: no extra UI needed, switch handles it */
          null
        ) : (
          /* HORIZONTAL SCROLL LIST - Normal view (individual mode or grupal qty=1) */
          <div className="consumer-scroll-list">
            {participants.map(p => {
              const assignment = itemAssignments.find(a => a.participant_id === p.id);
              const pQty = assignment?.quantity || 0;
              const isAssigned = pQty > 0;
              // Any authenticated participant can assign items to anyone
              const canAssign = !isFinalized && currentParticipant;
              const displayName = p.id === currentParticipant?.id ? 'Yo' : p.name;

              return (
                <div
                  key={p.id}
                  className={`consumer-item-wrapper ${isAssigned ? 'assigned' : 'dimmed'}`}
                >
                  {itemMode === 'grupal' ? (
                    // MODO GRUPAL (qty=1): Simple toggle
                    <div
                      className="avatar-wrapper"
                      onClick={() => canAssign && onGroupAssign(itemId, p.id, !isAssigned)}
                      style={{ position: 'relative', cursor: canAssign ? 'pointer' : 'default' }}
                    >
                      <Avatar name={p.name} />
                      {isAssigned && <span className="check-badge">✓</span>}
                    </div>
                  ) : (
                    // MODO INDIVIDUAL: Specific quantities per person
                    <div
                      className="avatar-wrapper"
                      onClick={() => canAssign && !isAssigned && remaining > 0 && onAssign(itemId, p.id, 1, true)}
                      style={{ position: 'relative', cursor: canAssign && !isAssigned && remaining > 0 ? 'pointer' : 'default' }}
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
                        disabled={!canAssign || pQty <= 0}
                        onClick={() => onAssign(itemId, p.id, Math.max(0, Math.round(pQty) - 1), Math.round(pQty) - 1 > 0)}
                      >−</button>
                      <span className="stepper-val">{Math.round(pQty)}</span>
                      <button
                        className="stepper-btn"
                        disabled={!canAssign || remaining <= 0}
                        onClick={() => onAssign(itemId, p.id, Math.round(pQty) + 1, true)}
                      >+</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Warning for Individual mode when items not fully assigned */}
        {itemMode !== 'grupal' && remaining > 0 && totalAssigned > 0 && (
          <div className="grupal-warning">
            ⚠️ Faltan {remaining} por asignar
          </div>
        )}
      </div>
    </>
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
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [isAddingParticipant, setIsAddingParticipant] = useState(false);
  const [isSheetExpanded, setIsSheetExpanded] = useState(false);

  // Participant management modal
  const [editingParticipant, setEditingParticipant] = useState(null);
  const [editParticipantName, setEditParticipantName] = useState('');

  // Expanded items for grupal tree view (visual only, no backend change)
  const [expandedItems, setExpandedItems] = useState({});

  // Per-unit mode state (independent of expanded/collapsed visual state)
  const [perUnitModeItems, setPerUnitModeItems] = useState({});

  // Interaction lock to prevent polling race condition
  const lastInteraction = useRef(0);

  // Touch tracking for swipe gesture on bottom sheet
  const touchStartY = useRef(0);

  // Swipe handlers for bottom sheet
  const handleTouchStart = (e) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    const endY = e.changedTouches[0].clientY;
    const diff = endY - touchStartY.current;

    if (diff < -30) {
      // Swipe Up -> Expand
      setIsSheetExpanded(true);
    } else if (diff > 30) {
      // Swipe Down -> Collapse
      setIsSheetExpanded(false);
    }
  };

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
              items: data.items || prev.items,  // Sync items (mode, name, price, quantity)
              status: data.status,
              totals: data.totals
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

  // Individual mode assignment (specific quantities per person)
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

  // Group mode assignment (splits evenly among all assignees: 1/N)
  // Special case: participantId === '__ALL__' assigns to ALL participants
  const handleGroupAssign = async (itemId, participantId, isAdding) => {
    lastInteraction.current = Date.now();

    const item = session.items.find(i => (i.id || i.name) === itemId);
    if (!item) return;

    const currentAssignments = session.assignments[itemId] || [];
    const currentAssignees = currentAssignments.map(a => a.participant_id);

    // Special case: __ALL__ means assign to all participants
    let newAssignees;
    if (participantId === '__ALL__') {
      // Toggle: if all are assigned, clear all; otherwise assign all
      const allParticipantIds = session.participants.map(p => p.id);
      const allAssigned = allParticipantIds.every(pid => currentAssignees.includes(pid));
      newAssignees = allAssigned ? [] : allParticipantIds;
    } else {
      // Normal single participant toggle
      if (isAdding) {
        if (currentAssignees.includes(participantId)) return;
        newAssignees = [...currentAssignees, participantId];
      } else {
        newAssignees = currentAssignees.filter(id => id !== participantId);
      }
    }

    // Calculate new share (equal split)
    const itemQty = item.quantity || 1;
    const newShare = newAssignees.length > 0 ? itemQty / newAssignees.length : 0;

    // Build new assignments with equal shares
    const newAssignments = newAssignees.map(pid => ({
      participant_id: pid,
      quantity: newShare
    }));

    // Optimistic UI update
    setSession(prev => ({
      ...prev,
      assignments: { ...prev.assignments, [itemId]: newAssignments }
    }));

    // Send updates to server (batch: one call per participant)
    // First, remove anyone who was removed
    const removedAssignees = currentAssignees.filter(id => !newAssignees.includes(id));
    for (const pid of removedAssignees) {
      fetch(`${API_URL}/api/session/${sessionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          participant_id: pid,
          quantity: 0,
          is_assigned: false,
          updated_by: currentParticipant?.name
        })
      }).catch(console.error);
    }

    // Then, update all current assignees with new share
    for (const pid of newAssignees) {
      fetch(`${API_URL}/api/session/${sessionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          participant_id: pid,
          quantity: newShare,
          is_assigned: true,
          updated_by: currentParticipant?.name
        })
      }).catch(console.error);
    }
  };

  // Handle assignment for a specific unit within an expanded grupal item
  // unitId format: "{itemId}_unit_{unitIndex}" (e.g., "item-1_unit_0")
  const handleUnitAssign = async (itemId, unitIndex, participantId, isAdding) => {
    lastInteraction.current = Date.now();

    const item = session.items.find(i => (i.id || i.name) === itemId);
    if (!item) return;

    const unitId = `${itemId}_unit_${unitIndex}`;
    const currentAssignments = session.assignments[unitId] || [];
    const currentAssignees = currentAssignments.map(a => a.participant_id);

    // Calculate new list of assignees for this unit
    let newAssignees;
    if (isAdding) {
      if (currentAssignees.includes(participantId)) return;
      newAssignees = [...currentAssignees, participantId];
    } else {
      newAssignees = currentAssignees.filter(id => id !== participantId);
    }

    // Each unit is 1 item, split equally among assignees
    const unitShare = newAssignees.length > 0 ? 1 / newAssignees.length : 0;

    // Build assignments for this unit
    const newUnitAssignments = newAssignees.map(pid => ({
      participant_id: pid,
      quantity: unitShare
    }));

    // Optimistic UI update
    setSession(prev => ({
      ...prev,
      assignments: { ...prev.assignments, [unitId]: newUnitAssignments }
    }));

    // Send updates to server
    const removedAssignees = currentAssignees.filter(id => !newAssignees.includes(id));
    for (const pid of removedAssignees) {
      fetch(`${API_URL}/api/session/${sessionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: unitId,
          participant_id: pid,
          quantity: 0,
          is_assigned: false,
          updated_by: currentParticipant?.name
        })
      }).catch(console.error);
    }

    for (const pid of newAssignees) {
      fetch(`${API_URL}/api/session/${sessionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: unitId,
          participant_id: pid,
          quantity: unitShare,
          is_assigned: true,
          updated_by: currentParticipant?.name
        })
      }).catch(console.error);
    }
  };

  // Clear all unit assignments and assign all participants to parent item (atomic operation)
  const handleClearUnitsAndAssignAll = (itemId, qty) => {
    lastInteraction.current = Date.now();

    const item = session.items.find(i => (i.id || i.name) === itemId);
    if (!item) return;

    // 1. Build new state clearing all units and assigning to parent
    const newAssignments = { ...session.assignments };

    // Clear all unit assignments
    for (let i = 0; i < qty; i++) {
      const unitId = `${itemId}_unit_${i}`;
      const unitAssigns = newAssignments[unitId] || [];
      // Send API calls to clear
      unitAssigns.forEach(a => {
        fetch(`${API_URL}/api/session/${sessionId}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: unitId,
            participant_id: a.participant_id,
            quantity: 0,
            is_assigned: false,
            updated_by: currentParticipant?.name
          })
        }).catch(console.error);
      });
      newAssignments[unitId] = [];
    }

    // Assign all participants to parent item
    const allParticipantIds = session.participants.map(p => p.id);
    const itemQty = item.quantity || 1;
    const newShare = itemQty / allParticipantIds.length;

    newAssignments[itemId] = allParticipantIds.map(pid => ({
      participant_id: pid,
      quantity: newShare
    }));

    // Send API calls for parent assignments
    allParticipantIds.forEach(pid => {
      fetch(`${API_URL}/api/session/${sessionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          participant_id: pid,
          quantity: newShare,
          is_assigned: true,
          updated_by: currentParticipant?.name
        })
      }).catch(console.error);
    });

    // Optimistic UI update (atomic)
    setSession(prev => ({
      ...prev,
      assignments: newAssignments
    }));
  };

  // Clear parent item assignments
  const handleClearParent = (itemId) => {
    lastInteraction.current = Date.now();

    const currentAssignments = session.assignments[itemId] || [];

    // Send API calls to clear
    currentAssignments.forEach(a => {
      fetch(`${API_URL}/api/session/${sessionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          participant_id: a.participant_id,
          quantity: 0,
          is_assigned: false,
          updated_by: currentParticipant?.name
        })
      }).catch(console.error);
    });

    // Optimistic UI update
    setSession(prev => ({
      ...prev,
      assignments: { ...prev.assignments, [itemId]: [] }
    }));
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

  // WhatsApp Share - Uses LOCAL calculations for accurate numbers
  const handleShareWhatsapp = () => {
    if (!session?.participants) return;

    let text = `🧾 *Resumen Bill-e*\n\n`;

    // Use local calculateParticipantTotal instead of session.totals
    let grandTotal = 0;
    session.participants.forEach(p => {
      const { total } = calculateParticipantTotal(p.id, true);
      text += `• ${p.name}: ${formatCurrency(total)}\n`;
      grandTotal += total;
    });

    text += `\n*Total Mesa: ${formatCurrency(grandTotal)}*`;
    text += `\n\n📱 Ver detalle: https://bill-e.vercel.app/s/${sessionId}`;

    // wa.me works best across mobile and desktop
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(whatsappUrl, '_blank');
  };

  // Reopen a finalized session
  const handleReopenSession = async () => {
    if (!window.confirm('¿Reabrir la mesa para editar? Los totales se recalcularán al cerrar de nuevo.')) return;

    lastInteraction.current = Date.now();

    // Optimistic update
    setSession(prev => ({ ...prev, status: 'assigning', totals: null }));

    try {
      const res = await fetch(`${API_URL}/api/session/${sessionId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_token: ownerToken })
      });

      if (!res.ok) throw new Error('Error al reabrir');
    } catch (err) {
      console.error('Error reopening session:', err);
      // Rollback
      await loadSession();
      alert('Error al reabrir la mesa');
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

  const handleItemUpdate = async (itemId, updates) => {
    lastInteraction.current = Date.now();

    // Optimistic UI update
    setSession(prev => ({ ...prev, items: prev.items.map(i => (i.id || i.name) === itemId ? { ...i, ...updates } : i) }));

    // Call backend to persist changes (triggers sync for editors)
    try {
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
      console.error('Error updating item:', err);
    }
  };
  // Calculate participant total dynamically from local state (not backend totals)
  // This ensures Host sees the same math as Editor when items are edited
  // Supports SMART TIP: percent mode (proportional) or fixed mode (equal split)
  // Also supports unit-level assignments (itemId_unit_N format)
  const calculateParticipantTotal = (participantId, includesTip = true) => {
    if (!session) return { subtotal: 0, total: 0, tipAmount: 0 };

    let subtotal = 0;
    Object.entries(session.assignments).forEach(([assignmentKey, assigns]) => {
      const assignment = assigns.find(a => a.participant_id === participantId);
      if (assignment) {
        // Check if this is a unit assignment (format: itemId_unit_N)
        const unitMatch = assignmentKey.match(/^(.+)_unit_(\d+)$/);

        if (unitMatch) {
          // Unit assignment - find parent item by base itemId
          const baseItemId = unitMatch[1];
          const item = session.items.find(i => (i.id || i.name) === baseItemId);
          if (item) {
            // Each unit is worth 1 * unitPrice, split by quantity assigned
            subtotal += item.price * (assignment.quantity || 0);
          }
        } else {
          // Regular item assignment
          const item = session.items.find(i => (i.id || i.name) === assignmentKey);
          if (item) {
            // item.price is UNIT PRICE - just multiply by assigned quantity
            subtotal += item.price * (assignment.quantity || 0);
          }
        }
      }
    });

    // SMART TIP LOGIC
    const tipMode = session.tip_mode || 'percent';
    const tipValue = session.tip_value ?? session.tip_percentage ?? 10;
    const numParticipants = session.participants?.length || 1;

    let tipAmount = 0;
    if (tipMode === 'fixed') {
      // Fixed amount split equally among all participants
      tipAmount = tipValue / numParticipants;
    } else {
      // Percent mode - proportional to consumption
      tipAmount = subtotal * (tipValue / 100);
    }

    const total = includesTip ? subtotal + tipAmount : subtotal;

    return { subtotal, total, tipAmount };
  };

  // Handle tip update (mode + value)
  const handleUpdateTip = async (mode, value) => {
    lastInteraction.current = Date.now();

    // Optimistic update
    setSession(prev => ({
      ...prev,
      tip_mode: mode,
      tip_value: value,
      tip_percentage: mode === 'percent' ? value : prev.tip_percentage
    }));

    // Persist to backend
    try {
      await fetch(`${API_URL}/api/session/${sessionId}/update-totals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_token: ownerToken,
          tip_mode: mode,
          tip_value: value,
          tip_percentage: mode === 'percent' ? value : session.tip_percentage
        })
      });
    } catch (err) {
      console.error('Error updating tip:', err);
    }
  };

  // Cálculo de totales locales
  const getMyTotal = () => {
    if (!session || !currentParticipant) return 0;
    return calculateParticipantTotal(currentParticipant.id, true).total;
  };

  const toggleItemMode = (itemId) => {
    lastInteraction.current = Date.now();

    // Get current item and assignees
    const item = session.items.find(i => (i.id || i.name) === itemId);
    if (!item) return;

    const currentMode = item?.mode || 'individual';
    const newMode = currentMode === 'grupal' ? 'individual' : 'grupal';

    const currentAssignments = session.assignments[itemId] || [];
    const assigneeIds = currentAssignments.map(a => a.participant_id);

    // 1. Update mode via API (syncs to all participants)
    handleItemUpdate(itemId, { mode: newMode });

    // 2. Clear all current assignments via API
    for (const pid of assigneeIds) {
      fetch(`${API_URL}/api/session/${sessionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: itemId,
          participant_id: pid,
          quantity: 0,
          is_assigned: false,
          updated_by: currentParticipant?.name
        })
      }).catch(console.error);
    }

    // 3. Build new state atomically
    if (newMode === 'grupal') {
      // Switching TO grupal: assign all participants with correct share
      const allParticipantIds = session.participants.map(p => p.id);
      const itemQty = item.quantity || 1;
      const newShare = itemQty / allParticipantIds.length;

      const newAssignments = allParticipantIds.map(pid => ({
        participant_id: pid,
        quantity: newShare
      }));

      // Send API calls for new assignments
      allParticipantIds.forEach(pid => {
        fetch(`${API_URL}/api/session/${sessionId}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item_id: itemId,
            participant_id: pid,
            quantity: newShare,
            is_assigned: true,
            updated_by: currentParticipant?.name
          })
        }).catch(console.error);
      });

      // Optimistic UI update (atomic)
      setSession(prev => ({
        ...prev,
        assignments: { ...prev.assignments, [itemId]: newAssignments }
      }));
    } else {
      // Switching to individual - just clear (optimistic UI)
      setSession(prev => ({
        ...prev,
        assignments: { ...prev.assignments, [itemId]: [] }
      }));
    }
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

  // Handler for selecting existing participant (with phone confirmation)
  const handleSelectParticipant = (participant, phone) => {
    // Store phone if provided (for future use/validation)
    if (phone) {
      console.log(`Participant ${participant.name} confirmed with phone: ${phone}`);
    }
    setCurrentParticipant(participant);
  };

  // --- RENDER ---

  if (loading) return <div className="join-screen"><div className="spinner"></div></div>;
  if (error) return <div className="join-screen"><h3>⚠️ Error: {error}</h3></div>;

  // Show SelectionScreen for non-owners who haven't identified themselves
  if (!isOwner && !currentParticipant && session) {
    return (
      <SelectionScreen
        participants={session.participants}
        onSelectParticipant={handleSelectParticipant}
        onCreateNew={handleJoin}
        isLoading={joining}
      />
    );
  }

  // Helper for finalized totals
  const getMyFinalTotal = () => {
    if (!session?.totals || !currentParticipant) return 0;
    const myTotal = session.totals.find(t => t.participant_id === currentParticipant.id);
    return myTotal?.total || 0;
  };

  const isFinalized = session?.status === 'finalized';

  // Calculate validation metrics for bottom sheet
  // NOTE: item.price is UNIT PRICE (backend guarantees this after OCR auto-correction)

  // Total Items = sum of (unit_price × quantity) for all items (this is "Suma Items" - the moving reality)
  const totalItems = session.items.reduce((sum, item) => {
    return sum + (item.price * (item.quantity || 1));
  }, 0);

  // Total Assigned = sum of (unit_price × assigned_qty) for all items
  // CRITICAL: Use item.price directly (it's already unit price), NOT divided by quantity
  // Must include BOTH parent item assignments AND per-unit assignments (itemId_unit_N)
  const totalAsignado = session.items.reduce((acc, item) => {
    const itemId = item.id || item.name;
    const qty = item.quantity || 1;

    // Get assignments from parent item
    const parentAssignments = session.assignments[itemId] || [];
    const parentAssignedQty = parentAssignments.reduce((sum, a) => sum + (a.quantity || 0), 0);

    // Get assignments from per-unit (itemId_unit_N format)
    let unitAssignedQty = 0;
    for (let i = 0; i < qty; i++) {
      const unitAssigns = session.assignments[`${itemId}_unit_${i}`] || [];
      unitAssignedQty += unitAssigns.reduce((sum, a) => sum + (a.quantity || 0), 0);
    }

    // Total assigned for this item = parent + all units
    const totalItemAssigned = parentAssignedQty + unitAssignedQty;

    // Multiply assigned quantity by UNIT PRICE
    return acc + (totalItemAssigned * item.price);
  }, 0);

  // Total Boleta = OCR target subtotal (static unless manually changed by Host)
  const totalBoleta = session.subtotal || 0;

  // SMART TIP: Dynamic displayedTotal based on tip_mode
  const currentItemSum = totalItems; // Sum of all items at current prices
  const tipMode = session.tip_mode || 'percent';
  const tipValue = session.tip_value ?? session.tip_percentage ?? 10;

  // Calculate total tip amount based on mode
  let totalTipAmount = 0;
  if (tipMode === 'fixed') {
    totalTipAmount = tipValue; // Fixed amount
  } else {
    totalTipAmount = currentItemSum * (tipValue / 100); // Percentage
  }
  const displayedTotal = currentItemSum + totalTipAmount;

  // Check if totals are balanced (within $1 tolerance)
  const itemsMatch = Math.abs(totalItems - totalBoleta) < 1;
  const assignedMatch = Math.abs(totalAsignado - totalBoleta) < 1;
  const isBalanced = itemsMatch && assignedMatch;

  return (
    <div className="collaborative-session">
      {/* FLOATING TIMER - Top right corner */}
      <div className="floating-timer">⏱️ {timeLeft}</div>

      {/* Backdrop for expanded sheet */}
      {isSheetExpanded && !isFinalized && (
        <div className="sheet-backdrop" onClick={() => setIsSheetExpanded(false)} />
      )}

      {/* LISTA PARTICIPANTES - Right at the top */}
      <div className="participants-section">
        <div className="participants-list">
           {/* Add button first (ghost avatar style) - Anyone can add participants */}
           {!isFinalized && (
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
        {session.items.map((item, idx) => {
          const itemId = item.id || item.name;
          return (
            <div key={itemId || idx} className="item-wrapper">
              <BillItem
                item={item}
                assignments={session.assignments}
                participants={session.participants}
                currentParticipant={currentParticipant}
                isOwner={isOwner}
                onAssign={handleAssign}
                onGroupAssign={handleGroupAssign}
                onUnitAssign={handleUnitAssign}
                onClearUnitsAndAssignAll={handleClearUnitsAndAssignAll}
                onClearParent={handleClearParent}
                itemMode={item.mode || 'individual'}
                onToggleMode={toggleItemMode}
                isFinalized={session.status === 'finalized'}
                onEditItem={handleItemUpdate}
                onToggleEdit={handleToggleItemEdit}
                onDeleteItem={handleDeleteItem}
                isExpanded={expandedItems[itemId] || false}
                onToggleExpand={(id) => setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }))}
                isPerUnitMode={perUnitModeItems[itemId] || false}
                onSetPerUnitMode={(id, value) => setPerUnitModeItems(prev => ({ ...prev, [id]: value }))}
              />
            </div>
          );
        })}
        
        {isOwner && (
          <button className="add-item-btn" onClick={() => setShowAddItemModal(true)}>
            + Agregar Item Manual
          </button>
        )}
      </div>

      {/* BOTTOM SHEET (Interactive Expandable with Swipe) */}
      {/* All users can expand/collapse - starts collapsed, tap to see details */}
      <div className={`bottom-sheet ${isSheetExpanded || isFinalized ? 'expanded' : ''}`}>
        {/* Visual Handle - Swipe/Click to toggle for ALL users */}
        <div
          className="sheet-handle"
          onClick={() => !isFinalized && setIsSheetExpanded(!isSheetExpanded)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        />

        {isFinalized ? (
          // ============ FINALIZED VIEW (Always Expanded) ============
          <>
            {/* Header - Use local calc for consistent display */}
            <div className="sheet-summary-row">
              <div className="sheet-column">
                <span className="my-total-label finalized-label">
                  {isOwner ? '🎉 ¡Cuenta Cerrada!' : '🔒 Cuenta Cerrada'}
                </span>
              </div>
              <span className="my-total-amount">
                {/* Use local calc to avoid NaN - displayedTotal for Host, getMyTotal for Editor */}
                {formatCurrency(isOwner ? displayedTotal : getMyTotal())}
              </span>
            </div>

            {/* Breakdown - Only show to Host (Editors see simple closed status) */}
            {isOwner && (
              <div className="sheet-expanded-content">
                {/* STEP 3: Use local calculateParticipantTotal instead of session.totals */}
                <div className="sheet-breakdown">
                  {/* Column Headers */}
                  <div className="sheet-breakdown-header">
                    <span className="header-name">Nombre</span>
                    <span className="header-consumo">Subtotal</span>
                    <span className="header-total">Total</span>
                  </div>

                  {session.participants.map(p => {
                    const { subtotal, total } = calculateParticipantTotal(p.id, true);
                    return (
                      <div key={p.id} className="sheet-breakdown-item">
                        <div className="sheet-breakdown-person">
                          <span className="sheet-breakdown-avatar" style={{ background: getAvatarColor(p.name) }}>
                            {getInitials(p.name)}
                          </span>
                          <span className="sheet-breakdown-name">
                            {p.id === currentParticipant?.id ? 'Tú' : p.name}
                          </span>
                        </div>
                        <span className="sheet-breakdown-subtotal">{formatCurrency(subtotal)}</span>
                        <span className="sheet-breakdown-amount">{formatCurrency(total)}</span>
                      </div>
                    );
                  })}

                  <div className="sheet-breakdown-total">
                    <span>Total Mesa</span>
                    <span></span>
                    <span className="sheet-total-amount">{formatCurrency(displayedTotal)}</span>
                  </div>
                </div>

                {/* WhatsApp Share - Only for Host */}
                <button className="share-btn" onClick={handleShareWhatsapp}>
                  📱 Compartir por WhatsApp
                </button>

                <button className="btn-reopen" onClick={handleReopenSession}>
                  🔓 Reabrir Mesa para Editar
                </button>
              </div>
            )}

            {/* STEP 4: Editor sees simple "Closed" status with their total */}
            {!isOwner && (
              <div className="sheet-expanded-content">
                <div className="participant-breakdown">
                  <div className="breakdown-title">Tu parte final</div>
                  <div className="breakdown-row subtotal">
                    <span>Total a pagar</span>
                    <span><strong>{formatCurrency(getMyTotal())}</strong></span>
                  </div>
                </div>
                <button className="btn-main" disabled style={{ marginTop: '16px' }}>
                  🔒 Cuenta Cerrada
                </button>
              </div>
            )}
          </>
        ) : (
          // ============ ACTIVE VIEW ============
          <>
            {/* Summary Row - Clickable/Swipeable to expand for ALL users */}
            <div
              className="sheet-summary-row clickable"
              onClick={() => setIsSheetExpanded(!isSheetExpanded)}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <div className="sheet-column">
                <span className="my-total-label">
                  {isOwner ? 'Total Mesa' : 'Tu parte'}
                </span>
                {isOwner ? (
                  <small className={`sheet-subtitle ${isBalanced ? 'balanced' : 'warning'}`}>
                    {isBalanced ? '✓ Neteado' : '⚠️ Revisar subtotales'}
                  </small>
                ) : (
                  <small className="sheet-subtitle">Toca para ver detalle</small>
                )}
              </div>
              <span className="my-total-amount">
                {formatCurrency(isOwner ? displayedTotal : getMyTotal())}
              </span>
            </div>

            {/* EDITOR: Show breakdown only when expanded */}
            {!isOwner && isSheetExpanded && (
              <div className="participant-breakdown">
                <div className="breakdown-title">TU CONSUMO</div>
                {(() => {
                  const myItems = [];
                  let mySubtotal = 0;
                  Object.entries(session.assignments).forEach(([assignmentKey, assigns]) => {
                    const myAssign = assigns.find(a => a.participant_id === currentParticipant?.id);
                    if (myAssign) {
                      // Check if this is a unit assignment (format: itemId_unit_N)
                      const unitMatch = assignmentKey.match(/^(.+)_unit_(\d+)$/);
                      let item, itemName, isUnitAssignment = false;

                      if (unitMatch) {
                        // Unit assignment - find parent item
                        isUnitAssignment = true;
                        const baseItemId = unitMatch[1];
                        const unitNum = parseInt(unitMatch[2]) + 1;
                        item = session.items.find(i => (i.id || i.name) === baseItemId);
                        itemName = item ? `${item.name} (U${unitNum})` : `Unidad ${unitNum}`;
                      } else {
                        // Regular item assignment (parent item or individual)
                        item = session.items.find(i => (i.id || i.name) === assignmentKey);
                        itemName = item?.name || 'Item';
                      }

                      if (item) {
                        const amount = item.price * (myAssign.quantity || 0);
                        mySubtotal += amount;
                        const splitCount = assigns.length;
                        // For unit assignments, itemQty is always 1 (one unit)
                        // For parent assignments, itemQty is the total quantity
                        const itemQty = isUnitAssignment ? 1 : (item.quantity || 1);
                        myItems.push({ name: itemName, amount, splitCount, itemQty, isUnitAssignment });
                      }
                    }
                  });
                  // Use smart tip calculation
                  const tipModeLocal = session.tip_mode || 'percent';
                  const tipValueLocal = session.tip_value ?? session.tip_percentage ?? 10;
                  const numParticipants = session.participants?.length || 1;
                  let myTip = 0;
                  if (tipModeLocal === 'fixed') {
                    myTip = tipValueLocal / numParticipants;
                  } else {
                    myTip = mySubtotal * (tipValueLocal / 100);
                  }

                  return (
                    <>
                      {myItems.map((item, idx) => (
                        <div key={idx} className="breakdown-row">
                          <span>
                            {/* Unit assignments: just show /N (qty is always 1) */}
                            {/* Parent assignments: show Qx /N */}
                            {item.isUnitAssignment ? (
                              // Per-unit: just "/N itemName (UN)"
                              item.splitCount > 1 && <span className="split-badge">/{item.splitCount}</span>
                            ) : (
                              // Parent/individual: "Qx /N itemName" - always show qty for individual items
                              <>
                                <span className="qty-badge">{item.itemQty}x</span>
                                {item.splitCount > 1 && <span className="split-badge">/{item.splitCount}</span>}
                              </>
                            )}
                            {item.name}
                          </span>
                          <span>{formatCurrency(item.amount)}</span>
                        </div>
                      ))}
                      {myItems.length === 0 && (
                        <div className="breakdown-empty">Selecciona items arriba</div>
                      )}
                      {myItems.length > 0 && (
                        <>
                          <div className="breakdown-row subtotal">
                            <span>Subtotal</span>
                            <span>{formatCurrency(mySubtotal)}</span>
                          </div>
                          <div className="breakdown-row tip">
                            <span>Propina {tipModeLocal === 'percent' ? `(${tipValueLocal}%)` : '(fija)'}</span>
                            <span>{formatCurrency(myTip)}</span>
                          </div>
                          <div className="breakdown-row subtotal">
                            <span><strong>TOTAL</strong></span>
                            <span className="my-total-amount">{formatCurrency(mySubtotal + myTip)}</span>
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Owner Expanded: Validation Dashboard (only when expanded) */}
            {isOwner && isSheetExpanded && (
              <div className="sheet-expanded-content">
                <div className={`sheet-validation ${isBalanced ? 'balanced' : 'warning'}`}>
                  <div className="validation-grid">
                    <div className="validation-metric">
                      <span className="validation-metric-label">Subtotal Boleta</span>
                      <input
                        type="number"
                        className="validation-metric-input"
                        value={totalBoleta || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setSession(prev => ({ ...prev, subtotal: val }));
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div className="validation-metric">
                      <span className="validation-metric-label">Subtotal Items</span>
                      <span className={`validation-metric-value ${Math.abs(totalItems - totalBoleta) < 1 ? 'match' : 'mismatch'}`}>
                        {formatCurrency(totalItems)}
                      </span>
                    </div>
                    <div className="validation-metric">
                      <span className="validation-metric-label">Subtotal Asignado</span>
                      <span className={`validation-metric-value ${Math.abs(totalAsignado - totalBoleta) < 1 ? 'match' : 'mismatch'}`}>
                        {formatCurrency(totalAsignado)}
                      </span>
                    </div>
                  </div>

                  {/* Feedback */}
                  {isBalanced ? (
                    <div className="validation-feedback success">
                      ✅ Boleta Neteada
                    </div>
                  ) : (
                    <div className="validation-feedback warning">
                      {totalAsignado < totalBoleta
                        ? `Faltan ${formatCurrency(totalBoleta - totalAsignado)}`
                        : `Sobrepasado ${formatCurrency(totalAsignado - totalBoleta)}`
                      }
                    </div>
                  )}

                  {/* SMART TIP CONTROLS */}
                  <div className="tip-controls" onClick={(e) => e.stopPropagation()}>
                    <div className="tip-header">
                      <span className="tip-label">Propina</span>
                      <div className="tip-mode-switch">
                        <button
                          className={`tip-mode-btn ${tipMode === 'percent' ? 'active' : ''}`}
                          onClick={() => handleUpdateTip('percent', tipValue)}
                        >
                          %
                        </button>
                        <button
                          className={`tip-mode-btn ${tipMode === 'fixed' ? 'active' : ''}`}
                          onClick={() => handleUpdateTip('fixed', tipValue)}
                        >
                          $
                        </button>
                      </div>
                    </div>
                    <div className="tip-input-row">
                      <input
                        type="number"
                        className="tip-input"
                        value={tipValue || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          handleUpdateTip(tipMode, val);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.target.blur();
                          }
                        }}
                      />
                      <span className="tip-helper">
                        {tipMode === 'percent'
                          ? `= ${formatCurrency(totalTipAmount)}`
                          : `÷ ${session.participants?.length || 1} = ${formatCurrency(totalTipAmount / (session.participants?.length || 1))}/pers`
                        }
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Action Button - Always visible */}
            {isOwner ? (
              <button className="btn-main btn-dark" onClick={handleFinalize}>
                🔒 Cerrar Cuenta y Cobrar
              </button>
            ) : (
              <button className="btn-main" disabled>
                Esperando al anfitrión...
              </button>
            )}
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