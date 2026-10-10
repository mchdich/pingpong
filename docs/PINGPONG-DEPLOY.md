# Deploy pingpong.mehdi.ch

The existing Fly app is `pingpong-mehdi-ch`. Use `fly.pingpong.toml`, which builds the original `Dockerfile` and starts `server/game.js`. Do not use the upstream `fly.toml`, which names the Poddle owner's app.

```bash
fly deploy --config fly.pingpong.toml --ha=false
fly status --app pingpong-mehdi-ch
```

Keep exactly one machine: rooms and phone pairings live in process memory. A deploy or restart ends current matches. The game page is `/`, controller is `/pad.html`, and both game and phone WebSockets use `/` with the original query parameters. Privacy and terms are `/privacy.html` and `/terms.html`.

The existing GoDaddy DNS CNAME has Name `pingpong` and Value `rkgjzg8.pingpong-mehdi-ch.fly.dev`. HTTPS was issued for `pingpong.mehdi.ch`. If the app is recreated, obtain its exact new target with:

```bash
fly certs setup pingpong.mehdi.ch --app pingpong-mehdi-ch
fly certs check pingpong.mehdi.ch --app pingpong-mehdi-ch
```

The current version retains original Poddle court controls and adds weak/net, strong/out, positional doubles, matched forehand/backhand, strict current contact, ultimates and spiking. Keep `ULTIMATES="1"` for this release. Update `web/release.json` with a fresh ID and the shipped changes; each browser displays it for ten seconds on first viewing. See [verification and physical feedback status](PINGPONG-VERIFICATION.md). After each update, verify the served source, complete live games, HTTPS, QR phone pairing and staged calibration. No billing or DNS changes are needed for this revision.
