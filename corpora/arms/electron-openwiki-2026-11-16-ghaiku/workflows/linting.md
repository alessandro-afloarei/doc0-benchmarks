---
type: workflow
title: Linting and Formatting
description: The lint entry points in Electron. script/lint.js dispatches per language to ESLint, clang-format, cpplint, pylint-style checks, gn format, markdownlint, and the patch validator. The npm lint scripts, the docs-specific checks (remark, lint-roller, fiddles, ts-check, API history), and the git hooks and lint-staged rules that run them on commit all live here.
tags: [lint, formatting, eslint, clang-format, clang-tidy, cpplint, gn-format, markdownlint, lint-staged, husky]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-19cfefcece920ae0434e1211
    resource: repo://.clang-tidy
  - id: openwiki-source-43c41f18d49c25a86be5e9ae
    resource: repo://.husky/pre-commit
  - id: openwiki-source-4e55da5497cd8e3548b6e6eb
    resource: repo://.markdownlint-cli2.jsonc
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-6c52842c07ac95748b2a27ae
    resource: repo://script/lint.js
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# Linting and Formatting

Electron's lint rules are spread across one dispatcher script (`script/lint.js`), a set of npm scripts in `package.json`, and git hooks that run the lint-staged rules. Each language has a linter, and the dispatcher picks files by directory root and extension. Documentation has its own, deeper set of checks, which validate code samples, links, and API-history blocks.

## Entry points

- `node script/lint.js` runs every linter. Flags select languages: `--cpp` (aliases `--c++`, `--cc`, `--cxx`), `--objc`, `--javascript` (`--js`, `--es`), `--python` (`--py`), `--gn`, `--patches`, and `--markdown` (`--md`). `--changed` (`-c`) limits the run to staged files, `--fix` applies fixes where a tool supports it, `--verbose` (`-v`) prints more output, and `--only -- <files>` restricts the run to named files.
- `npm run lint` runs `script/lint.js` followed by `npm run lint:docs`.
- Single-language scripts: `lint:js`, `lint:cpp`, `lint:objc`, `lint:py`, `lint:gn`, `lint:markdown` (through `lint.js`), and `lint:clang-format` and `lint:clang-tidy` for the C++ formatter and static analysis.

Unknown flags print the usage message and exit with status 0 (the help path).

## Language linters in script/lint.js

Each linter is an entry in the `LINTERS` array, with a `key`, the `roots` it applies to, and a `test` that selects files:

| Key | Roots | Files | Tools |
| --- | --- | --- | --- |
| `cpp` | `shell` | `.cc`, and `.h` files that are not Objective-C | `script/run-clang-format.py` (with `--fix` optional), then `cpplint` with the project's `CPPLINT_FILTERS`. Files are checked in chunks. |
| `objc` | `shell` | `.mm`, and Objective-C `.h` files | `run-clang-format.py -r`, then `cpplint` with the extension list `mm,h` and the same filters plus `-readability/braces`. |
| `python` | `script` | `.py` | A Python linter run with `--rcfile`. |
| `javascript` | `build`, `default_app`, `lib`, `npm`, `script`, `spec` (ignoring `spec/node_modules`) | `.js`, `.ts`, `.mjs` | ESLint with the `.js` and `.ts` extensions, `--fix` supported. |
| `gn` | the repository root | `.gn`, `.gni` | `gn format`, with `--dry-run` unless `--fix` is set. |
| `md` | the repository root (ignoring `.git`, `node_modules`, and `spec/node_modules`) | `.md` | `markdownlint-cli2` in chunks, then the docs-specific checks described below. |
| `patches` | `patches` | `.patch` | Structural checks on the patch config (see below). |

`.eslintrc.json` and the `.eslintrc.json` files in `lib/*/` and `docs/` set the JavaScript rules. `.clang-format` is based on the Chromium style. `.clang-tidy` turns off the `modernize-use-nullptr` check and inherits the parent configuration. `npm run lint:clang-tidy` runs `script/run-clang-tidy.ts` for static analysis.

