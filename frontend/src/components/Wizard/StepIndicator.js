import React from 'react';
import { useTranslation } from 'react-i18next';

const StepIndicator = ({ currentStep, onStepClick }) => {
  const { t } = useTranslation();
  const steps = [
    { num: 1, label: t('steps.verify') },
    { num: 2, label: t('steps.assign') },
    { num: 3, label: t('steps.share') }
  ];

  return (
    <div className="step-indicator">
      {steps.map((step, idx) => (
        <React.Fragment key={step.num}>
          <div
            className={`step ${currentStep === step.num ? 'active' : ''} ${currentStep > step.num ? 'completed' : ''}`}
            onClick={() => currentStep > step.num && onStepClick(step.num)}
          >
            <div className="step-circle">
              {currentStep > step.num ? '✓' : step.num}
            </div>
            <span className="step-label">{step.label}</span>
          </div>
          {idx < steps.length - 1 && (
            <div className={`step-line ${currentStep > step.num ? 'completed' : ''}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default StepIndicator;
