import { qmul, qconj, qnorm, qaxis, qslerp } from './motion.js';

// Temporary ultimates scale only the moving paddle. Calibration and the body
// stay untouched; idle orientation returns to the physical phone after a swing.
export class SwingResponse {
  reset() { this.previous = null; this.q = null; this.active = false; this.gain = 1; this.at = null; }
  constructor() { this.reset(); }
  update(pose, gain = 1, now = 0, calibration = null) {
    if (!pose.calibrated || this.calibration !== calibration) {
      this.reset(); this.calibration = calibration;
    }
    if (!pose.calibrated) return pose;
    const dt = this.at == null ? 0 : Math.max(0, Math.min(.1, (now - this.at) / 1000));
    if (pose.swinging && !this.active) {
      this.gain = Math.max(.25, Math.min(1.5, Number.isFinite(gain) ? gain : 1));
      this.q = [...(this.previous || pose.Pd)];
    }
    if (pose.swinging && this.gain !== 1 && this.previous) {
      let d = qnorm(qmul(pose.Pd, qconj(this.previous)));
      if (d[3] < 0) d = d.map(v => -v);
      const axis = d.slice(0, 3), length = Math.hypot(...axis);
      if (length > 1e-8) this.q = qnorm(qmul(qaxis(axis, 2 * Math.atan2(length, d[3]) * this.gain), this.q));
    } else if (pose.swinging || !this.q || this.gain === 1) this.q = [...pose.Pd];
    else {
      this.q = qslerp(this.q, pose.Pd, 1 - Math.exp(-dt / .06));
      this.gain += (1 - this.gain) * (1 - Math.exp(-dt / .06));
      if (Math.abs(this.gain - 1) < .001) { this.gain = 1; this.q = [...pose.Pd]; }
    }
    this.active = !!pose.swinging; this.previous = [...pose.Pd]; this.at = now;
    return { ...pose, Pd: [...this.q], offset: pose.offset?.map(v => v * this.gain), rate: pose.rate * (pose.swinging ? this.gain : 1) };
  }
}
