---
type: operations
title: CI, Automation, and OpenWiki Maintenance
description: What each GitHub Actions workflow in .github/workflows does for Hono (main CI matrix, autofix, pkg.pr.new previews, npm and JSR release, stale-issue cleanup, and the scheduled OpenWiki update that opens a pull request), and which files are generated versus hand-maintained.
tags: [hono, ci, github-actions, release, autofix, openwiki, automation, coverage]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-5a6816d1cbbb8cce73354461
    resource: repo://.github/workflows/autofix.yml
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# CI, Automation, and OpenWiki Maintenance

<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/build-and-release/build-pipeline.md] link "/openwiki/build-and-release/build-pipeline.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Hono's automation lives in `.github/workflows/`. There are six workflows: `ci.yml` (tests, lint, and runtime matrix), `autofix.yml` (formatting and lint fixes on pull requests), `cr.yml` (pkg.pr.new preview packages), `release.yml` (npm and JSR publishing on tags), `no-response.yml` (stale issue cleanup), and `openwiki-update.yml` (scheduled regeneration of this wiki). All actions are pinned to full commit SHAs, and the Bun toolchain is installed with `oven-sh/setup-bun` and `bun install --frozen-lockfile` in every job that builds the project. The commands run by each job are the same `package.json` scripts described in [Test Strategy and Runtime Test Matrix](/openwiki/testing/test-strategy.md) and [Build, Exports, and Release Pipeline](/openwiki/build-and-release/build-pipeline.md).

## ci.yml

Triggers on pushes to `main` and `next`, and on pull requests to any branch. Changes limited to `docs/**`, `.vscode/**`, `README.md`, `.gitignore`, or `LICENSE` are ignored through `paths-ignore`. It has four jobs:

- **`main`**: installs Node and Bun, then runs, in order, `bun run format` (Prettier check), `bun run lint` (ESLint), `bun run editorconfig-checker`, `bun run build`, and `bun run test` (TypeScript check and Vitest). It uploads `coverage/` as the `coverage-main` artifact.
- **`coverage`**: downloads the coverage artifacts and sends them to Codecov.
- **`jsr-dry-run`**: runs `bunx jsr publish --dry-run` to confirm that the JSR package is valid before a release.
- **`deno`**: runs the Deno test suites (`runtime-tests/deno`, `runtime-tests/deno-jsx` with its precompile and react-jsx configurations), then builds an lcov report from Deno's coverage output.

Other runtimes (Bun, workerd, Node, Fastly, Lambda, Lambda@Edge) run through the Vitest projects defined in `vitest.config.ts` and their own `runtime-tests/*/vitest.config.ts`; see the test strategy page.

## autofix.yml

Runs on pull requests and on pushes to `main`. Pull requests that are still drafts are skipped. It installs dependencies, runs `bun run format:fix` and `bun run lint:fix`, and then calls `autofix-ci/action`, which commits any changes back to the pull request branch so that formatting and lint problems are fixed rather than reported.

## cr.yml

Runs on pushes to `main` and on pull requests. The `publish` job runs only for the `honojs/hono` repository, on `main` or on pull requests labelled `cr-tracked`. It builds the package and runs `bun pkg-pr-new publish --compact`, which publishes installable preview builds for review without a release.

## release.yml

Triggered by pushes that create release tags. Two jobs publish the same build to two registries:

- **`publish-to-npm`** installs npm 11.17.0, runs `bun run build`, and runs `npm stage publish --provenance --access public`, so the npm package carries provenance metadata.
- **`publish-to-jsr`** installs Deno and runs `deno run -A jsr:@david/publish-on-tag@0.1.4`, which publishes the `jsr.json` package for the tag.

The build step is the one that validates the export maps between `package.json` and `jsr.json`, so a mismatch stops the release before publishing.

## no-response.yml

A daily scheduled job (`0 0 * * *`) that uses `actions/stale` to mark issues labelled `not bug` as stale after seven days and close them two days later. It removes the stale label when an issue is updated, and it processes at most 30 issues per run.

## openwiki-update.yml

This workflow keeps the generated `openwiki/` wiki up to date. It runs on manual dispatch and every day at 08:00 UTC.

1. It checks out the repository with full history (`fetch-depth: 0`), so `openwiki code --update` can compare `HEAD` with the commit it last documented. A shallow clone would hide that commit and produce an empty change summary.
2. It installs `openwiki@0.9.0` with optional `mermaid` and `jsdom` (used to validate Mermaid diagrams) on Node 22.
3. It runs `openwiki code --update --print` with the OpenAI provider and a configured model, with `continue-on-error: true`, so a failed run still produces a result. LangSmith tracing variables are passed through as environment variables.
4. It deletes `openwiki/.run.json`, which is transient run state and must not be committed.
5. It lists the paths to commit: `openwiki`, `AGENTS.md`, and `.github/workflows/openwiki-update.yml`, plus `CLAUDE.md` when it exists.
6. It opens or updates a pull request from the `openwiki/update` branch with the title `docs: update OpenWiki`. The pull request body records the OpenWiki result. If the run failed, the pull request keeps only the pages completed before the failure, and merging it becomes the baseline for the next run.
7. It emits a notice with the pull request URL, and fails the workflow at the end if the OpenWiki step failed.

## Generated and hand-maintained files

- **Generated by OpenWiki:** everything under `openwiki/`, including the page files, `openwiki/.claims`, indexes, logs, provenance, and `.last-update.json`. These should be regenerated by the update workflow rather than edited by hand.
- **Partly managed:** `AGENTS.md` contains an OpenWiki-managed block between `<!-- OPENWIKI:START -->` and `<!-- OPENWIKI:END -->` markers, which is the part the workflow stages with the wiki. Edits to that block are overwritten by the next run, and the rest of the file is repository guidance.
- **Hand-written source:** everything under `src/`, `build/`, `runtime-tests/`, `benchmarks/`, `perf-measures/`, and `docs/`. The wiki describes these, so when behaviour changes, update the source and let the next OpenWiki run regenerate the affected pages.

## Lint and format configuration

`eslint.config.mjs` extends the TypeScript ESLint rules and turns off several rules that need type information, such as `no-floating-promises` and `no-base-to-string`. `.prettierrc` and `.editorconfig` define formatting; `editorconfig-checker` enforces `.editorconfig` in CI.

## Related pages

<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Test Strategy and Runtime Test Matrix](/openwiki/testing/test-strategy.md)
<!-- openwiki: broken internal link [/openwiki/build-and-release/build-pipeline.md] link "/openwiki/build-and-release/build-pipeline.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Build, Exports, and Release Pipeline](/openwiki/build-and-release/build-pipeline.md)
<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Quickstart](/openwiki/quickstart.md)
