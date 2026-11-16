---
type: workflow
title: Contributing and Linting
description: The contribution workflow for Electron and the code-quality gates it enforces, including the lint.js language checks for C++, Objective-C, JavaScript and TypeScript, Python, GN, patches, and Markdown, the docs lint chain, the pre-commit and pre-push hooks, and the semantic pull-request title rule.
tags: [electron, contributing, lint, eslint, clang-format, cpplint, gn-format, markdownlint, husky, lint-staged, pull-request]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:50:06.090Z
sources:
  - id: openwiki-source-43c41f18d49c25a86be5e9ae
    resource: repo://.husky/pre-commit
  - id: openwiki-source-9235a60f74870443a2f8379b
    resource: repo://.husky/pre-push
  - id: openwiki-source-a8361c87d8d7fbb86538d3f1
    resource: repo://.lint-roller.json
  - id: openwiki-source-a4f362e1db579768d7fdd2f5
    resource: repo://docs/development/coding-style.md
  - id: openwiki-source-7a5c134313a7fd29758df257
    resource: repo://docs/development/pull-requests.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-6c52842c07ac95748b2a27ae
    resource: repo://script/lint.js
generated: { by: "claude-code", at: "2026-11-16T18:50:06.090Z" }
---

# Contributing and Linting

<!-- openwiki: broken internal link [/openwiki/operations/ci-and-release.md] link "/openwiki/operations/ci-and-release.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/workflows/testing.md] link "/openwiki/workflows/testing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Changes to Electron go through a pull request that must pass a set of lint and format gates before it can merge. Most gates run both locally, through npm scripts and git hooks, and in CI, through the lint pipeline described in [CI, Release, and Distribution](/openwiki/operations/ci-and-release.md). This page lists each gate, the command that runs it, and the rules that apply to commits and pull requests. The test suite is covered separately in [Testing](/openwiki/workflows/testing.md).

## The single entry point

`npm run lint` runs `node ./script/lint.js` followed by `npm run lint:docs`. `script/lint.js` is the dispatcher for the code checks. It defines one linter per language, each with a set of root directories and a file test:

| Flag | Linter key | Roots | Files checked |
| --- | --- | --- | --- |
| `--cpp` (`--cc`, `--c++`, `--cxx`) | `cpp` | `shell/` | `.cc` and non-Objective-C `.h` files, through `cpplint` |
| `--objc` | `objc` | `shell/` | `.mm` and Objective-C `.h` files |
| `--javascript` (`--js`, `--es`) | `javascript` | `build/`, `default_app/`, `lib/`, `npm/`, `script/`, `spec/` | `.js`, `.ts`, `.mjs`, through ESLint |
| `--python` (`--py`) | `python` | `script/` | `.py` |
| `--gn` | `gn` | see `script/lint.js` | `.gn` and `.gni`, through `gn format --dry-run` |
| `--patches` | `patches` | `patches/` | `.patch` files, after checking that `patches/config.json` exists |
| `--markdown` (`--md`) | `markdown` | see `script/lint.js` | `.md` |

With no language flag, `script/lint.js` runs all of them. Adding `--changed` (or `-c`) limits the run to files that differ from the branch, `--fix` applies auto-fixes where the tool supports them, and `--only -- <files>` lints an explicit file list. The `cpp` linter passes a fixed filter set to `cpplint.py`, which turns off checks that the Chromium style guide disables by default and some that Electron does not follow. ESLint runs in batches through `runEslint`.

## Native and formatting gates

- `npm run lint:clang-format` runs `script/run-clang-format.py -r -c shell/` and fails with the message "Code not formatted correctly." Its formatting rules come from `.clang-format`, which follows Chromium's style.
- `npm run lint:clang-tidy` runs `script/run-clang-tidy.ts`. Its configuration is `.clang-tidy`. It is a separate command rather than part of `npm run lint`, and `docs/development/clang-tidy.md` documents how to run it.
- `npm run gn-check` runs `script/gn-check.js`, which checks the GN graph. `npm run gn-format` runs `script/run-gn-format.py` to format GN files.
- `npm run lint:cpp`, `lint:objc`, `lint:py`, `lint:gn`, and `lint:js` run one language from `script/lint.js` each.

## Documentation gates

`npm run lint:docs` runs a chain of checks over `docs/`, in this order:

1. `remark docs -qf` formats the Markdown.
2. `lint:js-in-markdown` runs `lint-roller-markdown-standard` on code blocks.
<!-- openwiki: broken internal link [/openwiki/architecture/api-docs-and-typings.md] link "/openwiki/architecture/api-docs-and-typings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
3. `create-typescript-definitions` regenerates the typings (see [API Documentation and Typings](/openwiki/architecture/api-docs-and-typings.md)).
4. `lint:ts-check-js-in-markdown` type-checks TypeScript-checked code blocks against `electron.d.ts`, excluding `breaking-changes.md`.
5. `lint:docs-fiddles` runs `standard` on `docs/fiddles/**/*.js`.
6. `lint:docs-relative-links` runs `lint-roller-markdown-links` over `docs/`, checking relative links.
7. `lint:markdown` runs the Markdown linter from `script/lint.js --md`.
8. `lint:api-history` validates the API History blocks in `docs/api/` against `docs/api-history.schema.json`.

