# Games — repo guide for Claude

A GitHub Pages "pocket handheld": you open the site on a phone and it becomes a
Game Boy-style console with a menu of cartridges. Most of the work lives in a
reusable engine so new games are small.

## Layout

- `engine/` — the console: framebuffer, palettes, bitmap font, input, audio,
  scene stack, UI widgets, and the geo→tilemap map compiler. Reusable by every game.
- `games/` — one directory per cartridge, plus the cartridge manifest.
- `tools/` — build/validate scripts run locally and in CI (Node, no deps).
- `data/` — generated data committed into the repo (map extracts, art) so the
  site stays fully static at runtime.
- `.github/workflows/` — Pages deploy, content validation, and data fetch jobs.

## Fetching anything from the internet

**This sandbox has no general outbound network.** The agent proxy enforces an
egress allowlist, so `curl`/`WebFetch` to sites like Overpass/OSM, Wikimedia,
tile servers, etc. fail with `403 CONNECT tunnel failed`. Do not retry those and
do not try to route around the proxy.

**Use a GitHub Actions workflow as the network layer instead.** GitHub-hosted
runners have unrestricted egress. The pattern:

1. Write (or extend) a fetch script under `tools/` that pulls what is needed and
   writes normalized output into `data/`.
2. Add or reuse a workflow in `.github/workflows/` that runs it, with
   `workflow_dispatch` so it can be triggered on demand.
3. Have the workflow commit the fetched output back to the working branch (or
   open a PR), so the data is versioned and the runtime site never needs network.
4. Trigger it with `mcp__github__actions_run_trigger`, poll with
   `mcp__github__actions_list` / `actions_get`, and read failures with
   `mcp__github__get_job_logs`.

Keep fetched third-party data attributed and license-compatible; record the
source, license, and fetch date in `data/<set>/SOURCES.md`.

## Ground rules

- Runtime is static: plain ES modules, no bundler, no runtime network calls.
- Engine code must stay DOM-free where possible (`engine/geo.js`, map and art
  data) so `tools/validate.mjs` can exercise it under Node in CI.
- Art is authored as data (tile strings, draw-op lists), never as binary blobs
  checked in by hand.
- Work happens on the branch named in the session brief; push there.
