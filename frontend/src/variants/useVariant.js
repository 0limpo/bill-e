import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_VARIANT, isValidVariant } from './config';

/**
 * Hook para obtener la variante actual desde la URL
 *
 * Uso:
 *   const variant = useVariant();
 *   if (variant === 'B') { ... }
 *
 * URL examples:
 *   /s/abc123        → returns 'A' (default)
 *   /s/abc123?v=B    → returns 'B'
 *   /s/abc123?v=xyz  → returns 'A' (invalid variant falls back to default)
 */
export const useVariant = () => {
  const [searchParams] = useSearchParams();

  const variant = useMemo(() => {
    const v = searchParams.get('v');

    // Si no hay param o es inválido, retorna default
    if (!v || !isValidVariant(v)) {
      return DEFAULT_VARIANT;
    }

    return v;
  }, [searchParams]);

  return variant;
};
