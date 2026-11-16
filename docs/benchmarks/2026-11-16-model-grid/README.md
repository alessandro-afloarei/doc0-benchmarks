# Model grid: does doc0's map help, and for whom? (2026-11-16)

The question: the full run of 2026-11-15 found that the map `doc0_begin` returns does not earn its place for Opus 5.5.
Before removing it, test other models and repository sizes: Opus 5.5, Sonnet 5.5 and Haiku 5.5 in Claude Code, Sol 6.1
and Astra in Codex, on a small (fd), two medium (hono, celery) and two big repositories (OpenHands, electron), each with
the map, without it, and openwiki beside them. The rules were written before any run: [RULES.md](RULES.md).
Analysis script and its output: [analyze.py](analyze.py), [analysis.json](analysis.json). Per-model reports:
`../2026-11-16-g<model>-p1|p2-…` (first runs), `../2026-11-16-g<model>2-s2-…` (second runs).

110 runs (75 first runs, 35 second runs), every one complete through its finish tool. Judges: grounded rate by
DeepSeek V4.1 Flash (every claim group; about 11 points stricter than the Gemini judge of earlier reports, so the rates
here compare within this grid only), blind comparison by Gemini 3.5 Flash under instrument v2, CodeWikiBench coverage
by DeepSeek alone. Vertex spend $77.07 of a $200 hard stop, metered per call.

## Answer

| model | grounded rate, map vs no map | blind depth+breadth wins (needed) | CodeWikiBench coverage, map vs no map | tokens | the map helps |
|---|---|---|---|---|---|
| Opus 5.5 | +0.2 points | 1 of 5 (4) | OpenHands +0.03, electron −0.07 | 0.85× | no |
| Sonnet 5.5 | +2.0 points | 1 of 5 (4) | OpenHands 0.00, electron +0.31 | 1.17× | yes, on grounded rate |
| Haiku 5.5 | −0.6 points | 0 of 5 (4) | OpenHands +0.06, electron +0.09 | 0.87× | yes, on coverage |
| Sol 6.1 | +0.5 points | 0 of 5 (4) | OpenHands +0.07, electron −0.07 | 1.16× | no |
| Astra | +0.9 points | 0 of 5 (4) | OpenHands +0.12, electron −0.05 | 1.00× | no |

By repository size, over all five models: small (fd) +1.2 points, medium −2.0, big **+2.9 points** at 1.09× tokens.
Only big repositories pass.

**Rule 3's outcome: keep the map, off by default, on where it helped**: for the smaller Claude models and for big
repositories. The strong models (Opus, Sol, Astra) gain nothing from it.

How sure: Sonnet passes at exactly +2.0 points, the threshold; its electron coverage gap (0.54 against 0.23) is the
largest single number in the grid and comes from one doc0-nomap run. Haiku passes on coverage alone, with its grounded
rate slightly lower with the map. The size result moved between the first runs (small passed, big did not) and the
combined runs (big passes, small does not). Read it as: the map helps weaker agents find what a repository covers, and
helps on big repositories; for a strong agent on a small or medium repository it is spent tokens.

## Parity with openwiki (reported, not decided)

`doc0-nomap~openwiki`, depth / coherence / breadth over five repositories (15 cells per model). Second runs repeated
every pair with a worse cell.

| model | worse in the first run | worse in both runs |
|---|---|---|
| Opus 5.5 | 3 of 15 | none |
| Sol 6.1 | 5 of 15 | none |
| Sonnet 5.5 | 3 of 15 | fd breadth |
| Astra | 5 of 15 | OpenHands breadth, electron breadth |
| Haiku 5.5 | 7 of 15 | fd breadth, hono depth, OpenHands depth |

With Opus and Sol, doc0 is at parity with openwiki: no cell is worse in both runs. With the smaller models it loses a
few cells consistently, on breadth and depth: they write fewer pages (Sonnet 7 to 21, Haiku 10 to 33, Astra 7 to 13)
and cover less of the official docs (CodeWikiBench on OpenHands: openwiki 0.90 against doc0 0.84 with Sonnet, 0.78
against 0.58 with Haiku). Grounded rates stay comparable: the smaller models' doc0 pages are not less true, they say
less.

## Per cell (first run; re-run arms show the mean of two runs)

Pages map / nomap / openwiki; grounded rate; CodeWikiBench coverage (big repositories); blind verdicts depth/coherence/breadth.

