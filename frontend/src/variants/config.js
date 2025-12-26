// Configuración central de variantes para A/B testing
// Agregar nuevas variantes aquí cuando se creen

export const VARIANTS = {
  A: 'A',  // Original/Control - sin 3 pasos
  B: 'B',  // StepFlow - con flujo de 3 pasos
};

// Variante por defecto cuando no hay ?v= en la URL
export const DEFAULT_VARIANT = 'A';

// Validar si una variante existe
export const isValidVariant = (variant) => {
  return Object.values(VARIANTS).includes(variant);
};
