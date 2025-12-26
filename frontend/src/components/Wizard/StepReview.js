import React from 'react';
import { useTranslation } from 'react-i18next';
import BillItem from './BillItem';

/**
 * StepReview - Paso 1: Verificación de items y cargos
 * Diseño minimalista estilo "Boleta Digital"
 */
const StepReview = ({
  session,
  currentParticipant,
  // Valores calculados
  totalItems,
  totalBoleta,
  totalChargesAmount,
  itemsMatch,
  fmt,
  // Estados de UI
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
  const difference = totalItems - totalBoleta;
  const hasDifference = Math.abs(difference) >= 1;

  return (
    <div className="step-review-receipt step-container-animate">
      {/* Header: Total grande flotante */}
      <div className="receipt-header">
        <span className="receipt-total-label">{t('totals.total')}</span>
        <div className="receipt-total-row">
          <span className="receipt-total-value">{fmt(totalBoleta + totalChargesAmount)}</span>
          {!hasDifference && <span className="receipt-check">✓</span>}
        </div>
        {hasDifference && (
          <span className="receipt-diff-warning">
            {difference > 0
              ? t('validation.overItems', { amount: fmt(Math.abs(difference)) })
              : t('validation.missingItems', { amount: fmt(Math.abs(difference)) })
            }
          </span>
        )}
      </div>

      {/* Lista de items estilo recibo */}
      <div className="receipt-items">
        {session.items.map((item, idx) => {
          const itemId = item.id || item.name;
          return (
            <BillItem
              key={itemId || idx}
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
              receiptMode={true}
            />
          );
        })}

        {/* Botón agregar item - sutil */}
        <button className="receipt-add-item" onClick={() => setShowAddItemModal(true)}>
          + {t('items.addManualItem')}
        </button>
      </div>

      {/* Línea divisoria */}
      <div className="receipt-divider" />

      {/* Subtotales */}
      <div className="receipt-subtotals">
        <div className="receipt-line">
          <span>{t('totals.subtotal')}</span>
          <span>{fmt(totalItems)}</span>
        </div>
      </div>

      {/* Cargos estilo recibo */}
      {(session.charges || []).length > 0 && (
        <div className="receipt-charges">
          {(session.charges || []).map(charge => (
            <div
              key={charge.id}
              className={`receipt-line receipt-charge ${charge.isDiscount ? 'discount' : ''}`}
              onClick={() => {
                setEditingCharge(charge);
                setShowChargeModal(true);
              }}
            >
              <span className="receipt-charge-name">
                {charge.name}
                {charge.valueType === 'percent' && ` (${charge.value}%)`}
              </span>
              <span className="receipt-charge-value">
                {charge.isDiscount ? '−' : '+'}
                {charge.valueType === 'percent'
                  ? fmt(charge.calculatedAmount || 0)
                  : fmt(charge.value)
                }
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Botón agregar cargo - sutil */}
      <button
        className="receipt-add-charge"
        onClick={() => {
          setEditingCharge(null);
          setShowChargeModal(true);
        }}
      >
        + {t('charges.addCharge')}
      </button>

      {/* Línea divisoria final */}
      <div className="receipt-divider thick" />

      {/* Total final */}
      <div className="receipt-final-total">
        <span>{t('totals.total')}</span>
        <span>{fmt(totalBoleta + totalChargesAmount)}</span>
      </div>
    </div>
  );
};

export default StepReview;
