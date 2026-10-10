# Poddle fork: gameplay and feedback verification

This version follows the player's accepted scope: retain original Poddle's court, view, gesture detector, calibration and automatic movement, then add shot risk and multiplayer features. The rejected parallel table game is removed. `web/motion.js`, `web/padmotion.js` and `web/strokes.js` are byte-identical to the cloned Git source.

## Current release: swing direction and swing/movement ultimates

The old adapter used held pointing alone for the outgoing target. A normal held forehand take-back therefore stayed a rightward target even when the measured stroke travelled the other way. The updated adapter combines Poddle's measured stroke direction with a frozen pointing trim. The measured final report owns the result; end fallback retains that result, and follow-through cannot silently flip the trim. Either wing can deliberately place either side. Targets remain capped 45cm inside the sidelines, and sideways travel still cannot cause an out fault.

Centered hard phone shots also formerly chose the same default curl direction. They now use the actual stroke direction when neither target nor contact position supplies a direction. Truly neutral motion has no arbitrary lateral curl. Legacy ordinary Poddle solver parity is retained.

- **Swing speedup:** 1.35× angular swing rate and normalized outgoing strength for six seconds, affecting the whole own team.
- **Slow opponents:** 0.45× angular swing rate/strength and 0.12× sideways/forward movement for six seconds, affecting the opposing team. Distant wide balls cannot be reached before their second bounce in the verified singles/doubles scenario, despite repeated matching front-side swings.
- The moving paddle's quaternion increments and arm travel are scaled, including the actual rendered/wired paddle. Calibration, idle orientation and body position remain unmodified by that adapter. The paddle returns to physical phone alignment after the stroke. Each stroke retains its initial multiplier through fixes and expiry; the server owns the outgoing strength. Speedup no longer enlarges reach. Phone/computer controls and help describe the actual effects.

Full native gate: **96/96**, zero failures/skips. Real calibrated sensor cases cover neutral/mirrored strokes, opposite motion after a take-back, continuously adjustable pointing on either wing, both hands, three headings, safe landings on all seats, unchanged calibration/strength and fallback. Quaternion tests cover both directions, scaling past 180°, expiry mid-stroke, recovery and reset. Actual socket tests earn ultimates with five genuine legal orange hits, confirm team factors, verify slowed players miss a wide ball despite matching swings, bound real movement speed, and confirm server-controlled force cannot be overridden by client fields. Existing no-passed-ball, positional doubles, simultaneous misses, net/long/weak and streak gates remain green.

Actual browser aiming probes pass both match modes. A physical stroke agreeing with pointing places a legal edge shot at ±2.60m; a returning stroke from a ±45° take-back lands approximately at the center (±0.004m), demonstrating that take-back does not lock the direction. Both teams/all four doubles seats are exercised. Phone/computer ability controls, relay, counter, pause gate and haptic relay pass with zero browser errors. Net scene checks pass all player/spectator views and both incoming faces, including cleanup, mute and reduced motion.

Complete local singles **5–1 with nine hits**, doubles **0–5 with seven hits**, net probes, result cards and rematches pass with zero browser errors. The first local match fixture used the ball's side when the gesture began to choose a wing; diagonal shots crossed the body center before contact and correctly rejected those wrong wings. The repeat uses the existing public fixture's projected contact-side selection for local matches too. No contact rules were loosened. Initial ultimate fixture assertions also compared gap at the bounce to a later body position; corrected them to actual front-side states, measured swing reach and bounded movement speed. Failed logs are retained.

Image `registry.fly.io/pingpong-mehdi-ch:deployment-01M4FJD6SRRR2TJHPK7ZV61B4J` is live. Fly smoke, health and DNS checks pass. All 102 frozen server/web files match local source; all 15 checked live browser assets and the live server hash match the tested build. Public singles finishes **11–4 with 19 hits**, doubles **3–11 with 17 hits**, each including calibrated real phone-stream aim/net probes, result cards and rematches, and zero browser errors. Public take-back shots land at about ±0.004m near center; intentional agreeing directional swings land at the safe ±2.60m edge. Both teams/all four doubles seats are exercised. Release ID: `swing-intention-1791523809496`. Server SHA-256: `959a6a60e6d3f1f7e84447550b17058ac490314880d5d68a6700275f96066963`; aim: `fa09c1cd064428b4ca3baa8c7335960518b9fc64e06405b90f8d10032beec21b`; swing response: `f167fc99fd868aceb7e5ba8313648f2fcc408093b0a420dac8e04488f3843a14`. Original motion.js, padmotion.js and strokes.js remain byte-identical to the original clone.

