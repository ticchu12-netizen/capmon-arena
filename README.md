# Capmon Arena

Season 0. A free browser game on the real Capmon World battle engine: teach a brain by playing, then watch it fight ranked matches on its own. No account, no wallet, no server.

Live at https://arena.capmon.fun

## What is in here

| Folder | What |
|---|---|
| `docs/` | The site, served by GitHub Pages. Plain HTML, CSS and JavaScript, no build step. |
| `docs/js/engine.js` | The battle engine and the policy network, with seeded dice. Runs in a browser and in Node. |
| `docs/js/game.js` | Season 0 rules: house roster, match format, ratings, daily card, brain and match codes. |
| `docs/js/app.js` | The page. |
| `docs/assets/brain.bin` | The 58M-step Capmon model as raw weights (from `capbot-server/brain/CapmonAI-57999998.onnx`). |
| `ref/` | The server engine and the ONNX file the port is tested against. |
| `test/` | Checks: model vs ONNX runtime, whole battles vs the server engine, unit checks, browser run, end-to-end flow. |
| `tools/` | Weight extractor, house rating fit, expected-hash generator, checkpoint script. |
| `notes/BUILD_LOG.md` | Status, decisions with reasons, check history. |

## Run it locally

```
python3 -m http.server 8080
# open http://localhost:8080/docs/
```

## Run the checks

```
npm install onnxruntime-node          # only for the comparison against the server engine
node test/engine_checks.js
node test/golden_vs_server.js 400
node test/collect_obs.js 600 && python3 test/model_parity.py 4000
python3 test/browser_check.py         # needs Python Playwright
python3 test/e2e.py
```

After changing `engine.js`, run `node tools/make_expected.js` to refresh the hashes the in-page device test compares against.

## How a match stays honest

A match is fully described by its code: the dice seed and both brains. The engine uses no `Math.random` and no `Math.exp`, so every device computes the same battle. Anyone can paste a match code into the Check tab and re-run it.
