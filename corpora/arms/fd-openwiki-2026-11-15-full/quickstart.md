---
type: quickstart
title: fd Wiki Quickstart
description: Entry point to the fd wiki. Explains what fd is, gives a one-screen tour of the Rust codebase, shows how to build, run and test it, and maps common tasks to the wiki pages that explain them.
tags: [quickstart, overview, navigation, onboarding]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:44:06.029Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
generated: { by: "claude-code", at: "2026-11-15T08:44:06.029Z" }
---

# fd Wiki Quickstart

**fd** (crate `fd-find`, binary `fd`) is a fast, user-friendly alternative to `find(1)`, written in Rust. By default it:

- matches a **regex** (or a glob with `-g`) against **file names**,
- uses **smart case**,
- skips **hidden** files and anything excluded by **`.gitignore` / `.ignore` / `.fdignore`**,
- walks directories **in parallel**,
- prints colorized results. It can also run commands on them with `-x` / `-X`.

## Codebase in one screen

```
src/main.rs        startup: parse → validate → build Config → walk::scan
src/cli.rs         clap Opts (all flags), search-path resolution, derived defaults
src/config.rs      immutable runtime Config shared by all threads
src/walk.rs        ignore::WalkParallel + per-entry filters + batched channel + receiver
src/dir_entry.rs   entry wrapper with cached metadata/style, ./-stripping
src/filter/*       size / time / owner filters      src/filetypes.rs  --type
src/regex_helper.rs smart-case + leading-dot detection on regex HIR
src/exec/*         --exec / --exec-batch            src/fmt/*  {} {/} {//} {.} {/.} templates
src/output.rs      printing (format / colors / raw bytes), sanitize.rs, hyperlink.rs
src/exit_codes.rs  exit status model              src/error.rs  [fd error] messages
tests/             integration tests driving the real binary (TestEnv harness)
```

The control flow is linear: `main` → `run` → `construct_config` → `walk::scan`. The scan then either prints results or runs commands. Start with [Architecture Overview](architecture/overview.md).

## Build, run, test

```bash
cargo build                       # debug build → target/debug/fd
cargo run -- -e rs walk src       # run fd from source
cargo test                        # unit + integration tests
cargo fmt -- --check && cargo clippy --all-targets --all-features -- -Dwarnings   # what CI enforces
cargo build --release --features base   # optional: jemalloc allocator (Linux)
make completions                  # shell completions into autocomplete/
```

- MSRV is Rust 1.90 (edition 2024).
- Behavior changes need an entry under "Upcoming release" in `CHANGELOG.md` (`CONTRIBUTING.md`).

## Task routing

| If you want to… | Read |
| --- | --- |
| Understand the overall process and module responsibilities | [Architecture Overview](architecture/overview.md) |
| Change threading, buffering/sorting, `--max-results`, `--quiet`, or Ctrl-C behavior | [Parallel Search Pipeline](architecture/search-pipeline.md) |
| Change how patterns match (regex/glob/fixed/exact, `--and`, smart case, `--full-path`) | [Pattern Matching](concepts/pattern-matching.md) |
| Change what gets skipped (hidden, gitignore, `.fdignore`, global ignore, `--exclude`, depth, prune, symlinks) | [Ignore Rules and Traversal Controls](concepts/ignore-rules-and-traversal.md) |
| Add or modify a metadata filter (`--type`, `-e`, `--size`, `--changed-*`, `--owner`) | [Entry Filters](concepts/entry-filters.md) |
| Work on `-x`, `-X`, `--batch-size`, placeholders, or `-l` | [Command Execution](workflows/command-execution.md) |
| Change printed output: colors, `--format`, hyperlinks, `--print0`, path separators, `./` stripping, escape sanitization | [Output Formatting, Colors and Terminal Safety](concepts/output-formatting.md) |
| Add a CLI flag and wire it into `Config` | [CLI Options and Config Mapping](reference/cli-and-configuration.md) |
| Understand exit statuses, error messages, SIGINT | [Exit Codes, Errors and Signals](operations/exit-codes-and-errors.md) |
| Write or debug tests | [Testing Strategy](testing/integration-tests.md) |
| Build features, CI, packaging, cutting a release | [Build, Release and Packaging](operations/build-release-and-packaging.md) |

## Adding a new option: typical checklist

1. Add the field to `Opts` in `src/cli.rs`, with help or long help, conflicts, and a hidden override flag if it is a boolean.
2. Add the runtime field to `Config` (`src/config.rs`) and fill it in `construct_config` (`src/main.rs`).
3. Use it in the right place: `build_walker` for traversal and ignore options, the `spawn_senders` closure for per-entry filtering, `output.rs` for printing, `exec/` for commands.
4. Add integration tests in `tests/tests.rs` with `TestEnv`. Update `doc/fd.1`, the README options block, and `CHANGELOG.md`.
