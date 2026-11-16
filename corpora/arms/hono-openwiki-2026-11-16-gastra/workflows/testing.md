---
type: workflow
title: Testing and performance investigation
description: Contributor setup, focused Vitest and type checks, runtime coverage, JSX variants, CI, and performance tools.
tags: [testing, ci, performance, types]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:36:56.362Z
sources:
  - id: openwiki-source-4ad7f19fbe567666e4b1c2dc
    resource: repo://.github/actions/perf-measures/action.yml
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-d6962701329196861d6a8f70
    resource: repo://.tool-versions
  - id: openwiki-source-55779201425e71d18f669d25
    resource: repo://benchmarks/http-server/benchmark.ts
  - id: openwiki-source-95a32542d58d8f21c219dfbe
    resource: repo://benchmarks/routers/package.json
  - id: openwiki-source-7dc952d611a75d93fb9b2fb5
    resource: repo://bunfig.toml
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-939c9255fe164ffbc010d463
    resource: repo://perf-measures/bundle-check/scripts/check-bundle-size.ts
  - id: openwiki-source-c8b098b38b0fd299820db61c
    resource: repo://perf-measures/type-check/scripts/generate-app.ts
  - id: openwiki-source-5ca635b054b8dce946b0251d
    resource: repo://runtime-tests/workerd/index.test.ts
  - id: openwiki-source-cfec35e61a853579c60d6d5d
    resource: repo://tsconfig.spec.json
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "codex", at: "2026-11-16T07:36:56.362Z" }
---

# Testing and performance investigation

Hono tests runtime behavior and TypeScript contracts separately. Start with the smallest relevant suite, then exercise the runtime or package boundary affected by the change.

## Setup and core checks

The [contribution guide](../../docs/CONTRIBUTING.md) uses Bun and a frozen lockfile. Toolchain pins are in [.tool-versions](../../.tool-versions); package.json also records a packageManager version. CI reads .tool-versions, so use that file when reproducing a CI environment.

```bash
bun install --frozen-lockfile
bun run build
bun run test
```

The build prepares the package exports used by tooling. `bun run test` first runs `tsc -p tsconfig.spec.json`, then `vitest --run`. A compile failure prevents the runtime suites from starting. The spec config includes source tests, enables JSX and Vitest globals, and uses noEmit. Type assertions and expected compile failures in client and type tests are part of the public API contract.

For a focused runtime iteration:

```bash
bunx vitest --run --project main src/hono.test.ts src/compose.test.ts
bunx tsc -p tsconfig.spec.json
```

The focused Vitest command alone does not replace the TypeScript check.

## Choose the right test surface

| Change | First useful verification |
| --- | --- |
| Dispatch or middleware ordering | hono.test.ts and compose.test.ts |
| Headers, cookies, response builders | context.test.ts and the affected helper tests |
| Body parsing or validation | request.test.ts, utils/body.test.ts, validator tests |
| Router lookup | The affected engine's router.test.ts wrapper plus SmartRouter tests |
| Route schema or client inference | TypeScript spec check and client/client.test.ts |
| JSX or hooks | Main JSX tests and both DOM JSX projects |
| Runtime conversion | Adapter unit tests plus its runtime project |
| Exports or declarations | Build helper tests and the complete package build |

Router wrappers import [common.case.test.ts](../../src/router/common.case.test.ts). The main project intentionally excludes case files from direct discovery. Running only a case file can miss the actual wrapper-based execution.

Vitest defines a main project for source/build tests, runtime projects discovered from runtime-tests, and two DOM projects using different JSX import sources:

```bash
bunx vitest --run --project jsx-runtime-default --project jsx-runtime-dom
```

V8 coverage is enabled in [vitest.config.ts](../../vitest.config.ts), with raw reports under coverage/raw/default and exclusions for benchmark/runtime scaffolding and compile-only type files. Bun's native coverage configuration writes under coverage/raw/bun.

## Runtime matrix

| Command | Boundary exercised |
| --- | --- |
| `bun run test:node` | Node HTTP integration through @hono/node-server |
| `bun run test:workerd` | Wrangler-managed workerd requests and WebSocket behavior |
| `bun run test:fastly` | Fastly project with its Vite compute plugin |
| `bun run test:lambda` / `test:lambda-edge` | Lambda event and streaming/CloudFront paths |
| `bun run test:bun` | Native Bun runner and JSX import source |
| `bun run test:deno` | Deno runtime tests plus both Deno JSX compiler configurations |
| `bun run test:all` | The main test script followed by Deno and Bun scripts |

Build first for runtime suites, matching CI. Native runtime tests require their runtimes and declared permissions. Some tests create servers or subprocesses: workerd tests start and stop a Wrangler worker and use a WebSocket client for network upgrades.

[CI](../../.github/workflows/ci.yml) runs formatting, linting, editorconfig checks, build, and tests in the main job, plus separate runtime jobs and a JSR dry run. Node coverage includes 20.x, 22.x, and 24.x in the checked-in matrix. The coverage job combines artifacts from main, Bun, and Deno.

## Performance investigations

Measure the cost affected by the change rather than treating a throughput number as a complete framework assessment.

| Tool | What it measures |
| --- | --- |
| [Router benchmarks](../../benchmarks/routers/README.md) | Router matching, with separate scripts including initialization; install dependencies in that benchmark directory. |
| [Type-check measures](../../perf-measures/type-check/scripts/generate-app.ts) | Generates a 200-route app; CI collects diagnostics from tsc and typescript-go. |
| [Bundle check](../../perf-measures/bundle-check/scripts/check-bundle-size.ts) | Bundles and minifies dist/index.js as ES2022 ESM and reports byte/KiB-sized metrics. |
| [HTTP benchmark](../../benchmarks/http-server/benchmark.ts) | Compares a baseline ref with the current version using Bun and bombardier. |

The [performance action](../../.github/actions/perf-measures/action.yml) defines the reproducible type and bundle measurement commands. Router benchmark scripts distinguish matching-only from initialization-inclusive runs.

The HTTP benchmark defaults in code to origin/main versus current. It fetches refs and uses Git stash/checkout while preparing non-current versions, in addition to starting benchmark servers and creating temporary output. Run it in a disposable checkout when isolating a performance experiment. CI posts results only under its configured repository permission conditions.

See [build and release](build-and-release.md) for package validation, [routing](../architecture/routing.md) for engine lifecycle constraints, and [quickstart](../quickstart.md) for the task map.
