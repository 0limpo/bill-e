// CollaborativeSession.js
// Componente principal para sesiones colaborativas de Bill-e
// Diseño Mobile First con lógica completa de producción

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './CollaborativeSessionStepFlow.css';

// Imports de módulos refactorizados
import {
  formatCurrency,
  getAvatarColor,
  getInitials,
  calculateParticipantTotal as calcParticipantTotal
} from './utils/billEngine';
import { Avatar, StepIndicator, ChargeModal, BillItem, StepReview, StepShare } from './components/Wizard';

const API_URL = 'https://bill-e-backend-lfwp.onrender.com';

// Selection Screen - Pick existing participant or create new
const SelectionScreen = ({ participants, onSelectParticipant, onCreateNew, isLoading }) => {
  const { t } = useTranslation();
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
          <h1>{t('selection.hello', { name: selectedParticipant.name })}</h1>
          <p>{t('selection.confirmPhone')}</p>

          <input
            className={`join-input ${!phoneValid && phone.length > 0 ? 'input-error' : ''}`}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('selection.phonePlaceholder')}
            autoFocus
          />
          {!phoneValid && <span className="input-hint">{t('selection.phoneRequired')}</span>}

          <button
            className="btn-main"
            onClick={() => onSelectParticipant(selectedParticipant, phone)}
            disabled={isLoading || !phoneValid}
          >
            {isLoading ? t('selection.entering') : t('selection.confirmAndEnter')}
          </button>
          <button
            className="btn-secondary"
            onClick={() => { setSelectedParticipant(null); setPhone(''); }}
          >
            {t('selection.back')}
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
          <h1>{t('selection.newParticipant')}</h1>
          <p>{t('selection.enterDetails')}</p>

          <input
            className="join-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('selection.namePlaceholder')}
            autoFocus
          />
          <input
            className={`join-input ${!phoneValid && phone.length > 0 ? 'input-error' : ''}`}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('selection.phonePlaceholder')}
          />
          {!phoneValid && <span className="input-hint">{t('selection.phoneRequired')}</span>}

          <button
            className="btn-main"
            onClick={() => onCreateNew(name, phone)}
            disabled={isLoading || !name.trim() || !phoneValid}
          >
            {isLoading ? t('selection.joining') : t('selection.joinTable')}
          </button>
          <button
            className="btn-secondary"
            onClick={() => setShowNewForm(false)}
          >
            {t('selection.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="join-screen">
      <div className="join-card selection-card">
        <div className="join-icon">👋</div>
        <h1>{t('selection.whoAreYou')}</h1>
        <p>{t('selection.selectFromList')}</p>

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
          {t('selection.notInList')}
        </button>
      </div>
    </div>
  );
};

// Validation Dashboard Component (Host Only)
const ValidationDashboard = ({ session, onUpdateSubtotal, decimalPlaces = 0, numberFormat = null }) => {
  const { t } = useTranslation();
  const fmt = (amount) => formatCurrency(amount, decimalPlaces, numberFormat);
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
          <span className="validation-status success">✅ {t('validation.balanced')}</span>
        ) : (
          <span className="validation-status warning">⚠️ {t('validation.reviewTotals')}</span>
        )}
      </div>

      <div className="validation-metrics">
        <div className="metric">
          <span className="metric-label">{t('validation.totalItems')}</span>
          <span className={`metric-value ${itemsMatch ? 'match' : 'mismatch'}`}>
            {fmt(totalItems)}
          </span>
        </div>

        <div className="metric">
          <span className="metric-label">{t('validation.totalAssigned')}</span>
          <span className={`metric-value ${assignedMatch ? 'match' : 'mismatch'}`}>
            {fmt(totalAsignado)}
          </span>
        </div>

        <div className="metric editable">
          <span className="metric-label">{t('validation.totalBill')}</span>
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
              {fmt(totalBoleta)} ✏️
            </span>
          )}
        </div>
      </div>

      {!assignedMatch && totalAsignado < totalBoleta && (
        <div className="validation-warning">
          {t('validation.missingToAssign', { amount: fmt(totalBoleta - totalAsignado) })}
        </div>
      )}
      {!assignedMatch && totalAsignado > totalBoleta && (
        <div className="validation-warning">
          {t('validation.overAssigned', { amount: fmt(totalAsignado - totalBoleta) })}
        </div>
      )}
    </div>
  );
};

// --- COMPONENTE PRINCIPAL ---

