---
type: quickstart
title: fd Quickstart
description: Entry point to the fd wiki - what fd is, how the Rust codebase is laid out, how to build and test it, and which page to read for common development tasks.
tags: [quickstart, overview, onboarding, navigation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:22.809Z
sources:
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-16T16:28:22.809Z" }
---

# fd Quickstart

`fd` is a fast, user-friendly alternative to `find`, written in Rust (crate `fd-find`, binary `fd`). By default it matches a regular expression against **file names**, searches the current directory recursively in parallel, skips hidden files and anything ignored by `.gitignore`/`.fdignore`, uses smart case, and colors output with `LS_COLORS`. It can also run commands on the results (`-x`, `-X`).

## Codebase at a glance

- `src/main.rs` — entry point: parse CLI → build `Config` → `walk::scan`.
- `src/cli.rs` — all command-line options (clap derive).
- `src/walk.rs` — parallel traversal (via the `ignore` crate), filtering, result channel and printing receiver.
- `src/output.rs`, `src/fmt/`, `src/sanitize.rs`, `src/hyperlink.rs` — rendering results.
- `src/exec/` — `--exec` / `--exec-batch`.
- `src/filter/`, `src/filetypes.rs` — size, time, owner and type filters.
- `tests/tests.rs` + `tests/testenv/` — integration tests running the real binary.
- `doc/fd.1` (man page), `contrib/completion/` (zsh and `fdfind` completions), `scripts/` (release and packaging helpers).

The complete module map is in [Architecture Overview](architecture/overview.md).

## Build and test

```bash
cargo build                    # debug build → target/debug/fd
cargo build --release          # LTO, stripped → target/release/fd
cargo test --locked            # unit + integration tests
cargo fmt -- --check           # formatting gate used by CI
cargo clippy --all-targets --all-features -- -Dwarnings
make && sudo make install      # release build + completions + man page under /usr/local
```

Optional features: `completions` (default; enables `fd --gen-completions <shell>`) and `use-jemalloc` / `base` (jemalloc allocator on supported platforms). The minimum supported Rust version is the `rust-version` in `Cargo.toml`.

Contribution rules (`CONTRIBUTING.md`): open an issue before a PR, add a `CHANGELOG.md` entry under *Upcoming release* for behavior changes, and disclose AI-tool assistance.

## Where to go for a task

| I want to… | Read |
|------------|------|
| Understand the overall flow and modules | [Architecture Overview](architecture/overview.md) |
| Add or change a command-line flag, change pattern/case/color defaults | [CLI Parsing and Config Construction](architecture/cli-to-config.md) |
| Understand threading, buffering/sorting, `--max-results`, `--quiet`, Ctrl-C | [Parallel Walk Pipeline](architecture/parallel-walk-pipeline.md) |
| Change which files are skipped (ignore files, hidden, `--exclude`) or add a filter | [Filtering and Ignore Rules](concepts/filtering-and-ignore-rules.md) |
| Change how results are printed, `--format`, colors, hyperlinks, escaping | [Output Rendering](systems/output-rendering.md) |
| Work on `--exec`, `--exec-batch`, placeholders or `--list-details` | [Command Execution](systems/command-execution.md) |
| Understand exit statuses and error messages | [Exit Codes and Error Handling](concepts/exit-codes-and-errors.md) |
| Write or debug a test | [Test Suite](testing/test-suite.md) |
| Build packages, update completions/man page, cut a release | [Build, Release and Packaging](operations/build-release-packaging.md) |

## Things that commonly surprise contributors

- Patterns match only the file name; a pattern containing `/` is rejected unless `--full-path` is used.
- Output is sorted only when the search finishes within ~100 ms and yields at most 1000 results; otherwise it streams in walk order.
- Searches without explicit paths print `a.foo`, but commands receive `./a.foo` (the `./` is kept for `--exec`, `--exec-batch` and `--print0`).
- A plain search with zero results exits 0; only `--quiet` exits 1 on no match.
- The jemalloc platform list exists twice (`Cargo.toml` and `src/main.rs`) and must be kept in sync.
- New flags usually need updates to `src/cli.rs`, `doc/fd.1`, `contrib/completion/_fd` (hand-written zsh completion), the README help block (`scripts/update-help.awk`) and `CHANGELOG.md`.
