import React from 'react';
import { useTranslation } from 'react-i18next';
import { getAvatarColor, getInitials } from '../../utils/billEngine';

/**
 * StepShare - Paso 3: Vista de breakdown final (solo host)
 * Muestra el desglose por participante cuando la cuenta está cerrada
 */
const StepShare = ({
  session,
  currentParticipant,
  expandedParticipants,
  setExpandedParticipants,
  calculateParticipantTotal,
  displayedTotal,
  fmt
}) => {
  const { t } = useTranslation();

  // Helper: Calculate items for a participant
  const getParticipantItems = (participantId) => {
    const items = [];
    const itemsWithUnitAssignments = new Set();

    Object.keys(session.assignments).forEach(key => {
      const unitMatch = key.match(/^(.+)_unit_(\d+)$/);
      if (unitMatch && session.assignments[key]?.length > 0) {
        itemsWithUnitAssignments.add(unitMatch[1]);
      }
    });

    Object.entries(session.assignments).forEach(([assignmentKey, assigns]) => {
      const pAssign = assigns.find(a => a.participant_id === participantId);
      if (pAssign) {
        const unitMatch = assignmentKey.match(/^(.+)_unit_(\d+)$/);
        let item, itemName, isUnitAssignment = false;

        if (unitMatch) {
          isUnitAssignment = true;
          const baseItemId = unitMatch[1];
          const unitNum = parseInt(unitMatch[2]) + 1;
          item = session.items.find(i => (i.id || i.name) === baseItemId);
          itemName = item ? `${item.name} (U${unitNum})` : `Unidad ${unitNum}`;
        } else {
          if (itemsWithUnitAssignments.has(assignmentKey)) return;
          item = session.items.find(i => (i.id || i.name) === assignmentKey);
          itemName = item?.name || assignmentKey;
        }

        if (item) {
          const amount = item.price * (pAssign.quantity || 0);
          const splitCount = assigns.length;
          const itemMode = item.mode || 'individual';
          const itemQty = itemMode === 'individual'
            ? Math.round(pAssign.quantity || 1)
            : (isUnitAssignment ? 1 : (item.quantity || 1));
          items.push({ name: itemName, amount, splitCount, itemQty, isUnitAssignment, itemMode });
        }
      }
    });
    return items;
  };

  return (
    <div className="finalized-breakdown-section step-container-animate">
      <div className="step-header">
        <h3>🎉 {t('finalized.billClosed')}</h3>
      </div>

      <div className="sheet-breakdown">
        {/* Column Headers */}
        <div className="sheet-breakdown-header">
          <span className="header-name">{t('items.name')}</span>
          <span className="header-consumo">{t('totals.subtotal')}</span>
          <span className="header-total">{t('items.total')}</span>
        </div>

        {session.participants.map(p => {
          const { subtotal, total, charges: pCharges } = calculateParticipantTotal(p.id);
          const isExpanded = expandedParticipants[p.id];

          return (
            <div key={p.id} className="sheet-breakdown-item-wrapper">
              <div
                className={`sheet-breakdown-item clickable ${isExpanded ? 'expanded' : ''}`}
                onClick={() => setExpandedParticipants(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
              >
                <div className="sheet-breakdown-person">
                  <span className="expand-indicator">{isExpanded ? '▼' : '▶'}</span>
                  <span className="sheet-breakdown-avatar" style={{ background: getAvatarColor(p.name) }}>
                    {getInitials(p.name)}
                  </span>
                  <span className="sheet-breakdown-name">
                    {p.id === currentParticipant?.id ? t('header.you') : p.name}
                  </span>
                </div>
                <span className="sheet-breakdown-subtotal">{fmt(subtotal)}</span>
                <span className="sheet-breakdown-amount">{fmt(total)}</span>
              </div>
              {isExpanded && (
                <div className="participant-breakdown host-view">
                  {getParticipantItems(p.id).map((item, idx) => (
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
                  <div className="breakdown-row subtotal">
                    <span>{t('totals.subtotal')}</span>
                    <span>{fmt(subtotal)}</span>
                  </div>
                  {/* Show charges (only if non-zero) */}
                  {pCharges.filter(c => Math.abs(c.amount) > 0).map(charge => (
                    <div key={charge.id} className={`breakdown-row charge ${charge.amount < 0 ? 'discount' : ''}`}>
                      <span>{charge.name}</span>
                      <span>{charge.amount < 0 ? '-' : '+'}{fmt(Math.abs(charge.amount))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="sheet-breakdown-total">
          <span>{t('totals.tableTotal')}</span>
          <span></span>
          <span className="sheet-total-amount">{fmt(displayedTotal)}</span>
        </div>
      </div>
    </div>
  );
};

export default StepShare;
