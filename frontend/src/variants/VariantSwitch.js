import { useVariant } from './useVariant';

/**
 * Componente para renderizar según la variante actual
 *
 * Uso:
 *   <VariantSwitch
 *     A={<OriginalComponent />}
 *     B={<NewComponent />}
 *   />
 *
 * Props:
 *   - A, B, C, etc.: Componentes a renderizar para cada variante
 *   - fallback: Componente a renderizar si la variante no tiene match (opcional)
 */
export const VariantSwitch = ({ fallback = null, ...variants }) => {
  const variant = useVariant();

  // Retorna el componente de la variante actual, o fallback si no existe
  return variants[variant] ?? fallback;
};
