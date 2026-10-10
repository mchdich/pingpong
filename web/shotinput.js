import { qrot, qmul, qconj } from './motion.js';

const clamp = v => Math.max(-1, Math.min(1, v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Pointing is a continuous trim; the combined stroke target is capped below.
export function aimFromYaw(yaw) {
  return yaw / (Math.PI / 4);
}

// Poddle's measured turn supplies the stroke direction. Pointing trims it;
// a take-back cannot dominate a stroke travelling the opposite way.
export function aimFromStroke(dir, pointing = 0) {
  return clamp(.65 * (clamp(Number.isFinite(dir) ? dir : 0) + (Number.isFinite(pointing) ? pointing : 0)));
}

export function strokeWing(event, hand = 'right') {
  const dir = Number.isFinite(event.dir) ? event.dir : 0;
  const across = -dir * (hand === 'left' ? -1 : 1);
  return Math.abs(across) < .3 ? 'neutral' : across > 0 ? 'forehand' : 'backhand';
}

// Aim is a held calibrated pointing direction, independent of stroke wing.
// Keep normal take-backs within the familiar range without forcing a target.
export class ShotInput {
  constructor() { this.reset(); }
  reset() {
    this.calibration = null;
    this.aimX = 0;
    this.readyYaw = 0;
    this.quiet = null;
    this.active = null;
    this.followYaw = null;
    this.sampleYaw = 0;
  }

  observe(model, sample) {
    if (!model.calibrated || !model.B || !sample.q) return;
    if (this.calibration !== model.calib) {
      this.reset(); this.calibration = model.calib;
    }
    const delta = qmul(qmul(model.yawFix, sample.q), qconj(model.calib));
    const pointing = qrot(delta, model.B.F);
    const forward = dot(pointing, model.B.F);
    // Rearward follow-through cannot set aim. Sideways pointing still counts
    // as an edge placement; the small margin avoids an edge-on flip.
    if (forward < -.1) { this.quiet = null; return; }
    const yaw = Math.atan2(dot(pointing, model.B.R), forward);
    this.sampleYaw = yaw;
    const rate = Math.hypot(...(sample.r || [0, 0, 0]));
    if (model.sw || rate >= .8) { this.quiet = null; return; }
    // Do not adopt a held follow-through as new aim. Moving away from that
    // endpoint re-arms pointing anywhere in the forward hemisphere.
    if (this.followYaw != null && Math.abs(Math.atan2(Math.sin(yaw - this.followYaw), Math.cos(yaw - this.followYaw))) < 8 * Math.PI / 180) { this.quiet = null; return; }
    this.followYaw = null;
    if (!this.quiet || sample.t < this.quiet.t || Math.abs(yaw - this.quiet.yaw) > Math.PI / 60) this.quiet = { t: sample.t, yaw };
    if (sample.t - this.quiet.t >= .15) { this.readyYaw = yaw; this.aimX = aimFromYaw(yaw); }
  }

  report(event, hand = 'right', model = null) {
    const dominant = hand === 'left' ? 'left' : 'right';
    if (event.type === 'swing' || !this.active) {
      const yaw = Number.isFinite(model?.sw?.from?.yaw) ? model.sw.from.yaw : this.readyYaw;
      // A scoop/overhead from the normal grip uses the forehand. A vertical
      // backhand requires the hand to start across the body, not an absent axis.
      this.verticalWing = yaw * (dominant === 'left' ? -1 : 1) < -Math.PI / 9 ? 'backhand' : 'forehand';
      this.active = { aimX: this.aimX, wing: this.verticalWing, hand: dominant };
      this.strokePointing = this.aimX;
    }
    if (event.type !== 'swingEnd') {
      const wing = strokeWing(event, dominant);
      this.active.wing = wing === 'neutral' ? this.verticalWing : wing;
      this.active.aimX = aimFromStroke(event.dir, this.strokePointing);
    }
    if (event.type === 'swingEnd') this.followYaw = this.sampleYaw;
    this.active.hand = dominant;
    return { ...this.active };
  }
}
