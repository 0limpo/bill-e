import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../utils/billEngine';
import Avatar from './Avatar';

// Helper: Input editable con estado local
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
  onSetPerUnitMode,
  isSyncing,
  decimalPlaces = 0,
  numberFormat = null,
  hideAssignments = false
}) => {
  const { t } = useTranslation();
  const fmt = (amount) => formatCurrency(amount, decimalPlaces, numberFormat);
  const itemId = item.id || item.name;
  const itemAssignments = assignments[itemId] || [];
  const isAssignedToMe = itemAssignments.some(a => a.participant_id === currentParticipant?.id);

  // Derive perUnitMode from synced assignments
  const hasUnitAssignments = Object.entries(assignments).some(([key, assigns]) =>
    key.startsWith(`${itemId}_unit_`) && assigns && assigns.length > 0
  );
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
      {/* Edit backdrop */}
      {isEditing && (
        <div className="edit-backdrop" onClick={() => onToggleEdit(itemId)} />
      )}

      <div className={`bill-item ${isAssignedToMe ? 'selected' : ''} ${isFinalized ? 'finalized' : ''} ${isEditing ? 'editing' : ''}`}>
        {/* GRID LAYOUT: Qty | Name | Price */}
        <div className="item-header" onClick={() => canEditItem && !isEditing && onToggleEdit(itemId)}>
          {isEditing ? (
            <div className="item-edit-grid" onClick={(e) => e.stopPropagation()}>
              <label className="edit-label">{t('items.qty')}</label>
              <label className="edit-label">{t('items.itemName')}</label>
              <label className="edit-label">{t('items.unitPrice')}</label>
              <span></span>

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
                title={t('items.deleteItem')}
              >
                🗑️
              </button>

              <div className="edit-total-row">
                {t('items.total')}: <strong>{fmt(totalPrice)}</strong>
              </div>
            </div>
          ) : (
            <>
              <span className="item-qty-badge">{qty}x</span>
              <span className={`item-name ${canEditItem ? 'editable' : ''}`}>{item.name}</span>
              <div className="item-price-col">
                <span className={`item-price ${canEditItem ? 'editable' : ''}`}>{fmt(totalPrice)}</span>
                {qty > 1 && (
                  <span className="item-unit-price">{fmt(unitPrice)} {t('items.perUnitSuffix')}</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Mode switch */}
        {!isEditing && !isFinalized && !hideAssignments && (
          <div className="item-mode-switch-container">
            <div className={`item-mode-switch ${isSyncing ? 'syncing' : ''}`}>
              <div
                className={`mode-option ${itemMode !== 'grupal' ? 'active' : ''}`}
                onClick={() => !isSyncing && onToggleMode(itemId)}
              >
                {t('items.individual')}
              </div>
              <div
                className={`mode-option ${itemMode === 'grupal' ? 'active' : ''}`}
                onClick={() => !isSyncing && onToggleMode(itemId)}
              >
                {t('items.grupal')}
              </div>
            </div>
            {isSyncing && <span className="sync-spinner" />}
          </div>
        )}

        {/* Grupal options for items with qty > 1 */}
        {!isEditing && item.quantity > 1 && itemMode === 'grupal' && !isFinalized && !hideAssignments && (() => {
          const allAssignedToParent = participants.length > 0 &&
            participants.every(p => itemAssignments.some(a => a.participant_id === p.id));

          return (
            <div className="grupal-options">
              <div className={`grupal-switch ${isSyncing ? 'syncing' : ''}`}>
                <div
                  className={`grupal-switch-option ${!effectivePerUnitMode ? 'active' : ''}`}
                  onClick={() => {
                    if (isSyncing) return;
                    if (effectivePerUnitMode) {
                      onClearUnitsAndAssignAll(itemId, qty);
                      onSetPerUnitMode(itemId, false);
                      if (isExpanded) onToggleExpand(itemId);
                    } else if (!allAssignedToParent) {
                      onGroupAssign(itemId, '__ALL__', true);
                    }
                  }}
                >
                  {!effectivePerUnitMode && allAssignedToParent ? '✓ ' : ''}👥 {t('items.allTogether')}
                </div>
                <div
                  className={`grupal-switch-option ${effectivePerUnitMode ? 'active' : ''}`}
                  onClick={() => {
                    if (isSyncing) return;
                    if (!effectivePerUnitMode) {
                      onSetPerUnitMode(itemId, true);
                      onClearParent(itemId);
                      if (!isExpanded) onToggleExpand(itemId);
                    } else {
                      onToggleExpand(itemId);
                    }
                  }}
                >
                  {t('items.perUnit')} {isExpanded ? '▲' : '▼'}
                </div>
              </div>
            </div>
          );
        })()}

        {/* EXPANDED TREE VIEW */}
        {!hideAssignments && isExpanded && itemMode === 'grupal' && qty > 1 ? (
          <div className="expanded-tree">
            {Array.from({ length: qty }, (_, unitIndex) => {
              const unitNum = unitIndex + 1;
              const unitId = `${itemId}_unit_${unitIndex}`;
              const unitAssignments = assignments[unitId] || [];

              return (
                <div key={unitIndex} className="tree-unit">
                  <div className="tree-connector"></div>
                  <div className="tree-unit-content">
                    <span className="tree-unit-label">{t('items.unit', { num: unitNum })}</span>
                    <div className="tree-unit-assignees">
                      {participants.map(p => {
                        const unitAssignment = unitAssignments.find(a => a.participant_id === p.id);
                        const isAssigned = unitAssignment && unitAssignment.quantity > 0;
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
        ) : !hideAssignments && itemMode === 'grupal' && qty > 1 ? (
          null
        ) : !hideAssignments ? (
          /* HORIZONTAL SCROLL LIST */
          <div className="consumer-scroll-list">
            {participants.map(p => {
              const assignment = itemAssignments.find(a => a.participant_id === p.id);
              const pQty = assignment?.quantity || 0;
              const isAssigned = pQty > 0;
              const canAssign = !isFinalized && currentParticipant;
              const displayName = p.id === currentParticipant?.id ? t('header.you') : p.name;

              return (
                <div
                  key={p.id}
                  className={`consumer-item-wrapper ${isAssigned ? 'assigned' : 'dimmed'}`}
                >
                  {itemMode === 'grupal' ? (
                    <div
                      className="avatar-wrapper"
                      onClick={() => canAssign && onGroupAssign(itemId, p.id, !isAssigned)}
                      style={{ position: 'relative', cursor: canAssign ? 'pointer' : 'default' }}
                    >
                      <Avatar name={p.name} />
                      {isAssigned && <span className="check-badge">✓</span>}
                    </div>
                  ) : (
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
        ) : null}

        {/* Warning for Individual mode */}
        {!hideAssignments && itemMode !== 'grupal' && remaining > 0 && totalAssigned > 0 && (
          <div className="grupal-warning">
            ⚠️ {t('validation.missingToAssign', { amount: remaining })}
          </div>
        )}
      </div>
    </>
  );
};

export default BillItem;
