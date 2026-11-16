---
type: quickstart
title: fd Quickstart and Task Routing
description: Entry point for the fd wiki - what the project is, how to build and test it, the repository layout, and a map from common tasks to the page that explains them.
tags: [quickstart, overview, navigation, rust, fd]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:38:21.850Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T17:38:21.850Z" }
---

# fd Quickstart

`fd` is a fast, user-friendly alternative to `find`, written in Rust (crate `fd-find`, binary `fd`, edition 2024, MSRV 1.90). It searches the current directory (or given paths) recursively for entries whose **name** matches a regex or glob, with defaults that skip hidden files and anything ignored by `.gitignore`/`.fdignore`, smart-case matching, colored output, and parallel traversal. It can also run commands on results (`-x`, `-X`).

## Build, run, test

```bash
cargo build --release          # binary at target/release/fd
cargo run -- PATTERN [PATH]    # run from source
cargo test                     # unit + integration tests
make && make install           # release build + completions + man page
```

See [[operations/build-release]] for features, CI and release steps, and [[operations/testing]] for how the test harness works.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/main.rs` | entry point: pattern compilation, `Config` construction |
| `src/cli.rs`, `src/config.rs` | clap `Opts` and the immutable `Config` |
| `src/walk.rs` | parallel traversal, filtering, receiver/printing pipeline |
| `src/filter/`, `src/filetypes.rs` | size, time, owner and type filters |
| `src/exec/`, `src/fmt/` | `--exec`/`--exec-batch` and placeholder templates |
| `src/output.rs`, `src/sanitize.rs`, `src/hyperlink.rs`, `src/error.rs` | rendering, terminal safety |
| `tests/` | `tests.rs` integration tests and `testenv/` harness |
| `contrib/completion/`, `doc/fd.1` | shell completions and man page |
| `scripts/`, `Makefile`, `.github/workflows/` | packaging, release and CI |

## Task routing

| If you want to... | Read |
| --- | --- |
| understand the whole flow of one search | [[architecture/overview]] |
| add or change a command-line flag, or see how flags become behavior | [[architecture/cli-and-config]] |
| change how patterns, glob, `--and`, `--exact` or smart case work | [[architecture/pattern-matching]] |
| change traversal, threading, buffering, sorting, Ctrl-C or `--max-results` | [[architecture/parallel-walk-pipeline]] |
| change hidden/ignore-file/`--exclude`/`--prune`/depth behavior | [[concepts/ignore-rules-and-hidden-files]] |
| add or modify a size/time/owner/type/extension filter | [[concepts/entry-filters]] |
| change `-x`/`-X`/`--list-details` or the `{}` placeholders | [[architecture/command-execution]] |
| change colors, `--format`, hyperlinks, path separators or escape handling | [[architecture/output-and-terminal-safety]] |
| write or debug a test | [[operations/testing]] |
| cut a release, adjust CI, packaging or Cargo features | [[operations/build-release]] |

## Key facts worth knowing up front

- Matching is done on raw bytes with `regex::bytes`; only the file name is matched unless `--full-path` is used.
- Output is sorted only when the search finishes within about 100 ms (or 1000 results); otherwise it streams in walk order.
- Exit status: 0 on success, 1 on error (or `--quiet` with no match), 130 on Ctrl-C.
- File names are sanitized before being written to a terminal, but passed through raw on pipes.
- `CONTRIBUTING.md` asks contributors to open an issue before large PRs, add a changelog entry, and disclose any AI assistance.
