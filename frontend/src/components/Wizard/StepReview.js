import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * StepReview - Paso 1: Verificación de items y cargos
 * Diseño unificado con Paso 3 (filas simples, sin tarjetas)
 * Diferencia: inputs editables invisibles hasta el focus
 */

// Inline editable input component
const InlineInput = ({ type, value, onSave, className }) => {
  const [localVal, setLocalVal] = useState(value?.toString() || '');

  const handleBlur = () => {
    let parsed = type === 'number'
      ? (parseFloat(localVal) || 0)
      : (localVal.trim() || 'Item');
    onSave(parsed);
  };

  return (
    <input
      type={type === 'number' ? 'number' : 'text'}
      value={localVal}
      className={`inline-edit ${className || ''}`}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
    />
  );
};

const StepReview = ({
  session,
  totalItems,
  totalBoleta,
  totalChargesAmount,
  itemsMatch,
  fmt,
  handleItemUpdate,
  handleDeleteItem,
  setShowAddItemModal,
  setShowChargeModal,
  setEditingCharge
}) => {
  const { t } = useTranslation();
  const difference = totalItems - totalBoleta;
  const hasDifference = Math.abs(difference) >= 1;

  return (
    <div className="step-review-unified step-container-animate">
      {/* Header: Total grande */}
      <div className="review-header">
        <span className="review-total-label">{t('totals.total')}</span>
        <div className="review-total-row">
          <span className="review-total-value">{fmt(totalBoleta + totalChargesAmount)}</span>
          {!hasDifference && <span className="review-check">✓</span>}
        </div>
        {hasDifference && (
          <span className="review-warning">
            {difference > 0
              ? t('validation.overItems', { amount: fmt(Math.abs(difference)) })
              : t('validation.missingItems', { amount: fmt(Math.abs(difference)) })
            }
          </span>
        )}
      </div>

      {/* Items list - unified with Step 3 style */}
      <div className="review-list">
        {/* Column Headers */}
        <div className="review-list-header">
          <span className="header-qty">{t('items.qty')}</span>
          <span className="header-name">{t('items.itemName')}</span>
          <span className="header-price">{t('items.unitPrice')}</span>
          <span className="header-total">{t('items.total')}</span>
        </div>

        {/* Items */}
        {session.items.map((item) => {
          const itemId = item.id || item.name;
          const qty = item.quantity || 1;
          const unitPrice = item.price || 0;
          const totalPrice = qty * unitPrice;

          return (
            <div key={itemId} className="review-row">
              <InlineInput
                type="number"
                value={qty}
                className="edit-qty"
                onSave={(val) => handleItemUpdate(itemId, { quantity: Math.max(1, Math.round(val)) })}
              />
              <InlineInput
                type="text"
                value={item.name}
                className="edit-name"
                onSave={(val) => handleItemUpdate(itemId, { name: val })}
              />
              <InlineInput
                type="number"
                value={unitPrice}
                className="edit-price"
                onSave={(val) => handleItemUpdate(itemId, { price: val })}
              />
              <span className="row-total">{fmt(totalPrice)}</span>
              <button
                className="row-delete"
                onClick={() => handleDeleteItem(itemId)}
                title={t('items.deleteItem')}
              >
                ×
              </button>
            </div>
          );
        })}

        {/* Add item button */}
        <button className="review-add-row" onClick={() => setShowAddItemModal(true)}>
          + {t('items.addManualItem')}
        </button>

        {/* Divider */}
        <div className="review-divider" />

        {/* Subtotal */}
        <div className="review-row summary">
          <span></span>
          <span>{t('totals.subtotal')}</span>
          <span></span>
          <span className="row-total">{fmt(totalItems)}</span>
        </div>

        {/* Charges */}
        {(session.charges || []).map(charge => (
          <div
            key={charge.id}
            className={`review-row charge ${charge.isDiscount ? 'discount' : ''}`}
            onClick={() => {
              setEditingCharge(charge);
              setShowChargeModal(true);
            }}
          >
            <span></span>
            <span className="charge-name">
              {charge.name}
              {charge.valueType === 'percent' && ` (${charge.value}%)`}
            </span>
            <span></span>
            <span className="row-total">
              {charge.isDiscount ? '−' : '+'}
              {fmt(charge.valueType === 'percent' ? (charge.calculatedAmount || 0) : charge.value)}
            </span>
          </div>
        ))}

        {/* Add charge button */}
        <button
          className="review-add-row"
          onClick={() => {
            setEditingCharge(null);
            setShowChargeModal(true);
          }}
        >
          + {t('charges.addCharge')}
        </button>

        {/* Final divider */}
        <div className="review-divider thick" />

        {/* Total */}
        <div className="review-row total-final">
          <span></span>
          <span>{t('totals.total')}</span>
          <span></span>
          <span className="row-total">{fmt(totalBoleta + totalChargesAmount)}</span>
        </div>
      </div>
    </div>
  );
};

export default StepReview;
