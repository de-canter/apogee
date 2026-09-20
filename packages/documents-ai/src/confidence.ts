export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ConfidenceBands { high: number; medium: number }
export const DEFAULT_BANDS: ConfidenceBands = { high: 0.9, medium: 0.7 };

/** A score with its band and the reasons behind it; the shape every AI claim carries. */
export interface Confidence {
  value: number;
  level: ConfidenceLevel;
  factors: string[];
}

export function confidenceLevel(value: number, bands: ConfidenceBands = DEFAULT_BANDS): ConfidenceLevel {
  if (value >= bands.high) return 'high';
  if (value >= bands.medium) return 'medium';
  return 'low';
}

/** Clamps to [0, 1]. */
export function confidence(value: number, factors: string[] = [], bands: ConfidenceBands = DEFAULT_BANDS): Confidence {
  const v = Math.max(0, Math.min(1, value));
  return { value: v, level: confidenceLevel(v, bands), factors: [...factors] };
}

/** Weakest link: the minimum value, all factors. No parts means 0.5 with the factor 'no signals'. */
export function combineConfidence(parts: readonly Confidence[], bands: ConfidenceBands = DEFAULT_BANDS): Confidence {
  if (parts.length === 0) return confidence(0.5, ['no signals'], bands);
  const value = Math.min(...parts.map((p) => p.value));
  return confidence(value, parts.flatMap((p) => p.factors), bands);
}