### Patch validation

The `patches` linter enforces the rules in `patches/config.json`:

- Every target's `patch_dir` must exist, and must contain a `.patches` file.
- No entry may be listed twice in `.patches`, and every listed file must exist on disk.
- Each `.patch` file must have a description in its commit message. The validator reads the text between the `Subject:` header and the `diff` line, and it reports a missing description as an error.
- Added lines in a patch may not end in whitespace.

These checks are the reason that a patch without a stated purpose fails lint (see [Chromium, Node, and V8 Patch Stack](../integrations/chromium-node-v8-patches.md)).

## Documentation checks

`npm run lint:docs` runs these in order:

1. `remark docs -qf` (Markdown formatting, using `.remarkrc`, which requires fenced code blocks and a language flag on code fences).
2. `lint:js-in-markdown`, which runs `lint-roller-markdown-standard` on code blocks in the Markdown.
3. `create-typescript-definitions`, so the next check uses fresh definitions.
4. `lint:ts-check-js-in-markdown`, which type-checks code blocks against `electron.d.ts`, using the imports defined in `.lint-roller.json`. `breaking-changes.md` is excluded.
5. `lint:docs-fiddles`, which runs `standard` on `docs/fiddles/**/*.js`.
6. `lint:docs-relative-links`, which checks relative links under `docs/`.
7. `lint:markdown`, which runs `script/lint.js --md`.
8. `lint:api-history`, which checks API-history blocks against `docs/api-history.schema.json` (see [API Documentation, Typings, and API History](api-docs-and-typings.md)).

`.markdownlint-cli2.jsonc` extends the `@electron/lint-roller` Markdown configuration. It sets rules such as descriptive link text off, underscore emphasis (`MD049`), and a list of allowed inline HTML elements. `.autofix.markdownlint-cli2.jsonc` is the variant used by the autofix hook.

## Git hooks and lint-staged

- `.husky/pre-commit` runs `npm run precommit`, which runs `lint-staged`.
- `.husky/pre-push` runs `npm run prepack`, which runs `check-for-leaks`.

The `lint-staged` rules in `package.json` run the fixing variant on each staged file type:

- `*.{js,ts}`: `node script/lint.js --js --fix --only --`, plus `ts-node script/gen-filenames.ts` for `*.{js,ts,d.ts}`.
- `*.{cc,mm,c,h}`: `run-clang-format.py -r -c --fix`.
- `*.md`: `npm run lint:docs`.
- `*.{gn,gni}`: `npm run gn-check` and `npm run gn-format`.
- `*.py`: `node script/lint.js --py --fix --only --`.
- `docs/api/**/*.md`: regenerate `filenames.auto.gni` with `gen-filenames.ts`, run `markdownlint-cli2 --fix` with the autofix config, and stage the regenerated file.

Consequence: committing a Markdown change runs the full docs lint, including the TypeScript definition generation, so a docs commit can take noticeably longer than a code commit.

## Continuous integration

The lint pipeline (`.github/workflows/pipeline-electron-lint.yml`) downloads GN and clang-format binaries that match the Chromium revision in `DEPS` and then runs the lint script. Problem matchers under `.github/problem-matchers/` (`eslint-stylish.json`, `clang.json`, and `patch-conflict.json`) turn the output into annotations. See [CI Pipelines and Release Automation](ci-pipelines.md).

## Failure behavior

- `script/lint.js` exits non-zero when a linter reports an error. Chunked runs exit on the first failing chunk.
- The `patches` linter exits non-zero for a missing directory, a missing `.patches` file, a duplicated entry, or a missing patch file.
- `lint:docs` stops at the first failing step, so later checks such as `lint:api-history` may not run until earlier ones pass.

## Related pages

- [API Documentation, Typings, and API History](api-docs-and-typings.md)
- [Building Electron with GN and Ninja](build-and-gn.md)
- [Test Suite (spec/) and Test Runners](testing-spec-suite.md)
- [CI Pipelines and Release Automation](ci-pipelines.md)
