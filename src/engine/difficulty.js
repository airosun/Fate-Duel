// Adaptive CPU difficulty: after each match the CPU's strength moves toward
// whatever keeps the player winning about half the time.
export const START_STRENGTH = 0.5;
export const STEP = 0.1;

export function nextStrength(strength, result) {
  const s = result === 'win' ? strength + STEP : result === 'loss' ? strength - STEP : strength;
  return Math.round(Math.min(1, Math.max(0, s)) * 100) / 100;
}
