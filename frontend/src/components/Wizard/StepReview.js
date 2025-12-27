import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * StepReview - Paso 1: Verificación de items
 * Estilo unificado: Lista limpia (igual al Paso 3) con inputs invisibles.
 */

// Componente de Input Invisible
const InlineInput = ({ type, value, onSave, className }) => {
  const [localVal, setLocalVal] = useState(value?.toString() || '');

  const handleBlur = () => {
    let parsed = type === 'number'
      ? (parseFloat(localVal) || 0)
      : (localVal.trim() || 'Item');
    // Solo guardar si cambió
    if (parsed != value) {
      onSave(parsed);
    }
  };

  return (
    <input
      type={type === 'number' ? 'number' : 'text'}
      value={localVal}
      className={`inline-edit ${className || ''}`}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
      placeholder={type === 'text' ? 'Nombre del item' : '0'}
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
    <div className="step-review-container step-container-animate">

      {/* 1. Header Gigante (Estilo Fintech) */}
      <div className="review-header">
        <span className="review-total-label">{t('totals.total')}</span>
        <div className="review-total-row">
          <span className="review-total-value">{fmt(totalBoleta + totalChargesAmount)}</span>
        </div>

        {/* Aviso de validación flotante */}
        {hasDifference && (
          <div className="review-warning">
            {difference > 0
              ? `Sobran ${fmt(Math.abs(difference))}`
              : `Faltan ${fmt(Math.abs(difference))}`
            }
          </div>
        )}
      </div>

      {/* 2. Lista de Items (Clean List Style) */}
      <div className="review-list">
        {session.items.map((item) => {
          const itemId = item.id || item.name;
          const qty = item.quantity || 1;
          const unitPrice = item.price || 0;
          const totalPrice = qty * unitPrice;

          return (
            <div key={itemId} className="breakdown-row">
              {/* Izquierda: Cantidad + Nombre */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
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
              </div>

              {/* Derecha: Precio + Eliminar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <InlineInput
                  type="number"
                  value={unitPrice}
                  className="edit-price"
                  onSave={(val) => handleItemUpdate(itemId, { price: val })}
                />
                <button
                  className="row-delete"
                  onClick={() => handleDeleteItem(itemId)}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}

        {/* Botón Agregar Item (Texto simple azul) */}
        <button className="breakdown-add-btn" onClick={() => setShowAddItemModal(true)}>
          + {t('items.addManualItem')}
        </button>

        {/* Subtotal */}
        <div className="breakdown-row subtotal">
          <span>{t('totals.subtotal')}</span>
          <span>{fmt(totalItems)}</span>
        </div>

        {/* Cargos y Descuentos */}
        {(session.charges || []).map(charge => (
          <div
            key={charge.id}
            className="breakdown-row"
            style={{ color: charge.isDiscount ? 'var(--danger)' : 'var(--success)' }}
            onClick={() => {
              setEditingCharge(charge);
              setShowChargeModal(true);
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {charge.name}
              {charge.valueType === 'percent' && <small style={{ opacity: 0.7 }}>({charge.value}%)</small>}
            </span>
            <span style={{ fontWeight: 600 }}>
              {charge.isDiscount ? '-' : '+'}{fmt(charge.valueType === 'percent' ? (charge.calculatedAmount || 0) : charge.value)}
            </span>
          </div>
        ))}

        {/* Botón Agregar Cargo */}
        <button
          className="breakdown-add-btn"
          style={{ paddingTop: '8px' }}
          onClick={() => {
            setEditingCharge(null);
            setShowChargeModal(true);
          }}
        >
          + {t('charges.addCharge')}
        </button>

        {/* Total Final (Texto simple) */}
        <div className="breakdown-row total-final">
          <span>{t('totals.total')}</span>
          <span>{fmt(totalBoleta + totalChargesAmount)}</span>
        </div>
      </div>
    </div>
  );
};

export default StepReview;
