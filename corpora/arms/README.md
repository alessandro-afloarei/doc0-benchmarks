# Generation arms

Docs the same Claude model wrote for one repository, three ways (plan 4e in doc0-commercial):

| Arm | Skill | MCP server |
|---|---|---|
| `openwiki` | `openwiki` (`openwiki@0.9.0`, `integrations install claude --project .`) | `openwiki mcp --host claude` |
| `doc0-map` | `doc0-write` (from the packed doc0 CLI) | `doc0 mcp --no-publish` |
| `doc0-nomap` | `doc0-write` | `doc0 mcp --no-publish --no-map` |

Each folder `<repo>-<arm>-<date>/` holds the pages as the arm wrote them (doc0: `.doc0/pages/*.md`; openwiki:
`openwiki/**/*.md` without the generated `index.md` pages, plus `openwiki/.claims/` as `_claims/`) and `_meta.json`
(`schema_version: 2`: model, effort, tool version, status and reason, usage, cost, time). `pnpm bench:grounding`
skips this folder; `pnpm bench:arms` scores it.

## How a run is made

```bash
export BENCH_WORK_DIR=/work/artifacts/doc0-arms-<date>          # clones and transcripts, never /tmp
export DOC0_CLI=$(bash <doc0-commercial>/packages/cli/scripts/install-packed.sh "$BENCH_WORK_DIR/doc0-cli")
export DOC0_SKILL=$BENCH_WORK_DIR/doc0-cli/node_modules/@alessandro-afloarei/doc0/skill/doc0-write/SKILL.md
export DOC0_COMMIT=$(git -C <doc0-commercial> rev-parse --short HEAD)   # optional, recorded in tool_version
npm install --prefix "$BENCH_WORK_DIR/tools" openwiki@0.9.0
export OPENWIKI_BIN=$BENCH_WORK_DIR/tools/node_modules/.bin/openwiki
export ANTHROPIC_API_KEY=…                                       # from the environment only, never written anywhere
pnpm bench:arm --repo fd --arm doc0-map --date <date> --max-pages 3 --budget 15
```

`runArm` clones the repository at its corpus SHA into `$BENCH_WORK_DIR/<repo>-<arm>/src` (it refuses a folder that
already exists, so a paid transcript is never overwritten), installs the arm, and runs `claude -p` with the clone as
its working directory, `CLAUDE_CONFIG_DIR=$BENCH_WORK_DIR/<repo>-<arm>/claude-config` (empty), `--setting-sources
project`, `--strict-mcp-config --mcp-config <the arm's file>`, `--no-session-persistence`, `--max-budget-usd` and a
time cap that kills the whole process group. The stream-json transcript (`transcript.jsonl`), the final result
(`result.json`) and claude's stderr stay in the work folder.

A run is `complete` only when the result's subtype is `success`, the arm's finish step deleted its run state
(`.doc0/run.json`, `openwiki/.run.json`), pages exist, and the transcript's init event shows the arm's own setup:
exactly the arm's MCP server, no plugin, the arm's skill and not the other system's. Anything else is `incomplete`
with its reason, and the report scores it as nothing.

## Isolation check

Every run checks its own init event (above). The one-off probe the plan asks for (one page, `--budget 2`,
`--model claude-haiku-5-5`, read the transcript by hand) has not run yet: it needs the API key.
