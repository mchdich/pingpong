// Confirmed contact only. Duration follows physical strength, independently of
// the trail colour (a strong lob can still have a white trail).
export function hitPulse(strength) {
  const n = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 0));
  const first = Math.round(8 + 70 * n ** 1.4);
  const t = Math.max(0, Math.min(1, (n - .84) / .16));
  const second = Math.round(12 * t * t * (3 - 2 * t));
  return second ? [first, 18, second] : first;
}

export function vibrateHit(strength, device = globalThis.navigator) {
  if (typeof device?.vibrate !== 'function') return false;
  try { return device.vibrate(hitPulse(strength)) !== false; }
  catch { return false; }
}
