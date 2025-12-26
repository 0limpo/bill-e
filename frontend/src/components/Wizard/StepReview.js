import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../utils/billEngine';
import BillItem from './BillItem';

/**
 * StepReview - Paso 1: Verificación de items y cargos
 * Solo visible para el host
 */
const StepReview = ({
  session,
  currentParticipant,
  // Valores calculados
  totalItems,
  totalChargesAmount,
  itemsMatch,
  fmt,
  // Estados de UI
  step1ItemsExpanded,
  setStep1ItemsExpanded,
  step1ChargesExpanded,
  setStep1ChargesExpanded,
  expandedItems,
  setExpandedItems,
  perUnitModeItems,
  setPerUnitModeItems,
  syncingItems,
  // Handlers
  handleAssign,
  handleGroupAssign,
  handleUnitAssign,
  handleClearUnitsAndAssignAll,
  handleClearParent,
  toggleItemMode,
  handleItemUpdate,
  handleToggleItemEdit,
  handleDeleteItem,
  setShowAddItemModal,
  setShowChargeModal,
  setEditingCharge
}) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="step-header">
        <h3>{t('steps.verifyTitle')}</h3>
        <p className="step-subtitle">{t('steps.verifySubtitle')}</p>
      </div>

      {/* Collapsible: Items */}
      <div className="collapsible-section">
        <div
          className="collapsible-header"
          onClick={() => setStep1ItemsExpanded(!step1ItemsExpanded)}
        >
          <span className="collapsible-title">
            {t('items.consumption')} ({session.items.length})
          </span>
          <div className="collapsible-right">
            <span className={`collapsible-total ${itemsMatch ? 'match' : 'mismatch'}`}>
              {fmt(totalItems)}
            </span>
            <span className="collapsible-arrow">{step1ItemsExpanded ? '▼' : '▶'}</span>
          </div>
        </div>
        {step1ItemsExpanded && (
          <div className="collapsible-content">
            {session.items.map((item, idx) => {
              const itemId = item.id || item.name;
              return (
                <div key={itemId || idx} className="item-wrapper">
                  <BillItem
                    item={item}
                    assignments={session.assignments}
                    participants={session.participants}
                    currentParticipant={currentParticipant}
                    isOwner={true}
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
                    hideAssignments={true}
                  />
                </div>
              );
            })}
            <button className="add-item-btn" onClick={() => setShowAddItemModal(true)}>
              {t('items.addManualItem')}
            </button>
          </div>
        )}
      </div>

      {/* Collapsible: Charges & Discounts */}
      <div className="collapsible-section">
        <div
          className="collapsible-header"
          onClick={() => setStep1ChargesExpanded(!step1ChargesExpanded)}
        >
          <span className="collapsible-title">
            {t('charges.title')} ({(session.charges || []).length})
          </span>
          <div className="collapsible-right">
            <span className="collapsible-total">
              {fmt(totalChargesAmount)}
            </span>
            <span className="collapsible-arrow">{step1ChargesExpanded ? '▼' : '▶'}</span>
          </div>
        </div>
        {step1ChargesExpanded && (
          <div className="collapsible-content">
            {(session.charges || []).length === 0 ? (
              <p className="empty-message">{t('charges.title')}: 0</p>
            ) : (
              <div className="charges-list-step1">
                {(session.charges || []).map(charge => (
                  <div
                    key={charge.id}
                    className={`charge-item ${charge.isDiscount ? 'discount' : ''}`}
                    onClick={() => {
                      setEditingCharge(charge);
                      setShowChargeModal(true);
                    }}
                  >
                    <span className="charge-name">{charge.name}</span>
                    <span className="charge-value">
                      {charge.isDiscount ? '-' : '+'}
                      {charge.valueType === 'percent' ? `${charge.value}%` : fmt(charge.value)}
                    </span>
                    <span className="charge-dist">
                      {charge.distribution === 'fixed_per_person'
                        ? t('charges.fixedPerPersonShort')
                        : charge.distribution === 'per_person'
                          ? t('charges.perPersonShort')
                          : t('charges.proportionalShort')}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button
              className="add-charge-btn-full"
              onClick={() => {
                setEditingCharge(null);
                setShowChargeModal(true);
              }}
            >
              + {t('charges.addCharge')}
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default StepReview;
