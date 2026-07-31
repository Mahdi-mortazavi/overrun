# OVERRUN

A browser arena shooter that installs like an app, plays offline, and takes
eight people online.

* **Co-op waves** — up to four players against a director that composes each
  wave against what your party has actually built.
* **Team deathmatch** — 4v4, first to thirty.
* **Squad royale** — 2v2v2v2 in an arena that closes in the last third.

Everything the game draws, plays and animates is generated at runtime. There
are no model files, no texture files and no audio files anywhere in this
repository — the download is about 210 kB gzipped plus three.js.

## Layout

```
packages/
  shared/    the simulation. No DOM, no renderer, no network. Runs identically
             in the browser and inside a Cloudflare Durable Object.
  client/    three.js renderer, procedural audio, HUD, netcode client, PWA
  server/    Cloudflare Worker + MatchRoom/Matchmaker Durable Objects
  landing/   the marketing page
tools/       headless simulation harness, screenshot capture, icon generation
```

## Running it

```bash
# client
cd packages/client && npm install && npm run dev

# authoritative server (needs a Cloudflare account)
cd packages/server && npm install && npx wrangler dev
```

## Testing without a browser

```bash
node tools/simtest.mjs      # runs every mode headless, prints balance telemetry
node tools/shots.mjs        # drives the built game in headless Chromium
node tools/beauty.mjs       # staged captures for the landing page
```

## Deploying

See `DEPLOY.md`.

## Licence

Apache License 2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

You may use, modify, distribute and sell this, including commercially, as long
as you keep the notice and state your changes. The patent grant is the reason
Apache 2.0 was chosen over MIT: anyone contributing to this cannot later sue a
user over a patent covering what they contributed.
