import { z } from 'zod';

export const RoundingModeSchema = z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP']);
export type RoundingMode = z.infer<typeof RoundingModeSchema>;

const EPSILON = 1e-9;

/**
 * Round `value` to `decimals` places. Works on the scaled magnitude with a tiny
 * epsilon so representation error (1.005 * 100 = 100.49999...) does not flip the result.
 */
export function roundTo(value: number, decimals: number, mode: RoundingMode = 'HALF_UP'): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const sign = scaled < 0 ? -1 : 1;
  const abs = Math.abs(scaled);
  const floor = Math.floor(abs + EPSILON);
  const frac = abs - floor;
  let result: number;
  switch (mode) {
    case 'DOWN':
      result = floor;
      break;
    case 'UP':
      result = frac > EPSILON ? floor + 1 : floor;
      break;
    case 'HALF_EVEN':
      if (Math.abs(frac - 0.5) < EPSILON) result = floor % 2 === 0 ? floor : floor + 1;
      else result = frac > 0.5 ? floor + 1 : floor;
      break;
    case 'HALF_UP':
      result = frac >= 0.5 - EPSILON ? floor + 1 : floor;
      break;
  }
  return (sign * result) / factor;
}
