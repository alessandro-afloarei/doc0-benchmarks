# Model grid: does the map help, and for whom? (rules fixed 2026-11-16, before any run)

Owner's question: test with smaller models (Opus, Sonnet, Haiku, Sol 6.1, Astra), on small and big repositories,
with and without the map that `doc0_begin` returns, to learn whether doc0 needs the map and when. Approved budget:
Vertex (judges, GCP project staging-pillar) hard stop at $200; Claude on the personal3 subscription and Codex on the
ChatGPT subscription without a token limit.

## The grid (lean)

| | values |
|---|---|
| repositories | small: fd · medium: hono, celery · big: OpenHands, electron (CodeWikiBench rubric) |
| models | Claude Code: claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5 (effort high) · Codex: gpt-6.1-sol, gpt-6-astra (reasoning high) |
| arms | doc0-map, doc0-nomap, openwiki |
| skill | the reviewed doc0-write text (doc0-commercial `329bce9a9`, PR #727) for both doc0 arms |
| runs | one per cell; a second run of both arms of a pair only where rule 4 says so and the budget allows |

75 first runs. Every arm of one repository and model shares model, effort, host, budget, time cap and source SHA.

## Measures

- Grounded rate and grounded claims per 1,000 words, every claim group, judged by **DeepSeek V4.1 Flash** (Vertex MaaS,
  through the metered LiteLLM proxy). Gemini 3.5 Flash at Vertex prices ($1.50/M input, $9/M output with thinking) would
  cost about $280 for the grid's 75 corpora, past the $200 budget; DeepSeek costs about a tenth on the same work
  (CodeWikiBench: $3.35 against $35.14). Sampling is not an option: n=40 samples moved every source 4 to 10 points
  (2026-07-13). Every arm in the grid has the same judge, so the grid's comparisons hold; its grounded rates are not
  comparable one to one with earlier Gemini-judged numbers. One calibration: an earlier corpus re-judged by DeepSeek,
  to report the offset.
- Blind comparison, instrument v2 (navigation order, equal page frames, 3 samples × both orders): pairs
  `doc0-map~doc0-nomap` and `doc0-nomap~openwiki`. Depth, coherence, breadth.
- Big repositories only: CodeWikiBench coverage of the official docs, DeepSeek V4.1 Flash judge alone (it stayed within
  about ±0.03 of the three-judge panel on the seven repositories), every arm.
- Tokens, minutes, turns, completion.

## Decisions

1. **The map helps model M** when, over the repositories M completed with both doc0 arms, any of these holds and the
   map costs at most 25% more total tokens:
   - mean grounded rate +2 points or more for the map;
   - the map wins the blind depth and breadth together in at least ceil(2n/3) of n repositories;
   - on both big repositories, CodeWikiBench coverage +0.03 or more for the map.
2. **The map helps size class S** (small, medium, big) when rule 1's conditions hold within S over all models together.
3. **Outcome:**
   - no model and no size class helped: remove the map (flip `--no-map`, then delete the code), as rule 1 of 2026-11-15 said;
   - every model helped: keep the map on by default;
   - otherwise: keep the map, off by default, and on where it helped (by repository size if the size rule decides;
     else as an opt-in documented for the hosts and models that gained). The report names which.
4. **Second runs**, in this order while the budget lasts: a doc0-map/doc0-nomap pair within 2 points of grounded rate
   whose blind cells are all within ±0.5; then a doc0-nomap/openwiki pair with any blind cell worse. Both arms of the
   pair run again; the measures become the mean of the two runs; blind cells are re-judged on the second run and
   reported beside the first, the first run's cells deciding.
5. **Incomplete runs** (budget, time cap, account limit, no finish proof) score nothing; the pair is re-run whole once,
   then reported as incomplete.
6. **Parity (reported, not a decision):** per model, how many `doc0-nomap~openwiki` blind cells are worse.

## Judging order (the Vertex budget may end first)

Generation does not touch Vertex, so every run is generated first. Judging then goes in this order, each step
complete before the next, so a stop at $200 leaves whole answers rather than scattered cells:

1. fd, hono, celery × all five models: grounded rate for all arms, both blind pairs.
2. OpenHands, electron × all five models: the same.
3. CodeWikiBench (DeepSeek) on OpenHands and electron, all arms.
4. Second runs (rule 4).

The ledger (`vertex-ledger.jsonl`) is checked before every call; a stop is reported with what was and was not judged.

## Notes added before any grid judging (2026-11-16)

- Calibration of the DeepSeek grounded judge on `fd-doc0-nomap-2026-11-15-skillfinal` (157 claim groups): Gemini 0.949,
  DeepSeek 0.840 and 0.828 in two runs. DeepSeek reads about 11 points stricter; its two runs agree within one claim
  group. Cost about $0.00016 a claim group, so grounded judging of the grid is a few dollars.
- The harness judges three blind pairs per repository (`doc0-map~openwiki` too). Kept: it costs about $34 over the grid,
  fits the budget, and reports parity of the map arm as well. Decisions still read only the two pairs above.
- Revised first-pass estimate: about $130 (grounded under $10, blind comparisons about $100, CodeWikiBench about $20).
