# Poddle with shot risk

This is a direct fork of [danielrltan/poddle](https://github.com/danielrltan/poddle). The current version restores the original court, third-person view, paddle placement, swing detector, calibration, forgiving contact window, automatic footwork, artwork, effects and synthesized sound. The table tennis conversion has been removed at the player’s request.

Play at https://pingpong.mehdi.ch. Open the game on a computer, choose 1v1 or 2v2, share the court link/code, and pair one iPhone or Android per player with its QR code. AirPods and a webcam are not required.

Phone strength follows measured swing speed, while the original gesture detection and calibration remain. Valid contact uses the settled strength. A return must contact the current ball in front of the paddle; a passed ball cannot be rewound or returned after the point has ended.

The changes to play are deliberate shot risk: gentle baseline shots can fail to cross the net and overpowered shots can land long. Left/right aiming stays safely inside the sidelines and does not cause out faults. The direction of your swing chooses the shot, and pointing left or right adjusts the target. A side ball must be returned on the matching forehand or backhand; choose your paddle hand in Settings.

In doubles, the closest player to the projected ball handles automatic footwork. Either teammate can return a ball they can actually reach. Simultaneous attempts at the same reachable ball make both teammates miss. A legal shot that bounces and goes unreturned wins the point.

Names appear over every character. Five consecutive legal orange-strength hits fill the Critical streak counter from 0/5 to 5/5. Choose a six-second swing speedup for your team (1.35×) or swing and movement slowdown for opponents (0.45× swings, 0.12× movement). Speed changes affect the actual paddle motion and outgoing strength. Weaker or overpowered shots break an unfinished streak.

Chop downward through a high ball close to the net to spike it. Spikes fly downward with their own sound, energy column and landing shockwave; too soft can hit the net and too hard can go long. Point celebrations add crowns, cube explosions and confetti. Impact sound, camera shake and brief impact frames follow the physical swing strength.

Horizontal aiming combines Poddle’s measured swing direction with your pointing direction. A held forehand take-back cannot override a swing the other way. Mirrored motions produce mirrored shots, with targets capped at the safe edge. A held follow-through does not replace the next target.

Phone orientation aligns with the paddle, including screen-up → paddle face-up, without changing original calibration. Confirmed hits trigger strength-scaled vibration where the browser supports it; iPhone browsers do not support web vibration. Update notes appear for ten seconds when a browser first opens a new release. Reloading does not restart the timer.

## Run

```bash
npm ci
node server/game.js
```

Open http://localhost:8080. Real phone sensors require an HTTPS page. The computer and phone connect to the same server using Poddle’s original protocol.

## Verify

```bash
npm test
node test/pad.test.mjs
```

The challenge checks exercise power faults, legal rallies, missed returns, multiplayer and results. Original `web/motion.js`, `web/padmotion.js` and `web/strokes.js` remain unchanged. Browser verification uses the actual game pages with Microsoft Edge; physical iPhone/Android feel still needs player feedback. See [verification](docs/PINGPONG-VERIFICATION.md).

## Deploy

Deploy the original Dockerfile with `fly.pingpong.toml`. See [deployment](docs/PINGPONG-DEPLOY.md). Rooms and phone pairings are held in one server process and end on a restart. The existing domain and DNS configuration remain in use.