## Previous release: safe and easier horizontal aiming

Latest requested rule: sideways travel never causes an out fault. Removed the x bound from first-bounce scoring and the lateral terminal bound. Net, wrong-side and long faults still depend on actual flight. An unreturned legal first bounce still scores normally.

Drives and spikes share a 2.6m maximum horizontal target, 45cm inside the sideline. Held calibrated yaw maps linearly to that target: a 45° turn covers the width, and larger angles remain at the safe edge. Both forehand and backhand retain the selected direction. Quiet acquisition and completed-follow-through rejection keep their previous timing. The faster-acquisition experiment failed the natural-swing regressions and was removed before building this release. Calibration, physical paddle orientation, strength, contact and net animation are unchanged.

- Full native gate: **95/95**, zero failures/skips. It covers actual calibrated sensor streams, both wings/hands, three headings, all seats, safe spikes, continuous weak/comfortable/overpowered strength, strict current front contact, matching wing, positional doubles, simultaneous misses, ultimates and original pose parity. Real socket games verify safe edge landings and ordinary scoring. The actual production bounce/bounds section is additionally exercised at x=±3.8m and ±20m to prove sideways crossings cannot cause out faults while long/wrong-side faults remain.
- Actual browser aiming probes: both match modes, both teams, all four doubles seats. ±35° lands at about **±2.02m**; ±85° saturates at **±2.60m**. Every comfortable shot wins the unreturned point with a double bounce, without a lateral or net fault.
- Net scene gate: all player/spectator views, both incoming directions, contact hold/drop, mesh/tape flex, anchored posts, legal aimed flights after faults, face-up paddle poses, cleanup, mute and reduced motion; zero browser errors.
- Complete local singles **5–1 with nine hits** and doubles **0–5 with seven hits**, including genuine slow phone net probes on every display, result cards and rematches; zero browser errors.

Final frozen build: `registry.fly.io/pingpong-mehdi-ch:deployment-01M4FG3G2YEHG80K8Q8YBF704D`. It adds only corrected tutorial text to the gameplay-tested image `deployment-01M4FFDTB4PRNMBJE3FCF5PVH0`; gameplay and all other browser code are byte-identical. Final deployment health/DNS and 11 live asset checks plus the server hash pass. Tutorial SHA-256: `d096b79f0f765cc4f080caa22fc667537368a3aa33aef24bcc292880e1cdd15c`. All 101 included server/web files match the frozen source. Server SHA-256: `08f4571e1ae1b2f0da9c94b409e5ac68941452c0906a5628eaf53aa31fcf7229`; aim: `0e2847801f20fb5779be3118abf38e3ac3820ea9d001fc6ea5cf790b7191823e`; release: `22ad565bc11fb03d3958dfa6a4918911d760808f00ab0653dade696450f941da`. Release ID: `safe-horizontal-1791520724972`. Fly deployment smoke, health and DNS checks pass. The custom domain returns HTTP 200 for every checked client asset; their byte hashes and the live server hash match the tested frozen build. Public singles completes **11–3 with 19 hits**, including net and left/right aim probes, every result/rematch and zero browser errors. Public doubles completes **0–11 with 16 hits**, including genuine net probes on all player/spectator displays, every result/rematch and zero browser errors. The independent public doubles aiming probe also passes all four seats: ±35° maps to approximately ±2.02m and ±85° to ±2.60m; every shot wins an unreturned double-bounce point without net/out faults.

The first concurrent public singles/net and aiming probes failed their checks (an expected weak net fault instead double-bounced, and an aim target differed from the strict expected target). Their logs are retained in `poddle-safe-horizontal-live-singles.log` and `poddle-safe-horizontal-live-aim.log`. The singles repeat runs on the same deployed image and passes net, aiming and the full match; no game-code changes or relaxed assertions were used. Extra test failure diagnostics were added. The cause of the initial failures is unconfirmed. The separate exploratory manual-position socket fixture also failed to reliably set up a legal shot beyond the sideline; it was replaced by direct execution of the real scoring section plus ordinary real socket edge shots, without changing gameplay to accommodate that fixture.

Earlier reports below document previous builds and their former sideline rules.

## Previous release: aiming and face alignment correction

