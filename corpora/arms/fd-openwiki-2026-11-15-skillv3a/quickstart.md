---
type: guide
title: fd Wiki Quickstart
description: Orientation for the fd repository — what fd is, how the Rust source is organized, how to build and test it, contribution expectations, and a task-routing map pointing to the right wiki page for each kind of change.
tags: [quickstart, overview, onboarding, navigation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:39:25.366Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-15T17:39:25.366Z" }
---

# fd Wiki Quickstart

**fd** (crate `fd-find`, binary `fd`) is a fast, user-friendly alternative to `find`. It searches file names with regular expressions (or globs, fixed strings, exact names), uses parallel directory traversal, respects `.gitignore`/`.fdignore` and hidden-file conventions by default, applies smart case, colorizes output with `LS_COLORS`, and can run commands on results (`--exec`, `--exec-batch`).

It is a single Rust binary (edition 2024, MSRV declared in `Cargo.toml`) with no library target. The heavy lifting for traversal and ignore rules is done by the `ignore` crate (shared with ripgrep); argument parsing uses `clap`.

## Repository layout

| Path | Contents |
|------|----------|
| `src/main.rs` | entry point: `run()`, pattern → regex conversion, `construct_config`, `--list-details` |
| `src/cli.rs` | clap `Opts` (all command-line options and help text) |
| `src/config.rs` | resolved, immutable `Config` |
| `src/walk.rs` | parallel walker, per-entry filtering, result receiver |
| `src/dir_entry.rs` | `DirEntry` with cached metadata/style |
| `src/filter/`, `src/filetypes.rs` | size, time, owner and type filters |
| `src/output.rs`, `src/fmt/`, `src/hyperlink.rs`, `src/sanitize.rs` | printing, `--format` templates, hyperlinks, escape sanitization |
| `src/exec/` | `--exec` / `--exec-batch` |
| `src/exit_codes.rs`, `src/error.rs` | exit codes and error printing |
| `src/regex_helper.rs`, `src/filesystem.rs` | regex AST helpers, platform filesystem helpers |
| `tests/tests.rs`, `tests/testenv/` | integration tests and harness |
| `doc/fd.1` | man page; `doc/release-checklist.md` release steps |
| `contrib/completion/` | hand-written zsh and `fdfind` completions |
| `scripts/` | Debian packaging, version bump, README help updater |
| `.github/workflows/CICD.yml` | CI and release pipeline |

## Build and test

```sh
cargo build                      # debug build → target/debug/fd
cargo run -- <pattern> [path]    # try it
cargo test                       # unit + integration tests
cargo fmt -- --check && cargo clippy --all-targets --all-features -- -Dwarnings
make && sudo make install        # release build + completions + man page
```

Optional features: `use-jemalloc` (jemalloc allocator on supported targets); `completions` is on by default (`fd --gen-completions <shell>`).

## How a search runs (one paragraph)

`run()` parses `Opts`, converts each pattern into a regex string, resolves everything into `Config`, compiles byte regexes, and calls `walk::scan`. The `ignore` crate walks the search roots in parallel, skipping hidden and ignored entries; per-entry callbacks match the name (or full path), apply extension/type/owner/size/time filters, and send matches in batches over a bounded channel. A single receiver prints them (sorting them if the search finishes within ~100 ms) or hands them to command-execution threads. Details: [Architecture Overview](architecture/overview.md).

## Where to go for a task

| I want to… | Read |
|------------|------|
| understand the overall pipeline and module map | [Architecture Overview](architecture/overview.md) |
| add or change a command-line option | [CLI Parsing and Configuration](architecture/cli-and-configuration.md) |
| change traversal, concurrency, sorting, `--max-results`/`--quiet`, Ctrl-C | [Parallel Walk and Result Receiver](architecture/parallel-walk-and-receiver.md) |
| change regex/glob/exact matching, smart case, `--full-path`, `--and` | [Pattern Matching](concepts/pattern-matching.md) |
| change hidden/ignore-file behavior, `--exclude`, `-u`, global ignore | [Ignore Rules and Hidden Files](concepts/ignore-rules-and-hidden-files.md) |
| change `--type`, `--size`, `--changed-*`, `--owner`, depth, `--prune` | [Entry Filters](concepts/entry-filters.md) |
| change printing, colors, `--format`, `--print0`, hyperlinks, sanitization | [Output, Colors, Formatting, and Hyperlinks](features/output-formatting.md) |
| change `--exec`, `--exec-batch`, `--list-details` | [Command Execution](features/command-execution.md) |
| understand exit statuses, error messages, broken pipes, SIGINT | [Exit Codes, Errors, and Interrupts](operations/exit-codes-and-errors.md) |
| write or debug tests | [Testing](testing/integration-tests.md) |
| build, package, release, CI | [Build, Release, and Packaging](operations/build-release-and-packaging.md) |

## Contribution notes (from `CONTRIBUTING.md`)

- Open an issue before a pull request to discuss the change.
- Code must compile and pass tests; behavior changes need an entry in the "Upcoming release" section of `CHANGELOG.md`.
- When adding options, also update the README help block (`scripts/update-help.awk`), `doc/fd.1`, and the zsh completion in `contrib/completion/_fd` as appropriate.
- AI-assisted contributions must be disclosed and understood by the author; communication with maintainers should be written by humans.