`lint:ts-check-js-in-markdown` uses `.lint-roller.json`, which imports the public `electron` names into each example and points it at `../electron.d.ts`. That is why docs examples can use the Electron APIs without their own import lines.

`.markdownlint-cli2.jsonc` sets the rules for the Markdown linter. `.autofix.markdownlint-cli2.jsonc` is the variant used by the `docs/api/**/*.md` lint-staged rule, which also regenerates `filenames.auto.gni` through `script/gen-filenames.ts`.

## Git hooks

Husky is installed through the `prepare` script. Two hooks are present:

- `.husky/pre-commit` runs `npm run precommit`, which runs `lint-staged`.
- `.husky/pre-push` runs `npm run prepack`, which runs `check-for-leaks`.

The lint-staged rules run only on the files staged for the commit:

- `*.{js,ts}` runs `node script/lint.js --js --fix --only --`.
- `*.{js,ts,d.ts}` runs `ts-node script/gen-filenames.ts`, which keeps the generated filename lists in sync.
- `*.{cc,mm,c,h}` runs `python3 script/run-clang-format.py -r -c --fix`.
- `*.md` runs `npm run lint:docs`.
- `*.{gn,gni}` runs `npm run gn-check` and `npm run gn-format`.
- `*.py` runs `node script/lint.js --py --fix --only --`.
- `docs/api/**/*.md` regenerates `filenames.auto.gni` and fixes Markdown with `markdownlint-cli2 --fix`.

Because the rules use `--fix` and then stage the result, a commit can include changes that the hook made. Review the staged diff after a failed or auto-fixed commit.

## Style rules

`docs/development/coding-style.md` covers the rules that the tools do not enforce:

- Files end with a newline.
- Requires are grouped as built-in Node modules, then Electron modules, then local modules.
- Use `path.join()` for file paths and `os.tmpdir()` rather than `/tmp`.
- End a function with a bare `return` rather than `return null` or `return undefined`.
- C++ and Python follow Chromium's style guide.

## Pull request rules

`docs/development/pull-requests.md` describes the workflow in steps: fork, build, branch, code, commit, rebase, test, push, open the pull request, discuss, and land. Two rules in it are enforced by the project's tooling:

- The pull request title must use a semantic prefix (for example `fix:`, `feat:`, or `docs:`), because the project uses semantic commit messages to build release notes. The rule is stated in the pull request guide, and `.github/workflows/semantic.yml` is the workflow in this repository that handles semantic titles.
- Before submitting, the author is asked to run the full test suite with `npm test`. The `.github/PULL_REQUEST_TEMPLATE.md` file is the checklist that the pull request uses.

<!-- openwiki: broken internal link [/openwiki/architecture/chromium-and-upstream-patches.md] link "/openwiki/architecture/chromium-and-upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Patch changes have their own rules. Each patch's commit message must state why the patch exists, as covered in [Chromium, Node, and Upstream Patches](/openwiki/architecture/chromium-and-upstream-patches.md).

## Invariants and failure behavior

- The lint gates in CI are the authority. A local hook can be skipped, so a passing local commit does not prove a passing pipeline.
- `script/lint.js --fix` and `run-clang-format.py --fix` change files in place. Run them on a clean tree so the fixes are easy to review.
- `lint:docs` regenerates the typings, so it can fail for a reason that is in `docs/api/`, not in the Markdown file being linted.
- The `patches` lint only checks the configuration exists and walks its targets. A patch that does not apply is caught by the checkout and build steps, not by this lint.

## Related pages

<!-- openwiki: broken internal link [/openwiki/workflows/building.md] link "/openwiki/workflows/building.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Building Electron](/openwiki/workflows/building.md) describes the build that the lint gates run alongside.
<!-- openwiki: broken internal link [/openwiki/workflows/testing.md] link "/openwiki/workflows/testing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Testing](/openwiki/workflows/testing.md) describes the test suite that pull requests must pass.
<!-- openwiki: broken internal link [/openwiki/architecture/api-docs-and-typings.md] link "/openwiki/architecture/api-docs-and-typings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [API Documentation and Typings](/openwiki/architecture/api-docs-and-typings.md) explains the docs and typings checks.
<!-- openwiki: broken internal link [/openwiki/operations/ci-and-release.md] link "/openwiki/operations/ci-and-release.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CI, Release, and Distribution](/openwiki/operations/ci-and-release.md) shows where the lint gates run in CI.