| model | repo | pages | grounded map | grounded nomap | grounded openwiki | coverage map | coverage nomap | coverage openwiki | map~nomap | nomap~openwiki |
|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | fd | 12 / 12 / 13 | 0.891 | 0.883 | 0.920 |  |  |  | −/=/= | +/−/= |
| Opus 5.5 | hono | 38 / 29 / 14 | 0.882 | 0.884 | 0.770 |  |  |  | +/+/+ | =/−/+ |
| Opus 5.5 | celery | 28 / 27 / 17 | 0.789 | 0.862 | 0.898 |  |  |  | =/+/= | −/=/+ |
| Opus 5.5 | OpenHands | 27 / 26 / 23 | 0.814 | 0.828 | 0.721 | 0.891 | 0.866 | 0.836 | +/+/= | =/=/+ |
| Opus 5.5 | electron | 18 / 24 / 17 | 0.916 | 0.828 | 0.809 | 0.463 | 0.532 | 0.466 | =/=/− | +/+/+ |
| Sonnet 5.5 | fd | 8 / 7 / 12 | 0.867 | 0.839 | 0.895 |  |  |  | +/+/+ | =/=/− |
| Sonnet 5.5 | hono | 18 / 20 / 12 | 0.867 | 0.878 | 0.873 |  |  |  | −/−/− | −/=/+ |
| Sonnet 5.5 | celery | 17 / 13 / 14 | 0.905 | 0.876 | 0.895 |  |  |  | =/=/+ | =/+/− |
| Sonnet 5.5 | OpenHands | 17 / 21 / 21 | 0.803 | 0.785 | 0.846 | 0.835 | 0.837 | 0.897 | −/−/− | =/=/= |
| Sonnet 5.5 | electron | 20 / 15 / 15 | 0.916 | 0.880 | 0.890 | 0.538 | 0.228 | 0.474 | =/=/+ | =/+/= |
| Haiku 5.5 | fd | 9 / 10 / 12 | 0.893 | 0.862 | 0.889 |  |  |  | =/−/− | −/=/− |
| Haiku 5.5 | hono | 17 / 33 / 18 | 0.757 | 0.878 | 0.897 |  |  |  | −/−/− | −/=/+ |
| Haiku 5.5 | celery | 16 / 32 / 15 | 0.864 | 0.899 | 0.860 |  |  |  | −/−/− | =/=/+ |
| Haiku 5.5 | OpenHands | 23 / 21 / 19 | 0.824 | 0.792 | 0.874 | 0.637 | 0.578 | 0.782 | −/−/+ | −/−/− |
| Haiku 5.5 | electron | 23 / 16 / 17 | 0.926 | 0.861 | 0.808 | 0.191 | 0.097 | 0.158 | =/=/+ | =/=/− |
| Sol 6.1 | fd | 7 / 8 / 8 | 0.935 | 0.948 | 0.945 |  |  |  | −/−/− | =/−/= |
| Sol 6.1 | hono | 14 / 16 / 11 | 0.951 | 0.983 | 1.000 |  |  |  | =/−/− | =/=/+ |
| Sol 6.1 | celery | 12 / 12 / 13 | 0.993 | 0.974 | 0.987 |  |  |  | +/+/= | =/=/− |
| Sol 6.1 | OpenHands | 17 / 13 / 13 | 0.932 | 0.905 | 0.981 | 0.728 | 0.654 | 0.643 | =/=/+ | −/−/− |
| Sol 6.1 | electron | 13 / 13 / 10 | 0.987 | 0.966 | 0.935 | 0.228 | 0.302 | 0.172 | =/+/+ | +/=/+ |
| Astra | fd | 7 / 7 / 7 | 0.956 | 0.953 | 0.938 |  |  |  | +/=/= | +/+/− |
| Astra | hono | 12 / 13 / 12 | 0.967 | 0.967 | 0.900 |  |  |  | =/=/− | +/−/+ |
| Astra | celery | 11 / 12 / 12 | 0.985 | 0.958 | 0.975 |  |  |  | =/−/− | =/=/= |
| Astra | OpenHands | 15 / 11 / 13 | 0.943 | 0.941 | 0.929 | 0.724 | 0.600 | 0.601 | =/+/+ | =/−/− |
| Astra | electron | 10 / 12 / 12 | 0.974 | 0.962 | 0.988 | 0.199 | 0.253 | 0.243 | −/−/− | =/=/− |

## Limits

- One or two runs per cell; a single blind cell moves by ±1 between runs of the same system.
- The grounded judge here (DeepSeek) is not the one of earlier reports (Gemini); within the grid every arm had the same.
- CodeWikiBench coverage by one judge (DeepSeek), on two repositories; electron's rubric is low for every system.
- Codex runs have no spend figure (subscription); Claude runs report Claude Code's API-equivalent cost.