The net release and the rollback image contained the same earlier aiming adapter. Its `back > .5` override forced returning horizontal strokes to zero aim, while other strokes could retain held angles that mapped directly to an overwide 5m target. That made the two reported symptoms possible with different phone preparations. Removed the forced-center override. Both wings now preserve the held left/right target. Ordinary angles use the familiar 2.4m lateral range; nearly-sideways angles smoothly extend to 5m for genuine faults. Completed follow-through endpoints cannot silently overwrite the next intended target; deliberate repositioning re-arms aim.

The orientation adapter previously intentionally mapped the phone's screen normal to the paddle's edge. The latest requested behavior maps screen normal to paddle-face normal. Removed the fixed 90° mount and the opposite rotation in the phone inset. Original calibration, `K`, motion, gesture detection, hand offsets, force scoring and live server physics stay unchanged.

Full native gate: **93/93**, zero failures/skips. Real calibrated sensor cases cover both wings, both hands, three headings, ordinary left/right placement and extreme outs in all four seats. Actual main.js reports retain chosen aim through initial/final/fallback packets. Independent matrix ground truth checks **243 phone poses**, plus saved/recentered calibration and actual main wire/render paths.

The actual browser aiming probes pass locally and publicly in both match modes. Moderate ±35° input lands at approximately **±1.37m** on the intended side, inside the court. Deliberate ±85° input lands at approximately **±4.29m** and gives the opponent the out point. Both teams are covered in singles; all four seats are covered in doubles.

The browser scene checks additionally prove that, after a net fault, left and right legal flights cross into the opponent's side without centering or retaining the dead net animation. All four rendered paddles lie flat for a screen-up physical quaternion. Net mesh/tape reaction, reflected drop, expiry, bounded pools, mute and reduced motion still pass.

Complete local matches finish singles **5–1 with nine hits** and doubles **0–5 with seven hits**, including real net-contact probes, all results/rematches and zero browser errors.

Final public singles finishes **11–1 with 18 hits**, and doubles **0–11 with 16 hits**. Both include actual calibrated forehand/backhand reports, net contact/drop probes on every player/spectator display, all result cards and rematches, and zero browser errors. Public aiming probes independently pass moderate legal left/right shots and deliberate extreme outs on both teams/all four seats.

The first public full-match attempt missed every return while the local run passed. Its driver waited for the bounce notification before starting a gesture that crosses the phone/server/desktop/server relay. The repeat begins that physical gesture as the bounce approaches and chooses the wing from the projected ball side. Game code, eligibility, reach, and strict current front-side contact remain unchanged; no history rewind or passed-ball rescue was added. The failed attempt is retained in `poddle-aim-alignment-live-game.log`, with successful repeats in `poddle-aim-alignment-live-singles.log` and `poddle-aim-alignment-live-doubles.log`.

Image `registry.fly.io/pingpong-mehdi-ch:deployment-01M4FD2QA6HQDJEVEFZKM1VC4M` was deployed. Fly smoke/health/DNS checks pass. Live source matches the tested build: aim `057ef654f5fb9d65d8870ddcd2aa2bd7eeda2125a800e8fa4d003593965004f7`, mount `07b0bdf0b6d7d6254e5cc96dae8038ff610c95d8b34052af4e1f039792ede895`, inset `dfa1162ebe765e2c5db3f2bb6c966278cd3ec6bce02284950ab14da34c3fbe6e`. Main/scene/physics retain the net release's hashes. Release ID: `aim-face-alignment-1791518397570`.

## Deployed net contact animation

The fault previously left incoming velocity intact, and the display's generic dead-ball coast carried the ball through the mesh. Net faults now emit one physical contact before the existing point. The ball stops on the incoming face with an absorbed downward/backward velocity. The display briefly holds contact, then drops and bounces back on the hitter’s side. A presentation guard prevents low incoming flights being extrapolated through the mesh while the authoritative event is in transit; it does not change legal flight, collision judgment or scoring.

The original mesh, white tape, strap and hem use subdivided geometry with a damped local flex/ripple. Posts stay fixed. Geometry buffers are reused, the net returns exactly to rest within 1.2s, and serve/hide/menu/court rebuild clear the effect. Pause freezes both ball drop and net response. A dull net-contact twang respects mute, and reduced motion uses a smaller deformation.

The full native gate passes **91/91 checks**, zero failures/skips. Actual socket singles/doubles verify one net contact before one opponent point, incoming-face position and reflected downward velocity; ordinary rallies and long faults produce no false net contact. Pure presentation tests cover both sides, delay, curl/spin/bends, legal passes, outside-post shots, floor faults, held serves and state/serve cleanup.

