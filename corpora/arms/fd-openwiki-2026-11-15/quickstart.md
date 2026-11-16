---
type: quickstart
title: fd Quickstart
description: Orientation for the fd-find repository — a fast, user-friendly Rust alternative to find — covering build/test commands, the source module map, contribution conventions, and where to look for each kind of task.
tags: [quickstart, overview, build, testing, module-map]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T06:14:47.054Z
sources:
  - id: openwiki-source-dddf858b6f600d9339e1373d
    resource: repo://.github/workflows/CICD.yml
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
generated: { by: "claude-code", at: "2026-11-15T06:14:47.054Z" }
---

# fd Quickstart

`fd` (crate name `fd-find`, binary `fd`) is a command-line tool for finding
filesystem entries. It defaults to smart-case regex matching on file names,
skips hidden and `.gitignore`d entries, walks directories in parallel, colors
output from `LS_COLORS`, and can run commands on results. It is a single
binary crate (Rust edition 2024, MSRV in `Cargo.toml` `rust-version`) built
from `src/main.rs`; there is no library target.

## Build, test, install

```bash
cargo build                 # debug build
cargo test                  # unit tests + integration tests in tests/
cargo install --path .      # install locally
make                        # release build (target/release/fd, --locked)
make install                # binary, completions and man page under /usr/local
```

CI (`.github/workflows/CICD.yml`) runs `cargo fmt -- --check`,
`cargo clippy --all-targets --all-features -- -Dwarnings`, an MSRV build/test,
and a cross-platform release build and test matrix (using `cross` for some
targets), then packages completions and Debian archives.

Cargo features:

- `completions` (default) — enables the hidden `--gen-completions <shell>`
  flag via `clap_complete`.
- `use-jemalloc` / `base` — use jemalloc as the global allocator on supported
  targets. The platform list is duplicated in `Cargo.toml` and `src/main.rs`
  and must be kept in sync.

## Module map

| Area | Files | Role |
| --- | --- | --- |
| Entry & setup | `src/main.rs` | `run()`: parse options, validate/convert patterns, build `Config`, call `walk::scan` |
| CLI | `src/cli.rs` | clap `Opts` definition, derived accessors, hand-written `Exec` arg parsing |
| Config | `src/config.rs` | Immutable, thread-shared search configuration |
| Walk | `src/walk.rs` | Parallel `ignore` walker, per-entry filters, batching channel, buffering receiver, Ctrl-C |
| Filters | `src/filter/`, `src/filetypes.rs` | Size, modification time, owner (Unix), file-type filters |
| Entries | `src/dir_entry.rs`, `src/filesystem.rs` | `DirEntry` (incl. broken symlinks), path helpers |
| Output | `src/output.rs`, `src/sanitize.rs`, `src/hyperlink.rs` | Printing, color, terminal sanitization, OSC 8 links |
| Exec | `src/exec/` | `--exec`, `--exec-batch`, `--list-details` |
| Templates | `src/fmt/` | Placeholder template parsing for exec and `--format` |
| Errors / exit | `src/error.rs`, `src/exit_codes.rs` | `[fd error]:` messages, exit code mapping |
| Docs & assets | `doc/fd.1`, `contrib/completion/`, `scripts/` | Man page, zsh/bash/fish completions, release scripts |

## Testing

Integration tests live in `tests/tests.rs` and use the `TestEnv` harness in
`tests/testenv/mod.rs`. `TestEnv::new(dirs, files)` creates a temporary
directory tree, and helpers such as `assert_output`, `assert_output_raw`,
`assert_output_subdirectory` and `assert_failure_with_error` run the compiled
`fd` binary against it and compare normalized output. Extra helpers set up a
global ignore file or broken symlinks. Unit tests sit next to the code
(`#[cfg(test)]` modules in `walk.rs`, `exec/mod.rs`, `fmt/`, `filter/`, etc.).

## Contribution conventions

From `CONTRIBUTING.md`: open an issue before a pull request; behavior changes
need an entry in the "Upcoming release" section of `CHANGELOG.md`; code must
build and pass tests; AI tool usage must be disclosed and maintainer
communication must be human-written. Releases follow
`doc/release-checklist.md` (`scripts/version-bump.sh`, and
`scripts/update-help.awk` to refresh the README's `fd -h` block).

## Where to go next

| Task | Page |
| --- | --- |
| Change matching, ignore rules, filters, output ordering, color or exit codes | [Search Pipeline](architecture/search-pipeline.md) |
| Add a CLI flag that affects searching | [Search Pipeline](architecture/search-pipeline.md) — `Opts` → `construct_config` → walker closure |
| Change `--exec`, `--exec-batch`, `--list-details`, placeholders or `--format` | [Command Execution](architecture/command-execution.md) |