const CollaborativeSession = () => {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
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

  // Items currently syncing (to block switches during API calls)
  const [syncingItems, setSyncingItems] = useState(new Set());

  // Expanded participants in finalized view (for host to see breakdown)
  const [expandedParticipants, setExpandedParticipants] = useState({});

  // Charge modal state
  const [showChargeModal, setShowChargeModal] = useState(false);
  const [editingCharge, setEditingCharge] = useState(null); // null = new, object = editing

  // Host step flow: 1 = verify receipt, 2 = assign consumptions, 3 = finalized
  const [hostStep, setHostStep] = useState(1);

  // Saved assignments per mode (to restore when switching back)
  // Structure: { [itemId]: { individual: {...}, grupal: {...} } }
  // Using useRef for immediate updates (not dependent on React render cycle)
  const savedModeAssignments = useRef({});

  // Interaction lock to prevent polling race condition
  const lastInteraction = useRef(0);

  // Touch tracking for swipe gesture on bottom sheet
  const touchStartY = useRef(0);

  // Currency formatter with session's decimal places and number format
  const fmt = (amount) => formatCurrency(amount, session?.decimal_places || 0, session?.number_format);

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
      if (!response.ok) throw new Error(t('errors.sessionNotFound'));

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
      // Extended to 8s to allow API calls to complete
      if (Date.now() - lastInteraction.current < 8000) return;

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
              totals: data.totals,
              // Sync tip settings
              tip_mode: data.tip_mode ?? prev.tip_mode,
              tip_value: data.tip_value ?? prev.tip_value,
              tip_percentage: data.tip_percentage ?? prev.tip_percentage,
              has_tip: data.has_tip ?? prev.has_tip,
              // Sync charges and formatting
              charges: data.charges ?? prev.charges,
              number_format: data.number_format ?? prev.number_format
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

  // Clear all unit assignments and switch to "entre todos" mode (with save/restore)
  const handleClearUnitsAndAssignAll = async (itemId, qty) => {
    lastInteraction.current = Date.now();

    // Block this item's switches during sync
    setSyncingItems(prev => new Set([...prev, itemId]));

    try {
      const item = session.items.find(i => (i.id || i.name) === itemId);
      if (!item) return;

      // 1. Save current unit assignments before clearing
      const currentUnitAssignments = {};
      for (let i = 0; i < qty; i++) {
        const unitId = `${itemId}_unit_${i}`;
        if (session.assignments[unitId] && session.assignments[unitId].length > 0) {
          currentUnitAssignments[unitId] = [...session.assignments[unitId]];
        }
      }

      // Save to ref for later restoration
      if (!savedModeAssignments.current[itemId]) {
        savedModeAssignments.current[itemId] = {};
      }
      savedModeAssignments.current[itemId].porUnidad = {
        units: currentUnitAssignments
      };

      // 2. Check if we have saved "entre todos" assignments to restore
      const savedEntreTodos = savedModeAssignments.current[itemId]?.entreTodos;

      // 3. Build new state and collect API calls
      const newAssignments = { ...session.assignments };
      const clearPromises = [];
      const assignPromises = [];

      // Clear all unit assignments
      for (let i = 0; i < qty; i++) {
        const unitId = `${itemId}_unit_${i}`;
        const unitAssigns = newAssignments[unitId] || [];
        unitAssigns.forEach(a => {
          clearPromises.push(
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
            }).catch(console.error)
          );
        });
        newAssignments[unitId] = [];
      }

      // 4. Restore saved "entre todos" or assign all participants
      const itemQty = item.quantity || 1;
      if (savedEntreTodos && savedEntreTodos.parent && savedEntreTodos.parent.length > 0) {
        // Restore saved parent assignments
        newAssignments[itemId] = savedEntreTodos.parent;
        savedEntreTodos.parent.forEach(a => {
          assignPromises.push(
            fetch(`${API_URL}/api/session/${sessionId}/assign`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                item_id: itemId,
                participant_id: a.participant_id,
                quantity: a.quantity,
                is_assigned: true,
                updated_by: currentParticipant?.name
              })
            }).catch(console.error)
          );
        });
      } else {
        // No saved state - assign all participants
        const allParticipantIds = session.participants.map(p => p.id);
        const newShare = itemQty / allParticipantIds.length;
        newAssignments[itemId] = allParticipantIds.map(pid => ({
          participant_id: pid,
          quantity: newShare
        }));
        allParticipantIds.forEach(pid => {
          assignPromises.push(
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
            }).catch(console.error)
          );
        });
      }

      // 5. Optimistic UI update
      setSession(prev => ({
        ...prev,
        assignments: newAssignments
      }));

      // 6. Wait for all API calls to complete
      await Promise.all(clearPromises);
      lastInteraction.current = Date.now();
      await Promise.all(assignPromises);
      lastInteraction.current = Date.now();
    } finally {
      // Unblock this item's switches
      setSyncingItems(prev => { const next = new Set(prev); next.delete(itemId); return next; });
    }
  };

  // Clear parent item assignments and switch to "por unidad" mode (with save/restore)
  const handleClearParent = async (itemId) => {
    lastInteraction.current = Date.now();

    // Block this item's switches during sync
    setSyncingItems(prev => new Set([...prev, itemId]));

    try {
      const item = session.items.find(i => (i.id || i.name) === itemId);
      if (!item) return;

      const currentAssignments = session.assignments[itemId] || [];

      // 1. Save current parent assignments before clearing
      if (!savedModeAssignments.current[itemId]) {
        savedModeAssignments.current[itemId] = {};
      }
      savedModeAssignments.current[itemId].entreTodos = {
        parent: [...currentAssignments]
      };

      // 2. Check if we have saved "por unidad" assignments to restore
      const savedPorUnidad = savedModeAssignments.current[itemId]?.porUnidad;

      // 3. Collect clear API calls
      const clearPromises = currentAssignments.map(a =>
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
        }).catch(console.error)
      );

      // 4. Build new state and collect restore API calls
      const newAssignments = { ...session.assignments, [itemId]: [] };
      const restorePromises = [];

      // 5. Restore saved unit assignments if any
      if (savedPorUnidad && savedPorUnidad.units && Object.keys(savedPorUnidad.units).length > 0) {
        Object.entries(savedPorUnidad.units).forEach(([unitId, assigns]) => {
          newAssignments[unitId] = assigns;
          assigns.forEach(a => {
            restorePromises.push(
              fetch(`${API_URL}/api/session/${sessionId}/assign`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  item_id: unitId,
                  participant_id: a.participant_id,
                  quantity: a.quantity,
                  is_assigned: true,
                  updated_by: currentParticipant?.name
                })
              }).catch(console.error)
            );
          });
        });
      }

      // 6. Optimistic UI update
      setSession(prev => ({
        ...prev,
        assignments: newAssignments
      }));

      // 7. Wait for all API calls to complete
      await Promise.all(clearPromises);
      lastInteraction.current = Date.now();
      await Promise.all(restorePromises);
      lastInteraction.current = Date.now();
    } finally {
      // Unblock this item's switches
      setSyncingItems(prev => { const next = new Set(prev); next.delete(itemId); return next; });
    }
  };

  const handleFinalize = async () => {
    if (!window.confirm(t('modals.confirmClose'))) return;
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

  // Generate share text - Used by both WhatsApp and Copy functions
  const generateShareText = () => {
    if (!session?.participants) return '';

    let text = `🧾 *Resumen Bill-e*\n\n`;

    // Use local calculateParticipantTotal instead of session.totals
    let grandTotal = 0;
    session.participants.forEach(p => {
      const { total } = calculateParticipantTotal(p.id);
      text += `• ${p.name}: ${fmt(total)}\n`;
      grandTotal += total;
    });

    text += `\n*Total Mesa: ${fmt(grandTotal)}*`;
    text += `\n\n📱 Ver detalle: https://bill-e.vercel.app/s/${sessionId}?v=B`;
    text += `\n\n🤖 *¿Quieres dividir tu cuenta fácil?*`;
    text += `\nAgrega a Bill-e: https://wa.me/15551925783`;

    return text;
  };

  // WhatsApp Share
  const handleShareWhatsapp = () => {
    const text = generateShareText();
    if (!text) return;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(whatsappUrl, '_blank');
  };

  // Copy to clipboard - For sharing via other apps (Telegram, etc.)
  const [copied, setCopied] = useState(false);
  const handleCopyShare = async () => {
    const text = generateShareText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Error copying:', err);
    }
  };

  // Reopen a finalized session
  const handleReopenSession = async () => {
    if (!window.confirm(t('modals.confirmReopen'))) return;

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
    if (!window.confirm(t('modals.confirmDelete'))) return;

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
  // Owner can edit anyone, editors can edit non-owners only
  const handleOpenParticipantEdit = (participant) => {
    // Editors cannot edit the host
    if (!isOwner && participant.role === 'owner') return;
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
  // Wrapper para usar la función de billEngine con el session del estado
  const calculateParticipantTotal = (participantId) => {
    return calcParticipantTotal(participantId, session);
  };

  // Handle save charge (add or edit)
  const handleSaveCharge = async (chargeData) => {
    lastInteraction.current = Date.now();
    const currentCharges = session.charges || [];
    let newCharges;

    const existingIdx = currentCharges.findIndex(c => c.id === chargeData.id);
    if (existingIdx >= 0) {
      // Edit existing
      newCharges = [...currentCharges];
      newCharges[existingIdx] = chargeData;
    } else {
      // Add new
      newCharges = [...currentCharges, chargeData];
    }

    // Optimistic update
    setSession(prev => ({ ...prev, charges: newCharges }));
    setShowChargeModal(false);
    setEditingCharge(null);

    // Persist to backend
    try {
      await fetch(`${API_URL}/api/session/${sessionId}/update-totals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_token: ownerToken,
          charges: newCharges
        })
      });
    } catch (err) {
      console.error('Error saving charge:', err);
    }
  };

  // Handle delete charge
  const handleDeleteCharge = async (chargeId) => {
    lastInteraction.current = Date.now();
    const currentCharges = session.charges || [];
    const newCharges = currentCharges.filter(c => c.id !== chargeId);

    // Optimistic update
    setSession(prev => ({ ...prev, charges: newCharges }));
    setShowChargeModal(false);
    setEditingCharge(null);

    // Persist to backend
    try {
      await fetch(`${API_URL}/api/session/${sessionId}/update-totals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_token: ownerToken,
          charges: newCharges
        })
      });
    } catch (err) {
      console.error('Error deleting charge:', err);
    }
  };

  // Cálculo de totales locales
  const getMyTotal = () => {
    if (!session || !currentParticipant) return 0;
    return calculateParticipantTotal(currentParticipant.id).total;
  };

  const toggleItemMode = async (itemId) => {
    lastInteraction.current = Date.now();

    // Block this item's switches during sync
    setSyncingItems(prev => new Set([...prev, itemId]));

    try {
      const item = session.items.find(i => (i.id || i.name) === itemId);
      if (!item) {
        setSyncingItems(prev => { const next = new Set(prev); next.delete(itemId); return next; });
        return;
      }

    const currentMode = item?.mode || 'individual';
    const newMode = currentMode === 'grupal' ? 'individual' : 'grupal';
    const itemQty = item.quantity || 1;

    // 1. Collect ALL current assignments (parent + units) for this item
    const currentParentAssignments = [...(session.assignments[itemId] || [])];
    const currentUnitAssignments = {};
    for (let i = 0; i < itemQty; i++) {
      const unitId = `${itemId}_unit_${i}`;
      if (session.assignments[unitId] && session.assignments[unitId].length > 0) {
        currentUnitAssignments[unitId] = [...session.assignments[unitId]];
      }
    }

    // 2. Get saved assignments for new mode (useRef is synchronous)
    const savedForNewMode = savedModeAssignments.current[itemId]?.[newMode];

    // 3. Save current mode's assignments (parent + units) to ref (immediate update)
    if (!savedModeAssignments.current[itemId]) {
      savedModeAssignments.current[itemId] = {};
    }
    savedModeAssignments.current[itemId][currentMode] = {
      parent: currentParentAssignments,
      units: currentUnitAssignments,
      perUnitMode: perUnitModeItems[itemId] || false
    };

    // 4. Update mode via API FIRST (critical - must complete before polling)
    await handleItemUpdate(itemId, { mode: newMode });
    lastInteraction.current = Date.now(); // Reset interaction timer

    // 5. Clear ALL current assignments via API (parent + units)
    const allAssignmentsToClear = [];
    currentParentAssignments.forEach(a => allAssignmentsToClear.push({ itemId, pid: a.participant_id }));
    Object.entries(currentUnitAssignments).forEach(([unitId, assigns]) => {
      assigns.forEach(a => allAssignmentsToClear.push({ itemId: unitId, pid: a.participant_id }));
    });

    // Wait for all clear operations
    await Promise.all(allAssignmentsToClear.map(({ itemId: assignItemId, pid }) =>
      fetch(`${API_URL}/api/session/${sessionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: assignItemId,
          participant_id: pid,
          quantity: 0,
          is_assigned: false,
          updated_by: currentParticipant?.name
        })
      }).catch(console.error)
    ));
    lastInteraction.current = Date.now(); // Reset interaction timer

    // 6. Build new assignments state
    const newAssignmentsState = { ...session.assignments };

    // Clear all unit assignments for this item
    for (let i = 0; i < itemQty; i++) {
      newAssignmentsState[`${itemId}_unit_${i}`] = [];
    }

    // 7. Optimistic UI update FIRST (before API calls for new assignments)
    if (savedForNewMode && (savedForNewMode.parent?.length > 0 || Object.keys(savedForNewMode.units || {}).length > 0)) {
      // Restore saved assignments to state
      newAssignmentsState[itemId] = savedForNewMode.parent || [];
      Object.entries(savedForNewMode.units || {}).forEach(([unitId, assigns]) => {
        newAssignmentsState[unitId] = assigns;
      });
      setPerUnitModeItems(prev => ({ ...prev, [itemId]: savedForNewMode.perUnitMode || false }));
    } else if (newMode === 'grupal') {
      const allParticipantIds = session.participants.map(p => p.id);
      const newShare = itemQty / allParticipantIds.length;
      newAssignmentsState[itemId] = allParticipantIds.map(pid => ({ participant_id: pid, quantity: newShare }));
      setPerUnitModeItems(prev => ({ ...prev, [itemId]: false }));
    } else {
      newAssignmentsState[itemId] = [];
      setPerUnitModeItems(prev => ({ ...prev, [itemId]: false }));
    }

    setSession(prev => ({ ...prev, assignments: newAssignmentsState }));

    // 8. Send API calls to persist new assignments (await all)
    const assignmentPromises = [];

    if (savedForNewMode && (savedForNewMode.parent?.length > 0 || Object.keys(savedForNewMode.units || {}).length > 0)) {
      // Restore saved assignments via API
      (savedForNewMode.parent || []).forEach(a => {
        assignmentPromises.push(
          fetch(`${API_URL}/api/session/${sessionId}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              item_id: itemId,
              participant_id: a.participant_id,
              quantity: a.quantity,
              is_assigned: true,
              updated_by: currentParticipant?.name
            })
          }).catch(console.error)
        );
      });

      Object.entries(savedForNewMode.units || {}).forEach(([unitId, assigns]) => {
        assigns.forEach(a => {
          assignmentPromises.push(
            fetch(`${API_URL}/api/session/${sessionId}/assign`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                item_id: unitId,
                participant_id: a.participant_id,
                quantity: a.quantity,
                is_assigned: true,
                updated_by: currentParticipant?.name
              })
            }).catch(console.error)
          );
        });
      });
    } else if (newMode === 'grupal') {
      const allParticipantIds = session.participants.map(p => p.id);
      const newShare = itemQty / allParticipantIds.length;

      allParticipantIds.forEach(pid => {
        assignmentPromises.push(
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
          }).catch(console.error)
        );
      });
    }

    await Promise.all(assignmentPromises);
    lastInteraction.current = Date.now(); // Final reset after all API calls complete
    } finally {
      // Unblock this item's switches
      setSyncingItems(prev => { const next = new Set(prev); next.delete(itemId); return next; });
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
      alert(t('errors.invalidPrice'));
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
      alert(t('errors.createItemError'));
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
      alert(t('errors.connectionError'));
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

  // Calculate displayedTotal: items + charges (tip is now included in charges)
  const currentItemSum = totalItems; // Sum of all items at current prices

  // Calculate total charges (taxes, service fees, discounts, tips)
  const numParticipants = session.participants?.length || 1;
  let totalChargesAmount = 0;
  (session.charges || []).forEach(charge => {
    const value = charge.value || 0;
    const valueType = charge.valueType || 'fixed';
    const isDiscount = charge.isDiscount || false;
    const distribution = charge.distribution || 'proportional';

    let chargeAmount = valueType === 'percent'
      ? currentItemSum * (value / 100)
      : value;

    // For fixed_per_person, multiply by number of participants for total
    if (distribution === 'fixed_per_person') {
      chargeAmount = chargeAmount * numParticipants;
    }

    if (isDiscount) chargeAmount = -chargeAmount;
    totalChargesAmount += chargeAmount;
  });

  const displayedTotal = currentItemSum + totalChargesAmount;

  // Check if totals are balanced (within $1 tolerance)
  const itemsMatch = Math.abs(totalItems - totalBoleta) < 1;
  const assignedMatch = Math.abs(totalAsignado - totalBoleta) < 1;
  const isBalanced = itemsMatch && assignedMatch;

  // Auto-advance to step 3 when finalized
  const effectiveStep = isFinalized ? 3 : hostStep;

  return (
    <div className={`collaborative-session ${isRTL ? 'rtl' : ''} ${isOwner ? `host-step-${effectiveStep}` : ''}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* FLOATING TIMER - Top right corner */}
      <div className="floating-timer">{t('time.timer', { time: timeLeft })}</div>

      {/* STEP INDICATOR - Host only, always visible including Step 3 */}
      {isOwner && (
        <StepIndicator
          currentStep={effectiveStep}
          onStepClick={(step) => !isFinalized && setHostStep(step)}
        />
      )}

      {/* Backdrop for expanded sheet */}
      {isSheetExpanded && !isFinalized && effectiveStep !== 1 && (
        <div className="sheet-backdrop" onClick={() => setIsSheetExpanded(false)} />
      )}

      {/* LISTA PARTICIPANTES - Host: only in Step 2 | Editors: always visible */}
      {(!isOwner || effectiveStep === 2) && (
        <div className="participants-section">
          <div className="participants-list">
             {/* Add button - Anyone can add participants when not finalized */}
             {!isFinalized && (
               <button className="add-participant-btn" onClick={() => setShowAddParticipant(true)}>
                 <span className="add-btn-label">{t('items.add')}</span>
               </button>
             )}
             {session.participants.map(p => {
                const canEdit = session.status !== 'finalized' && (isOwner || p.role !== 'owner');
                return (
                <div
                  key={p.id}
                  className={`participant-chip ${p.id === currentParticipant?.id ? 'current' : ''} ${canEdit ? 'clickable' : ''}`}
                  onClick={() => canEdit && handleOpenParticipantEdit(p)}
                >
                  {p.role === 'owner' && <span className="badge-owner">{t('header.host')}</span>}
                  <Avatar name={p.name} />
                  <span className="participant-name">{p.id === currentParticipant?.id ? t('header.you') : p.name}</span>
                </div>
             );})}
          </div>
        </div>
      )}

      {/* LISTA ITEMS */}
      <div className="items-section">
        {/* Step 1: Verification (extracted component) */}
        {isOwner && effectiveStep === 1 && (
          <StepReview
            session={session}
            totalItems={totalItems}
            totalBoleta={totalBoleta}
            totalChargesAmount={totalChargesAmount}
            itemsMatch={itemsMatch}
            fmt={fmt}
            handleItemUpdate={handleItemUpdate}
            handleDeleteItem={handleDeleteItem}
            setShowAddItemModal={setShowAddItemModal}
            setShowChargeModal={setShowChargeModal}
            setEditingCharge={setEditingCharge}
          />
        )}

        {/* Step 2: Title for assignment */}
        {isOwner && effectiveStep === 2 && (
          <div className="step-container-animate">
            <div className="step-header">
              <h3>{t('steps.assignTitle')}</h3>
              <p className="step-subtitle">{t('steps.assignSubtitle')}</p>
            </div>
          </div>
        )}
        {/* Editors see normal title */}
        {!isOwner && <h3>{t('items.consumption')}</h3>}

        {/* Items list for Step 2 and editors (hide in Step 3 for owner) */}
        {(!isOwner || (effectiveStep !== 1 && effectiveStep !== 3)) && session.items.map((item, idx) => {
          const itemId = item.id || item.name;
          const isVerifyStep = isOwner && effectiveStep === 1;
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
                isSyncing={syncingItems.has(itemId)}
                decimalPlaces={session?.decimal_places || 0}
                numberFormat={session?.number_format}
                hideAssignments={isVerifyStep}
              />
            </div>
          );
        })}
      </div>

      {/* Step 3: Final breakdown (extracted component) */}
      {isOwner && effectiveStep === 3 && (
        <StepShare
          session={session}
          currentParticipant={currentParticipant}
          expandedParticipants={expandedParticipants}
          setExpandedParticipants={setExpandedParticipants}
          calculateParticipantTotal={calculateParticipantTotal}
          displayedTotal={displayedTotal}
          fmt={fmt}
        />
      )}

      {/* BOTTOM SHEET - Different layouts per step */}
      <div className={`bottom-sheet ${isSheetExpanded && effectiveStep === 2 ? 'expanded' : ''} step-${effectiveStep}`}>
        {/* Visual Handle - Only for Step 2 */}
        {effectiveStep === 2 && (
          <div
            className="sheet-handle"
            onClick={() => setIsSheetExpanded(!isSheetExpanded)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          />
        )}

        {isFinalized ? (
          // ============ FINALIZED VIEW ============
          <>
            {/* Host: Simple share buttons (breakdown is in main area) */}
            {isOwner && (
              <div className="step3-actions">
                <div className="share-buttons">
                  <button className="share-btn whatsapp" onClick={handleShareWhatsapp}>
                    📱 WhatsApp
                  </button>
                  <button className="share-btn copy" onClick={handleCopyShare}>
                    {copied ? '✓ Copiado' : '📋 Copiar'}
                  </button>
                </div>
                <button className="btn-reopen" onClick={handleReopenSession}>
                  🔓 {t('finalized.reopenTable')}
                </button>
              </div>
            )}

            {/* STEP 4: Editor sees full breakdown with "Cuenta Cerrada" message */}
            {!isOwner && (
              <div className="sheet-expanded-content">
                <div className="participant-breakdown">
                  <div className="breakdown-title">{t('totals.yourConsumption')}</div>
                  {(() => {
                    const myItems = [];
                    let mySubtotal = 0;

                    // Pre-scan: detect which items have unit assignments (are in "por unidad" mode)
                    const itemsWithUnitAssignments = new Set();
                    Object.keys(session.assignments).forEach(key => {
                      const unitMatch = key.match(/^(.+)_unit_(\d+)$/);
                      if (unitMatch) {
                        const assigns = session.assignments[key] || [];
                        if (assigns.length > 0) {
                          itemsWithUnitAssignments.add(unitMatch[1]);
                        }
                      }
                    });

                    Object.entries(session.assignments).forEach(([assignmentKey, assigns]) => {
                      const myAssign = assigns.find(a => a.participant_id === currentParticipant?.id);
                      if (myAssign) {
                        const unitMatch = assignmentKey.match(/^(.+)_unit_(\d+)$/);
                        let item, itemName, isUnitAssignment = false;

                        if (unitMatch) {
                          isUnitAssignment = true;
                          const baseItemId = unitMatch[1];
                          const unitNum = parseInt(unitMatch[2]) + 1;
                          item = session.items.find(i => (i.id || i.name) === baseItemId);
                          itemName = item ? `${item.name} (U${unitNum})` : `Unidad ${unitNum}`;
                        } else {
                          item = session.items.find(i => (i.id || i.name) === assignmentKey);
                          itemName = item?.name || 'Item';

                          // Skip parent assignment if item has unit assignments (avoid duplicates)
                          if (item && item.mode === 'grupal' && itemsWithUnitAssignments.has(assignmentKey)) {
                            return; // Skip this parent, units will be shown instead
                          }
                        }

                        if (item) {
                          const amount = item.price * (myAssign.quantity || 0);
                          mySubtotal += amount;
                          const splitCount = assigns.length;
                          const itemMode = item.mode || 'individual';
                          // For individual items: show participant's consumed quantity
                          // For grupal/unit: show item quantity or 1 for units
                          const itemQty = itemMode === 'individual'
                            ? Math.round(myAssign.quantity || 1)
                            : (isUnitAssignment ? 1 : (item.quantity || 1));
                          myItems.push({ name: itemName, amount, splitCount, itemQty, isUnitAssignment, itemMode });
                        }
                      }
                    });
                    const numParticipants = session.participants?.length || 1;

                    // Calculate charges for finalized editor view (tip is now included in charges)
                    const sessionChargesFinalized = session.charges || [];
                    let myChargesTotalFinalized = 0;
                    const myChargesFinalized = [];
                    let totalSubtotalAllFinalized = 0;
                    session.participants?.forEach(p => {
                      Object.entries(session.assignments).forEach(([key, assigns]) => {
                        const assign = assigns.find(a => a.participant_id === p.id);
                        if (assign) {
                          const unitMatch = key.match(/^(.+)_unit_(\d+)$/);
                          const itemId = unitMatch ? unitMatch[1] : key;
                          const item = session.items.find(i => (i.id || i.name) === itemId);
                          if (item) totalSubtotalAllFinalized += item.price * (assign.quantity || 0);
                        }
                      });
                    });
                    const myRatioFinalized = totalSubtotalAllFinalized > 0 ? mySubtotal / totalSubtotalAllFinalized : 1 / numParticipants;
                    sessionChargesFinalized.forEach(charge => {
                      const value = charge.value || 0;
                      const valueType = charge.valueType || 'fixed';
                      const isDiscount = charge.isDiscount || false;
                      const distribution = charge.distribution || 'proportional';
                      let chargeAmount = valueType === 'percent' ? totalSubtotalAllFinalized * (value / 100) : value;
                      let myCharge = distribution === 'per_person' ? chargeAmount / numParticipants : chargeAmount * myRatioFinalized;
                      if (isDiscount) myCharge = -myCharge;
                      if (Math.abs(myCharge) > 0) {
                        myChargesFinalized.push({ id: charge.id, name: charge.name, amount: myCharge, isDiscount });
                        myChargesTotalFinalized += myCharge;
                      }
                    });

                    return (
                      <>
                        {myItems.map((item, idx) => (
                          <div key={idx} className="breakdown-row">
                            <span>
                              {item.isUnitAssignment ? (
                                item.splitCount > 1 && <span className="split-badge">/{item.splitCount}</span>
                              ) : (
                                <>
                                  <span className="qty-badge">{item.itemQty}x</span>
                                  {item.itemMode === 'grupal' && item.splitCount > 1 && <span className="split-badge">/{item.splitCount}</span>}
                                </>
                              )}
                              {item.name}
                            </span>
                            <span>{fmt(item.amount)}</span>
                          </div>
                        ))}
                        {myItems.length > 0 && (
                          <>
                            <div className="breakdown-row subtotal">
                              <span>{t('totals.subtotal')}</span>
                              <span>{fmt(mySubtotal)}</span>
                            </div>
                            {/* Show charges (only if non-zero) - tip is now included in charges */}
                            {myChargesFinalized.map(charge => (
                              <div key={charge.id} className={`breakdown-row charge ${charge.isDiscount ? 'discount' : ''}`}>
                                <span>{charge.name}</span>
                                <span>{charge.isDiscount ? '-' : '+'}{fmt(Math.abs(charge.amount))}</span>
                              </div>
                            ))}
                            <div className="breakdown-row subtotal">
                              <span><strong>{t('totals.total')}</strong></span>
                              <span className="my-total-amount">{fmt(mySubtotal + myChargesTotalFinalized)}</span>
                            </div>
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>
                <button className="btn-main" disabled style={{ marginTop: '16px' }}>
                  🔒 {t('finalized.billClosed')}
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
                  {isOwner ? t('totals.tableTotal') : t('totals.total')}
                </span>
                {isOwner ? (
                  <small className={`sheet-subtitle ${isBalanced ? 'balanced' : 'warning'}`}>
                    {isBalanced ? `✓ ${t('validation.balanced')}` : `⚠️ ${t('validation.reviewTotals')}`}
                  </small>
                ) : (
                  <small className="sheet-subtitle">{t('totals.tapForDetails')}</small>
                )}
              </div>
              <span className="my-total-amount">
                {fmt(isOwner ? displayedTotal : getMyTotal())}
              </span>
            </div>

            {/* EDITOR: Show breakdown only when expanded */}
            {!isOwner && isSheetExpanded && (
              <div className="participant-breakdown">
                <div className="breakdown-title">{t('totals.yourConsumption')}</div>
                {(() => {
                  const myItems = [];
                  let mySubtotal = 0;

                  // Pre-scan: detect which items have unit assignments (are in "por unidad" mode)
                  const itemsWithUnitAssignments = new Set();
                  Object.keys(session.assignments).forEach(key => {
                    const unitMatch = key.match(/^(.+)_unit_(\d+)$/);
                    if (unitMatch) {
                      const assigns = session.assignments[key] || [];
                      if (assigns.length > 0) {
                        itemsWithUnitAssignments.add(unitMatch[1]);
                      }
                    }
                  });

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

                        // Skip parent assignment if item has unit assignments (avoid duplicates)
                        if (item && item.mode === 'grupal' && itemsWithUnitAssignments.has(assignmentKey)) {
                          return; // Skip this parent, units will be shown instead
                        }
                      }

                      if (item) {
                        const amount = item.price * (myAssign.quantity || 0);
                        mySubtotal += amount;
                        const splitCount = assigns.length;
                        const itemMode = item.mode || 'individual';
                        // For individual items: show participant's consumed quantity
                        // For grupal/unit: show item quantity or 1 for units
                        const itemQty = itemMode === 'individual'
                          ? Math.round(myAssign.quantity || 1)
                          : (isUnitAssignment ? 1 : (item.quantity || 1));
                        myItems.push({ name: itemName, amount, splitCount, itemQty, isUnitAssignment, itemMode });
                      }
                    }
                  });
                  const numParticipants = session.participants?.length || 1;

                  // Calculate charges for editor (tip is now included in charges)
                  const sessionCharges = session.charges || [];
                  let myChargesTotal = 0;
                  const myCharges = [];

                  // Calculate total subtotal for ratio (needed for proportional distribution)
                  let totalSubtotalAll = 0;
                  session.participants?.forEach(p => {
                    Object.entries(session.assignments).forEach(([key, assigns]) => {
                      const assign = assigns.find(a => a.participant_id === p.id);
                      if (assign) {
                        const unitMatch = key.match(/^(.+)_unit_(\d+)$/);
                        const itemId = unitMatch ? unitMatch[1] : key;
                        const item = session.items.find(i => (i.id || i.name) === itemId);
                        if (item) totalSubtotalAll += item.price * (assign.quantity || 0);
                      }
                    });
                  });
                  const myRatio = totalSubtotalAll > 0 ? mySubtotal / totalSubtotalAll : 1 / numParticipants;

                  sessionCharges.forEach(charge => {
                    const value = charge.value || 0;
                    const valueType = charge.valueType || 'fixed';
                    const isDiscount = charge.isDiscount || false;
                    const distribution = charge.distribution || 'proportional';

                    let chargeAmount = valueType === 'percent' ? totalSubtotalAll * (value / 100) : value;
                    let myCharge = distribution === 'per_person' ? chargeAmount / numParticipants : chargeAmount * myRatio;
                    if (isDiscount) myCharge = -myCharge;

                    if (Math.abs(myCharge) > 0) {
                      myCharges.push({ id: charge.id, name: charge.name, amount: myCharge, isDiscount });
                      myChargesTotal += myCharge;
                    }
                  });

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
                              // Parent/individual: "Qx itemName" for individual, "Qx /N itemName" for grupal
                              <>
                                <span className="qty-badge">{item.itemQty}x</span>
                                {item.itemMode === 'grupal' && item.splitCount > 1 && <span className="split-badge">/{item.splitCount}</span>}
                              </>
                            )}
                            {item.name}
                          </span>
                          <span>{fmt(item.amount)}</span>
                        </div>
                      ))}
                      {myItems.length === 0 && (
                        <div className="breakdown-empty">{t('totals.selectItemsAbove')}</div>
                      )}
                      {myItems.length > 0 && (
                        <>
                          <div className="breakdown-row subtotal">
                            <span>{t('totals.subtotal')}</span>
                            <span>{fmt(mySubtotal)}</span>
                          </div>
                          {/* Show charges (only if non-zero) - tip is now included in charges */}
                          {myCharges.map(charge => (
                            <div key={charge.id} className={`breakdown-row charge ${charge.isDiscount ? 'discount' : ''}`}>
                              <span>{charge.name}</span>
                              <span>{charge.isDiscount ? '-' : '+'}{fmt(Math.abs(charge.amount))}</span>
                            </div>
                          ))}
                          <div className="breakdown-row subtotal">
                            <span><strong>{t('totals.total')}</strong></span>
                            <span className="my-total-amount">{fmt(mySubtotal + myChargesTotal)}</span>
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Owner Step 1: Minimal - just status indicator */}
            {isOwner && effectiveStep === 1 && !itemsMatch && (
              <div className="step1-minimal-status">
                <span className="step1-warning">⚠️ {t('validation.reviewTotals')}</span>
              </div>
            )}

            {/* Owner Step 2: Participants + Progress */}
            {isOwner && effectiveStep === 2 && (
              <>
                {/* Participants row - sticky at bottom */}
                <div className="step2-participants">
                  <div className="step2-participants-scroll">
                    <button className="add-participant-btn-small" onClick={() => setShowAddParticipant(true)}>
                      +
                    </button>
                    {session.participants.map(p => {
                      const canEdit = session.status !== 'finalized';
                      return (
                        <div
                          key={p.id}
                          className={`participant-chip-small ${p.id === currentParticipant?.id ? 'current' : ''}`}
                          onClick={() => canEdit && handleOpenParticipantEdit(p)}
                        >
                          <Avatar name={p.name} size="small" />
                          <span>{p.id === currentParticipant?.id ? t('header.you') : p.name.split(' ')[0]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Assignment progress inline */}
                <div className="step2-progress-row">
                  <div className="step2-progress-info">
                    <span>{fmt(totalAsignado)} / {fmt(totalBoleta)}</span>
                    <span className={assignedMatch ? 'match' : 'mismatch'}>
                      {assignedMatch ? '✓' : `${Math.round((totalAsignado / totalBoleta) * 100)}%`}
                    </span>
                  </div>
                  <div className="assignment-progress">
                    <div
                      className="assignment-progress-bar"
                      style={{ width: `${Math.min(100, (totalAsignado / totalBoleta) * 100)}%` }}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Action Buttons */}
            {isOwner ? (
              effectiveStep === 1 ? (
                /* Step 1: Continue button */
                <button className="btn-main btn-primary" onClick={() => setHostStep(2)}>
                  {t('steps.continue')} →
                </button>
              ) : effectiveStep === 2 ? (
                /* Step 2: Back and Close Bill buttons */
                <div className="step-buttons">
                  <button className="btn-secondary" onClick={() => setHostStep(1)}>
                    ← {t('steps.back')}
                  </button>
                  <button className="btn-main btn-dark" onClick={handleFinalize}>
                    🔒 {t('finalized.closeBill')}
                  </button>
                </div>
              ) : null
            ) : (
              <button className="btn-main" disabled>
                {t('finalized.billOpen')}
              </button>
            )}
          </>
        )}
      </div>

      {/* CHARGE MODAL */}
      {showChargeModal && (
        <ChargeModal
          charge={editingCharge}
          onSave={handleSaveCharge}
          onClose={() => {
            setShowChargeModal(false);
            setEditingCharge(null);
          }}
          onDelete={editingCharge ? handleDeleteCharge : null}
        />
      )}

      {/* MODAL AGREGAR PARTICIPANTE (Simple) */}
      {showAddParticipant && (
        <div className="modal-overlay" onClick={() => setShowAddParticipant(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{t('header.addParticipant')}</h3>
            <input
              className="join-input"
              value={newParticipantName}
              onChange={e => setNewParticipantName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddParticipant(); }}
              placeholder={t('items.name')}
              autoFocus
            />
            <button
              className="btn-main"
              disabled={!newParticipantName.trim() || isAddingParticipant}
              onClick={handleAddParticipant}
            >
              {isAddingParticipant ? t('selection.joining') : t('items.add')}
            </button>
          </div>
        </div>
      )}

      {showAddItemModal && (
        <div className="modal-overlay" onClick={() => !isCreatingItem && setShowAddItemModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{t('items.newItem')}</h3>
            <input
              className="join-input"
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              placeholder={t('participant.whatDidTheyOrder')}
              autoFocus
              disabled={isCreatingItem}
            />
            <input
              className="join-input"
              type="number"
              value={newItemPrice}
              onChange={e => setNewItemPrice(e.target.value)}
              placeholder={t('items.price')}
              disabled={isCreatingItem}
            />
            <button
              className="btn-main"
              onClick={handleAddNewItem}
              disabled={isCreatingItem}
            >
              {isCreatingItem ? t('selection.joining') : t('items.add')}
            </button>
          </div>
        </div>
      )}

      {/* Manage Participant Modal */}
      {editingParticipant && (
        <div className="modal-overlay" onClick={() => setEditingParticipant(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{t('participant.editParticipant')}</h3>
            <input
              className="join-input"
              value={editParticipantName}
              onChange={e => setEditParticipantName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveParticipantName(); }}
              placeholder={t('items.name')}
              autoFocus
            />
            <button
              className="btn-main"
              disabled={!editParticipantName.trim() || editParticipantName === editingParticipant.name}
              onClick={handleSaveParticipantName}
            >
              {t('participant.save')}
            </button>
            {editingParticipant.role !== 'owner' && (
              <button
                className="btn-danger"
                onClick={handleRemoveParticipant}
              >
                {t('modals.delete')}
              </button>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default CollaborativeSession;