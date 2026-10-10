import { qaxis, qmul, qnorm } from './motion.js';

// Paddle handle = phone's long axis; paddle face = phone's screen.
// Screen facing up therefore puts the paddle face up. This fixed mount applies
// to the original buffered pose without changing its hand position or detector.
const WORLD_UP_TO_PLAYER = qaxis([1, 0, 0], -Math.PI / 2);

export function phonePose(model, pose) {
  if (!pose.calibrated || !model.B || !model.calib) return pose;
  const right = model.B.R;
  const frame = qmul(WORLD_UP_TO_PLAYER, qaxis([0, 0, 1], -Math.atan2(right[1], right[0])));
  const mount = qmul(frame, model.calib);
  return { ...pose, Pd: qnorm(qmul(pose.P, mount)) };
}
