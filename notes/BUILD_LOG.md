# CAPMON ARENA: BUILD LOG

Living file. Lets any session pick up the Season 0 build without the chat history. Plan: `CAPMON_ARENA_RELEASE_PLAN_V1.md`.

## Status (Nov 16, 2026, 02:40 PT)

| Stage | State |
|---|---|
| 1. Engine | Done. All checks pass |
| 2. Game flow | Done. Full flow passes an automated run on phone and desktop sizes |
| 3. Look and share | Sprites and stage art are in (Nov 16). Left: share card image, share to X button, sound |
| 4. Hardening and launch kit | Not started |
| Hosting | Repo exists and is empty, DNS is live. **Blocked: Claude cannot push yet** (see below) |
| Preview | Private Claude artifact, published Nov 16: https://claude.ai/artifact/Bywz1fikpMiSKcA9fbjMhP (built by `tools/bundle_artifact.py`, weights shipped as `brain.js`) |

**Next action:** when Tik says the GitHub App is installed: push (two commits are waiting in the local clone), turn on GitHub Pages (main branch, `/docs` folder), confirm arena.capmon.fun loads. Then the rest of Stage 3, then Stage 4. Also collect Tik's feedback on the preview.

## Hosting state

- Repo `ticchu12-netizen/capmon-arena`: created by Tik, empty, readable from Claude.
- DNS: `arena.capmon.fun` CNAME to `ticchu12-netizen.github.io` is live (checked Nov 16).
- Push: tried and refused on Nov 16 (HTTP 403). A commit with the whole tree is ready in the local clone. The Claude GitHub App has no access to this repo. Fix on Tik's side: https://github.com/apps/claude/installations/select_target, pick the account, add `capmon-arena` under repository access.
- Site folder is `docs/` (GitHub Pages: branch `main`, folder `/docs`). `docs/CNAME` holds the domain. `docs/index.html` carries `noindex` until launch day; remove it then.
- After the first deploy: in GitHub Pages settings turn on Enforce HTTPS, and verify the domain capmon.fun under account settings so nobody else can claim a subdomain.

## Where the work lives

- Durable copy: `/mnt/user-data/outputs/capmon-arena/` plus `/mnt/user-data/outputs/capmon-arena-checkpoint.tgz`. Updated by `tools/checkpoint.sh "note"`.
- Working copy: `<scratchpad>/arena-build/`. If it is gone, unpack the tarball there.
- Local clone for pushing: `/home/claude/capmon-arena` (copy the working tree in, minus `node_modules` and `test/out`). If the clone is gone: clone again, copy the tree in, commit, push.
- Preview: `python3 tools/bundle_artifact.py <dir>` writes the one-file page plus `brain.js` and `assets/`. Publish the page with those as supporting files to keep the same artifact link.
- Layout: `docs/` is the published site. `ref/` is the server engine and ONNX model used as reference. `test/` the checks. `tools/` scripts. `notes/` this log.

## How to re-run the checks

```
node test/engine_checks.js                                           # 55 unit and property checks
node test/golden_vs_server.js 400                                    # whole battles vs server engine (needs onnxruntime-node)
node test/collect_obs.js 600 && python3 test/model_parity.py 4000   # model vs ONNX runtime
python3 test/browser_check.py                                        # engine in headless Chromium
python3 test/e2e.py                                                  # whole game flow, phone and desktop (about 100 s, run in background)
node tools/make_expected.js                                          # after any engine change
```

## Decisions, with reasons

1. **The model runs as plain JavaScript, not through an ONNX runtime.** 1.4M weights, about 1.5 ms per decision on a laptop, 7 ms on a slow phone. No WASM, no CDN, same answer on every device.
2. **No `Math.exp`, `Math.tanh` or `Math.random` in the engine.** Their last digits differ between browsers. This is what makes replays hold across devices.
3. **Engine is a line-for-line port of `capbot-server/battleSim.js`**, checked against the Unity C#. Three seeded random streams per game: dice, side A's brain, side B's brain.
4. **Arena rounds use the Unity rule: both sides pick at the start of the round.** The server lets the second mover see the first move. A test-only switch keeps the server behaviour.
5. **Equal speed is settled by a seeded coin flip each round.** Mirror games are now 47 to 53% for either side (was 68 to 76% for side A).
6. **Student brains are: model's first choice, then habit, then randomness. No planner, no rules.** Tested both ways on Nov 15. With the planner underneath, habits change almost nothing (50 to 52%) and teaching can only hurt. Without it, habits swing results from 23% to 73% against the same opponent. Teaching has to matter, so the planner stays out. To be confirmed against `StudentBrain.cs`.
7. **Habit constants are unchanged**: 108 situations, 5 picks for a habit, 35% cap, randomness 0.40 falling to 0.20 at 60 situations, 8 new situations a day.
8. **New default: each situation remembers at most 24 picks**, so a brain can be re-taught. Not in the old constants.
9. **Match format: first to two games, each game a mirror.** Game 1 on side A's starter, game 2 on side B's, game 3 on the remaining creature. 41% of matches go to three games.
10. **Ladder is rating based, not a calendar league.** Ten house brains with fixed ratings (fit from 5,500 matches). The player starts at 1000, the measured rating of an untaught brain, and plays 3 ranked matches a day against house brains near their rating. Elo, K=32. No missed-day problem, nothing to simulate for other players.
11. **Ranked results are fixed when played.** The brain is frozen into the match code at kick-off. Results stay hidden until watched.
12. **Codes.** Brain code `b1.` (39 to 420 characters) and match code `m1.` (seed, both brains, claimed winners). A match code is enough to re-run and check a match. Challenge links are `#c=<brain code>`, match links `#m=<match code>`.
13. **Saves are local only** (`localStorage`, key `capmon-arena:v1`), repaired on load, with an in-memory fallback.
14. **Teach mode offers three sparring partners** (Pebble, Marshal, Apex) and any matchup. The plan said "against the 60M model" only. Losing every teaching battle to the full AI is a bad first five minutes.
15. **Site folder is `docs/`** so GitHub Pages serves only the site and not the tests.
16. **Art.** Rageblaze and Tsunami use the 15-frame attack sheets from capmon.fun, scaled to 384 px frames. The stage is the two-island background from capmon.fun, always 16:9 so the islands stay in frame, with the HP panels above it and the move line below it. Healspike has no 2D sheet, so its sprite is made from the 3D model render by `tools/make_healspike_sprite.py` (flat colours, dark outline). It is one frame, so it lunges but does not animate. A real Healspike sheet from Tik would replace it by swapping one file.

