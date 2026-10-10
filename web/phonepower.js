// Phone strength is measured speed. Poddle's calibration, gesture detection and
// paddle motion remain in motion.js; its time-to-peak gate must not turn a faster
// version of the same stroke into the weakest shot.
const clamp = v => Math.max(0, Math.min(1, v));

export function phonePower(event) {
  const raw = Number.isFinite(event.raw) ? Math.max(0, event.raw) : 0;
  const rom = Number.isFinite(event.rom) ? Math.max(0, event.rom) : 0;
  // Only a tiny sensor twitch loses credit. Ordinary short and wide swings
  // receive the same strength at the same measured angular speed.
  const range = clamp((rom - 5) / 25);
  const credit = range * range * (3 - 2 * range);
  return 6 + 28 * clamp((raw - 4) / 19) * credit;
}
