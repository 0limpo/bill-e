import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const ChargeModal = ({ charge, onSave, onClose, onDelete }) => {
  const { t } = useTranslation();
  const [name, setName] = useState(charge?.name || '');
  const [value, setValue] = useState(charge?.value?.toString() || '');
  const [valueType, setValueType] = useState(charge?.valueType || 'fixed');
  const [isDiscount, setIsDiscount] = useState(charge?.isDiscount || false);
  const [distribution, setDistribution] = useState(charge?.distribution || 'proportional');

  const handleSave = () => {
    if (!name.trim() || !value) return;
    onSave({
      id: charge?.id || `charge_${Date.now()}`,
      name: name.trim(),
      value: parseFloat(value) || 0,
      valueType,
      isDiscount,
      distribution
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content charge-modal" onClick={e => e.stopPropagation()}>
        <h3>{charge ? t('charges.editCharge') : t('charges.addCharge')}</h3>

        {/* Name input */}
        <input
          className="join-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('charges.namePlaceholder')}
          autoFocus
        />

        {/* Value and Type row */}
        <div className="charge-value-row">
          <input
            className="join-input charge-value-input"
            type="number"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="0"
          />
          <div className="charge-type-switch">
            <button
              className={`charge-type-btn ${valueType === 'fixed' ? 'active' : ''}`}
              onClick={() => setValueType('fixed')}
            >
              $
            </button>
            <button
              className={`charge-type-btn ${valueType === 'percent' ? 'active' : ''}`}
              onClick={() => setValueType('percent')}
            >
              %
            </button>
          </div>
        </div>

        {/* Sum or Discount toggle */}
        <div className="charge-option-row">
          <span className="charge-option-label">{t('charges.type')}</span>
          <div className="charge-toggle-switch">
            <button
              className={`charge-toggle-btn ${!isDiscount ? 'active' : ''}`}
              onClick={() => setIsDiscount(false)}
            >
              {t('charges.add')}
            </button>
            <button
              className={`charge-toggle-btn discount ${isDiscount ? 'active' : ''}`}
              onClick={() => setIsDiscount(true)}
            >
              {t('charges.discount')}
            </button>
          </div>
        </div>

        {/* Distribution toggle - 3 options */}
        <div className="charge-option-row">
          <span className="charge-option-label">{t('charges.distribution')}</span>
          <div className="charge-toggle-switch three-options">
            <button
              className={`charge-toggle-btn ${distribution === 'proportional' ? 'active' : ''}`}
              onClick={() => setDistribution('proportional')}
              title={t('charges.proportionalDesc')}
            >
              {t('charges.proportional')}
            </button>
            <button
              className={`charge-toggle-btn ${distribution === 'per_person' ? 'active' : ''}`}
              onClick={() => setDistribution('per_person')}
              title={t('charges.perPersonDesc')}
            >
              {t('charges.perPerson')}
            </button>
            <button
              className={`charge-toggle-btn ${distribution === 'fixed_per_person' ? 'active' : ''}`}
              onClick={() => setDistribution('fixed_per_person')}
              title={t('charges.fixedPerPersonDesc')}
            >
              {t('charges.fixedPerPerson')}
            </button>
          </div>
        </div>

        {/* Action buttons */}
        <button
          className="btn-main"
          onClick={handleSave}
          disabled={!name.trim() || !value}
        >
          {t('charges.save')}
        </button>

        {charge && onDelete && (
          <button className="btn-danger" onClick={() => onDelete(charge.id)}>
            {t('charges.delete')}
          </button>
        )}
      </div>
    </div>
  );
};

export default ChargeModal;