## House roster and ratings (fit Nov 15, 5,500 matches, 13,237 games)

| Brain | Rating | What it is |
|---|---|---|
| Apex | 1611 | Full game AI: model, planner, rules. Beat an untaught brain 100 of 100 |
| Vex | 1354 | Full game AI with 40% random moves |
| Opal | 1179 | Habit brain: Intimidate early, element move after |
| Marshal | 1153 | Model plus rules, 10% random |
| Torrent | 1128 | Habit brain: always the element move |
| Fuse | 1110 | Habit brain: element move, big move on a hurt target |
| Bonk | 1104 | Habit brain: always Headbutt |
| Static | 1025 | Model with 60% random moves |
| (untaught player) | 1000 | Anchor |
| Pebble | 967 | Model with 25% random moves |
| Glare | 886 | Habit brain: always Intimidate, 40% random |

## Findings worth keeping

- **The raw model is a weak player on its own.** It never picks the element move (0 of 11,483 decisions) and picks Intimidate 62% of the time. Random moves do slightly better than its first choice (Static 1025 vs Pebble 967). The planner is what makes the game AI strong: planner alone equals the full AI (53.5%), rules alone lose 100% to it.
- **So lower randomness alone does not make a taught brain stronger.** Habits do. The page describes randomness neutrally and does not promise that coverage adds strength.
- **Apex is close to unbeatable for a taught brain** (best simple styles win 3 to 35% of single games depending on creature, about 1 match in 20). It is the boss at the top. Unknown: how high a carefully taught brain can get. Worth a search before launch copy claims anything.
- **Mirror games only reach 36 of the 108 situations.** The 60 needed for the lowest randomness need cross-type sparring in Teach mode. Coverage will plateau for most players, as the Oct handoff already found.
- Cross-type results under Arena rules: Tsunami beats Rageblaze 79%, Rageblaze beats Healspike 100%, Tsunami beats Healspike 97%. Mirrors stay the only fair format.
- Without analytics the stop rule in the release plan (300 brains taught, 1 in 5 returning, 50 challenge links opened) cannot be measured. Needs a privacy-friendly counter (GoatCounter or similar, Tik creates the account) before launch.

## Open items

- First push and Pages (blocked on GitHub App access).
- Stage 3, rest: share card image, share to X button, sound with a mute switch.
- Stage 4: content security policy, offline cache, analytics hook, launch thread, clips, FAQ, WordPress snippet.
- Not tested here: Firefox and Safari. The in-page device test (Check tab) will tell on a real phone.
- `StudentBrain.cs` as .txt would settle decisions 6 and 8.

## Check history

| When (PT) | Check | Result |
|---|---|---|
| Nov 15, 20:25 | Weights extracted from the ONNX file | `brain.bin` sha256 `ed8c83f2...23e9`, 1,019,524 values |
| Nov 15, 20:30 | Plain-JS model vs ONNX runtime | Same pick on 15,483 of 15,483 inputs. Largest raw difference 0.0001 |
| Nov 15, 20:32 | Whole battles vs the server engine | 3,600 of 3,600 identical turn by turn (60,661 turns) |
| Nov 15, 20:33 | Unit and property checks | 55 of 55 pass |
| Nov 15, 21:00 | Engine in headless Chromium, desktop and phone | Same fingerprint as Node. 1.3 ms per decision, 34 ms per game; 7 ms and 147 ms with 4x CPU throttle |
| Nov 15, 21:10 | Balance under Arena rules, 3 creatures x 41 pairings x 150 games | See findings |
| Nov 15, 21:45 | House ratings fit | 5,500 matches |
| Nov 15, 22:05 | End-to-end flow, phone and desktop | 29 of 29 steps pass on each, no page errors |
| Nov 16, 01:30 | DNS and repo check | DNS live, repo readable, push refused |
| Nov 16, 02:10 | Preview bundle | Published as a private artifact. Full flow passes on the bundle |
| Nov 16, 02:35 | Sprites and stage art | Full flow passes again, phone and desktop, no page errors. Preview updated |