The actual Edge scene gate covers both player views and spectators from both incoming sides. It verifies contact hold/drop, no passthrough, mesh/tape flex, anchored edges, exact settling, pooled buffers, pause and cleanup, mute and reduced motion, with zero browser errors. Existing impact/spike/point effects also pass their browser regression gate. Screenshots are in `test/ui-shots/poddle-net/`.

Complete local matches finish singles **5–0 with seven hits** and doubles **0–5 with eight hits**, including all result cards and rematches, with zero browser errors. Additional actual calibrated slow phone streams through main.js and the real relay produce net faults in both match modes. Every player and spectator receives one contact, sees approximately **0.21m** mesh flex and the ball dropping to the floor on the hitter’s side.

Image `registry.fly.io/pingpong-mehdi-ch:deployment-01M4FAW3N7CTCPN6KVFA15DV6W` was deployed. Fly machine smoke/health and DNS checks pass, and the custom-domain status/assets return HTTP 200. Live server/main/scene/release hashes match the tested frozen build; original motion/calibration/detector and aim/pose/haptics files match local source.

Final public singles finishes **11–6 with 21 hits** and doubles **5–11 with 21 hits**, with all player/spectator result cards and rematches and zero browser errors. Each run first uses a genuine calibrated slow phone sweep to generate a net fault through the normal main.js connection. Every player and spectator sees exactly one contact, a mesh flex, and a drop to the floor on the hitter’s side. Dedicated scene coverage additionally verifies both incoming sides and every view.

Release ID: `net-impact-1791516083713`. Source/frozen image hashes match: server `7052a1ae7858192580dac6995198415ea8fb7edcf9e2f4203a6bdea098414277`, scene `589faa48cf61a224f74fcf4a12e95278d4fb3970102db4d22db59ca006776580`, main `5628f0a41309c22b28c48bc4460e24a03ee7a4445023f89259eba43a9783ba75`. Original calibration, gesture and motion hashes remain unchanged.

## Deployed forehand fix

The latest player report exposes a missed case in the previous aiming tests: a held sideways take-back followed by a normal stroke toward the net was incorrectly classified as deliberate sideline aim. The same real calibrated phone samples produce old landing targets of approximately 3.70, 5.00 and 5.00m for 40°, 60° and 80° right take-backs. The repair produces a centered target for all three, while outward lateral strokes still land out.

The added ShotInput adapter uses original Poddle's existing `back` intent signal to recognize a return from take-back and keep that horizontal shot centered through initial, measured and end packets. Original calibration, gesture detection, motion, strength, server rules and effects remain unchanged.

The focused offline gate passes **33/33 checks**. This includes eight aiming regressions, repeated partial forehand/backhand sequences, both dominant hands, three headings, actual solver landings in all four seats, and the actual main.js wire handler at four speeds with normal/fallback/serve/visibly-late paths. The broader offline checks retain original ordinary solver parity, genuine weak/hard/sideways faults, spikes and pose/force behavior.

After execution access was restored, the full gate passes **87/87 checks**, with no failures or skips. Complete local singles finishes **5–0 with seven hits** and doubles **0–5 with eight hits**, including every player/spectator result and rematch, with zero browser errors.

Final public singles finishes **2–11 with 16 hits** and doubles **11–8 with 23 hits**. Both include genuine calibrated phone streams, settled forehand/backhand directions, live Critical counters, all results/rematches and zero browser errors.

Image `registry.fly.io/pingpong-mehdi-ch:deployment-01M4EYFTYNPJN8HETCQ6FVV7M4` is deployed. Fly health and DNS checks pass; custom-domain status returns HTTP 200. Live `shotinput.js` SHA-256 is `5fd2279eb3b195805269cc628a0e5ddba4d47d9dc2fa8748256ef005ebad704c`; checked main, motion, calibration, detector, scene, help/tutorial and release assets match source. Release ID is `forehand-aim-1791496627400`. Calibration, main control flow, server physics and scene assets retain their previous hashes. Real-phone feedback remains the acceptance step for subjective feel.

## Previous deployed native gate

`npm test` passes **85/85 checks**, zero failures, skips or cancellations. The gate includes real WebSocket rooms and actual calibrated phone sensor streams, not just isolated helpers.

