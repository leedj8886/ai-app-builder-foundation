import { tailwindAdapter } from './tailwindAdapter';
import type {
  StylingAdapter,
  StylingCapability,
  StylingResolution
} from './types';

const passiveAdapter = (capability: StylingCapability): StylingAdapter => ({
  capability,
  validateSource: () => []
});

const registry = new Map<StylingCapability, StylingAdapter>([
  ['plain-css', passiveAdapter('plain-css')],
  ['tailwind', tailwindAdapter],
  ['css-modules', passiveAdapter('css-modules')],
  ['styled-components', passiveAdapter('styled-components')]
]);

export const adaptersFor = (
  resolution: StylingResolution
): StylingAdapter[] => resolution.capabilities.flatMap(capability => {
  const adapter = registry.get(capability);
  return adapter ? [adapter] : [];
});
