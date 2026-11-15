# doc0's skill against openwiki, and doc0 on CodeWikiBench (2026-11-15)

Written by hand after the runs. The generated reports it cites sit beside it in `docs/benchmarks/`.

## Why

The full run (`2026-11-15-full-local-generation-arms.md`) gave openwiki 7 of 9 blind-comparison cells against doc0,
coherence on every repository. The owner asked for doc0 to be at least at parity on every blind benchmark. A study
of the verdicts (`/work/artifacts/openwiki-gap-2026-11-15/REPORT.md` on the bench host) found two causes:

- The instrument read the two wikis differently: pages in path order (doc0's overview fell outside the judge's 12
  pages on hono and celery), and a frame that gave openwiki pages a title and ran doc0's together. Instrument v2
  (`28a655a`) reads each wiki in its own navigation order and frames every page alike; it also keeps every raw call.
- doc0's pages did split and repeat more: 30 pages against 16 on hono, 25 source files explained on three or more
  pages against 1, catch-all pages, and subagents writing pages in parallel without their neighbours.

Instrument v2 measured its own noise: the wiki read first gains about +0.23 margin per call, and doc0 judged
against itself scored ±1 on coherence. So parity here means: on each repository and dimension, the mean margin over
runs is at least 0, and no dimension is negative in every run.

## The skill, four versions (doc0-commercial `afl/local-gen-skill-v2`)

| version | commit | change |
|---|---|---|
| v2 | `4e516d61f` | plan by system and flow after tracing real flows; merge pages sharing a flow or files; 800 to 1,500 words a page; an overview page with parts table, main-flow diagram and design decisions; one page at a time, no subagents; flat sections |
| v3 | `c1e08c39f` | a link sits inside the paragraph it extends; cite the code that does the work; small parts of one kind share a catalogue page |
| v4 | (head) | every fact in a block is in the lines it cites; no usage claims or advice the code does not show |

All runs: Opus 5.5, effort high, doc0 without the map (rule 1 removed it), subscription, budget $100, the repository's
time cap. Blind cells are instrument v2, 3 samples × both orders, doc0 first.

| run | vs openwiki run | depth | coherence | breadth | doc0 grounded | openwiki grounded |
|---|---|---|---|---|---|---|
| hono v2a | full | equal | better | better | 0.893 | 0.899 |
| hono v2b | full | equal | **worse** | better | 0.839 | 0.893 |
| hono v3a | full | better | equal | better | 0.913 | 0.893 |
| hono v3b | full | better | equal | better | 0.898 | 0.887 |
| hono v3b | skillv3c (fresh) | equal | equal | better | 0.893 | 0.976 |
| celery v3a | skillv3a (fresh) | better | equal | better | 0.856 | 0.862 |
| celery v3b | full | better | equal | better | 0.851 | 0.772 |
| fd v3a | skillv3a (fresh) | equal | equal | equal | 0.872 | 0.925 |
| fd v3b | full | equal | equal | equal | 0.886 | 0.903 |
| celery v4a | skillv3a (fresh) | equal | better | equal | 0.863 | 0.872 |
| celery v4b | full | equal | better | better | 0.881 | 0.782 |

From v3 on, no blind cell is worse in nine comparisons over three repositories and two openwiki runs each.

What it cost: celery's grounded rate fell from 0.892 (old skill, full run) to 0.851 and 0.856 with v3, and v4 brought
it back to 0.863 and 0.881. A re-judge of every claim traced the drop to paragraphs that only point to another page,
citations of a declaration instead of the code that acts, and usage claims. Grounded claims per 1,000 words stayed
40 to 60% above openwiki's in every run. openwiki's own grounded rate moved from 0.893 to 0.976 between two hono runs:
its agent writes its claims beside the page, one statement each, so the two rates do not compare one to one.

Corpora: the fresh runs are committed (`*-skillv2*`, `*-skillv3a`, `*-skillv3b`, `*-skillv4*` for doc0;
`celery-openwiki-…-skillv3a`, `fd-openwiki-…-skillv3a`, `hono-openwiki-…-skillv3c` for openwiki). The other openwiki
folders the reports name are byte-identical copies of `<repo>-openwiki-2026-11-15-full` (hono v2a/v2b/v3a/v3b,
celery v3b/v4b, fd v3b) or of `celery-openwiki-2026-11-15-skillv3a` (celery v4a), and `hono-doc0-nomap-…-skillv3c` is
`…-skillv3b`; they are not committed twice.

## CodeWikiBench, doc0 with skill v4

CodeWikiBench (FSoft-AI4Code, pinned `00f56b65`, which no longer scores a crashed leaf as passed) scores docs against
a rubric built from each project's official docs. Rubrics: HF `anhnh2002/codewikibench` at `6d215eb7`, the seven
repositories with published peer scores (486 leaves). Judges: a panel without Claude or OpenAI models, through a local
LiteLLM proxy on Vertex: Gemini 3.5 Flash, DeepSeek V4.1 Flash, GLM-5.2, averaged (GPT-OSS-120B returned tool calls as
text on Vertex and scored most leaves 0; it was dropped). doc0's pages: one run per repository at the dataset commit,
corpora `arms/<repo>-doc0-nomap-2026-11-15-cwbv4`.

| repo | pages | doc0 (panel) | Gemini | DeepSeek | GLM |
|---|---|---|---|---|---|
| OpenHands | 38 | 0.927 | 0.959 | 0.905 | 0.917 |
| svelte | 34 | 0.937 | 0.927 | 0.901 | 0.983 |
| puppeteer | 36 | 0.931 | 0.924 | 0.954 | 0.914 |
| ml-agents | 40 | 0.843 | 0.849 | 0.845 | 0.836 |
| logstash | 41 | 0.876 | 0.844 | 0.887 | 0.898 |
| wazuh | 36 | 0.899 | 0.870 | 0.887 | 0.941 |
| electron | 27 | 0.749 | 0.706 | 0.719 | 0.823 |
| **mean of 7 (×100)** | | **88.03** | | | |

Same panel, the peers' docs that ship with the benchmark (OpenHands only): DeepWiki 0.759, CodeWiki 0.820. The
CodeWiki README's September 2026 table (judge not named) gives the seven-repository means DeepWiki 65.06, CodeWiki 1.0
69.79, CodeWiki 2.0 82.23. Only OpenHands is a like-for-like comparison: no parsed peer docs ship for the other six,
and a crawl of DeepWiki today describes newer commits than the rubrics.

puppeteer's GLM pass first hit 36 proxy connection errors (scored 0 by the benchmark); GLM was re-run on that
repository alone, and the failed pass is kept beside it. Judging cost $78.85 at LiteLLM's list prices.
Generation cost $306.56 API-equivalent on the subscription.

## Limits

- One CodeWikiBench run per repository; a single judge varies by about ±0.015 between passes.
- CodeWikiBench rewards coverage of the official docs, not accuracy: it does not check citations.
- Every arm and every CodeWikiBench corpus was written by one Claude model at one effort.