| Requested behavior | Verified behavior |
| --- | --- |
| Continuous, consistent strength | Same wide swing scores progressively stronger as measured speed increases. Early estimates wait for the measured result at already-valid contact. One hit and one matching impact event launch the complete trajectory. |
| Weak, long and sideways faults | Gentle baseline strokes fail naturally; near-net dinks can clear. Overpowered or overwide shots go out. Original ordinary solver matches across 8,100 trajectories at strength at least .35. |
| Direction and forehand/backhand | Independent calibrated pointing sets aim before a swing. Natural swing direction does not force a wide shot. The incoming side is checked against the visible body and selected dominant hand, including vertical strokes. |
| Positional doubles | The nearest projected receiver handles Auto movement. Either reachable teammate can return, including consecutive returns by the same player. Both simultaneously swinging at the same reachable ball cancels both contacts. |
| No late resurrection | Only current live contact in front of the paddle can start a return. Drawn-ball checks filter visibly passed new swings. No ball-history rewind or delayed terminal-point grace remains. |
| Critical counter and ultimates | Five consecutive legal orange-strength hits unlock an ultimate. Faults and nonqualifying hits reset unfinished streaks. Held blocks, automatic serves and unconfirmed predictions cannot earn credit. Boost/slowdown expire after six seconds of game time and do not relax front, wing or net/out checks. |
| Spiking | A genuine downward phone gesture produces a true downward flight on a high ball near the net. Weak/net, hard/long, wide/out, all four seats and both wings are covered. A real baseline Auto-only rally reaches a short high lob and spikes it without manual position fields. Serves are excluded. |
| Exact phone alignment | Three starting grips, nine rotations and different sensor timings/headings cover 243 pose cases. Handle aligns with the phone's long axis; screen-up puts the paddle edge up. Original calibration/detection/position remain unchanged. |
| Strength haptics | Confirmed physical force, rather than flight color or softened outgoing pace, determines vibration. Missing, throwing and rejected browser vibration APIs fail safely. |
| Ten-second feature list | First view of a release gets ten seconds. Reload retains the original deadline; expired/dismissed versions stay hidden. New versions get a fresh window. |

## Browser gates

Actual Microsoft Edge pages pass the ultimate UI/relay, counter 0/4/5/reset, activation guards, browser vibration handling and release-note timer/dismissal tests with zero browser errors.

Scene tests verify names over all characters, team boost/slow visuals, point crowns and confetti, cube explosions, continuous camera punch, transient impact frames, spike energy columns and first-bounce shockwaves. Effects preserve ball position/velocity, reuse bounded particle pools, expire before the next serve, respect mute and reduce camera/flash motion when requested.

The complete game test pairs real computer pages with original MotionModel sensor streams. It covers actual serving/returning, both horizontal forehand/backhand directions, every player and spectator result, and rematches in 1v1 and 2v2. Final local results are **5–0 singles (seven hits)** and **0–5 doubles (eight hits)**, with zero browser errors. Final public results are **2–11 singles (14 hits)** and **11–8 doubles (23 hits)**, with every result/rematch and zero browser errors. The live Critical 0/5 counter and server feature flag are also checked for every player.

An initial public doubles replay failed to return while the same production source passed locally. Tracing found a Windows fixture clock defect: 100 nominal 20ms phone ticks took 3130ms, stretching the simulated .45s stroke to roughly .70s. The fixture now uses the original fake-bridge wall-clock catch-up; the unchanged production build then passes both complete public modes. This repair is in the test driver and does not weaken gameplay contact or side checks.

## Hardware limits and player feedback

Automated sensor streams establish software behavior, not subjective feel on every physical device. Real-phone rotation and swing feedback remains the next acceptance step.

iPhone browsers do not expose the Vibration API. Supported Android browsers receive physical-strength vibration; the phone UI reports when vibration is unavailable. This is a browser limitation, documented by [WebKit's open vibration request](https://bugs.webkit.org/show_bug.cgi?id=288846).

## Deployment record

The final release enables `ULTIMATES=1` on the existing single Fly machine. Image `registry.fly.io/pingpong-mehdi-ch:deployment-01M4CWX6BWRM0J7GVCHGDRCRX5` passes Fly health and DNS checks. Live server SHA-256 is `bc6220330be580178943b389000961576e9dbda910eb195078f05bafa1aa7266`. Checked main, scene, original motion/calibration/detector, aim, strength, pose, haptics, phone UI and release-note assets match tested source exactly.

Release ID: `spikes-ultimates-1791434198213`. Native, local, scene, UI, live asset and complete public match logs are saved alongside the workspace as `poddle-final-*.log`.
