---
type: architecture
title: Architecture Overview
description: End-to-end lifecycle of an fd invocation from argument parsing through configuration, parallel directory traversal and result printing or command execution, plus a map of every source module and its responsibility.
tags: [architecture, overview, lifecycle, modules, rust]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:22.809Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-2a737474d86fc75cc9d9694f
    resource: repo://src/config.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T16:28:22.809Z" }
---

# Architecture Overview

`fd` (crate `fd-find`, binary `fd`) is a single-binary Rust CLI. There is no library crate; everything lives in `src/` as private modules declared in `src/main.rs`. The heavy lifting of directory traversal and ignore-file handling is delegated to the [`ignore`](https://docs.rs/ignore) crate (the same walker used by ripgrep); fd adds pattern matching, filters, output formatting and command execution on top.

## Lifecycle of one invocation

```text
main()
 └─ run() ──────────────────────────────── src/main.rs
     ├─ Opts::parse()                      src/cli.rs   (clap derive + custom Exec group)
     ├─ set_working_dir / search_paths
     ├─ pattern validation + build_pattern_regex (glob/exact/fixed/regex → regex source)
     ├─ construct_config(opts) → Config    src/config.rs
     ├─ build_regex → Vec<regex::bytes::Regex>
     └─ walk::scan(paths, regexps, config) src/walk.rs
          ├─ build WalkParallel (ignore crate) with ignore rules + overrides
          ├─ receiver thread ── either ReceiverBuffer → output::print_entry  (src/output.rs)
          │                     or exec::job / exec::batch                    (src/exec/)
          └─ sender threads (walker callbacks) → filter chain → BatchSender → bounded channel
main() maps Result<ExitCode> to the process exit status (src/exit_codes.rs)
```

1. **Parse and resolve** — `Opts` captures raw flags; `construct_config` resolves them into a `Config` (smart case, color, ignore switches, limits, filters, output command). Details: [CLI Parsing and Config Construction](cli-to-config.md).
2. **Traverse and filter** — `walk::scan` creates a `WorkerState` holding the patterns, config and shared quit/interrupt flags, builds an `ignore::WalkParallel`, and runs sender callbacks on the walker's thread pool. Each callback applies the filter chain and sends matching entries over a bounded crossbeam channel. Details: [Parallel Walk Pipeline](parallel-walk-pipeline.md) and [Filtering and Ignore Rules](../concepts/filtering-and-ignore-rules.md).
3. **Consume** — one receiver thread either prints results (buffering and sorting them if the search finishes within ~100 ms, otherwise streaming) or hands them to command execution. Details: [Output Rendering](../systems/output-rendering.md) and [Command Execution](../systems/command-execution.md).
4. **Exit** — the receiver's `ExitCode` (or `KilledBySigint` if Ctrl-C was seen) is returned; `main` calls `ExitCode::exit()`. Any `anyhow` error from setup is printed as `[fd error]: ...` and exits with code 1. Details: [Exit Codes and Error Handling](../concepts/exit-codes-and-errors.md).

## Module map

| Module | Responsibility |
|--------|----------------|
| `main.rs` | Entry point, global allocator selection (jemalloc), default `LS_COLORS`, pattern → regex conversion, `Config` construction, `--list-details` ls command selection |
| `cli.rs` | `Opts` clap definition, enum value types (`FileType`, `ColorWhen`, `HyperlinkWhen`, `StripCwdWhen`), hand-written `Exec` arg group, search-path normalization, thread default |
| `config.rs` | `Config` struct: the fully resolved, read-only runtime configuration shared by all threads |
| `walk.rs` | Walker construction, sender callbacks with the filter chain, batching channel, receiver buffering/streaming, Ctrl-C handling |
| `dir_entry.rs` | `DirEntry` wrapper over `ignore::DirEntry` or a broken symlink path, with lazily cached metadata and `LsColors` style; ordering by path |
| `filter/` | `SizeFilter` (`size.rs`), `TimeFilter` (`time.rs`, using `jiff`), Unix-only `OwnerFilter` (`owner.rs`) |
| `filetypes.rs` | `FileTypes` bitset and `should_ignore` for `-t/--type` |
| `filesystem.rs` | Path helpers (absolute paths, `./` stripping, existing-directory check), file-type predicates, `OsStr` → bytes, MSYS path separator default |
| `regex_helper.rs` | HIR-based checks: uppercase literal detection (smart case), leading-dot detection |
| `output.rs` | `print_entry`: format-template, colorized and uncolorized printing, hyperlinks, separators |
| `fmt/` | `FormatTemplate` placeholder parser/generator shared by `--format` and `--exec` |
| `exec/` | `CommandSet`/`CommandTemplate`, per-result job loop, batch execution with argument-size limits, output buffering |
| `hyperlink.rs` | `file://host/path` URL encoding for OSC 8 hyperlinks |
| `sanitize.rs` | Escaping of control/bidi/invisible characters before writing to a terminal |
| `exit_codes.rs` | `ExitCode` enum, mapping to integers, merge semantics, SIGINT re-raise |
| `error.rs` | `print_error` to stderr with `[fd error]:` prefix and sanitization |

## Key design points

- **Config is immutable and shared by reference.** `WorkerState` owns the `Config`; sender closures and receiver threads borrow it inside `std::thread::scope`, so no `Arc<Config>` is needed (only the `CommandSet` is `Arc`-wrapped).
- **Matching happens on bytes.** Patterns are `regex::bytes::Regex`, and file names are converted via `filesystem::osstr_to_bytes`, so non-UTF-8 names on Unix are matched and (when piped) printed byte-exact.
- **By default only the file name is matched**; `--full-path` matches against an absolute path built from a cached CWD.
- **Work is done in the senders.** Filters, metadata lookups and even `LS_COLORS` style computation run on walker threads; the single printing receiver only writes.
- **Two output sinks.** `Config::is_printing()` is true exactly when no command is configured; this switches the receiver between printing and executing.

## Build-time variation

- `completions` feature (default) adds the hidden `--gen-completions` flag using `clap_complete`.
- `use-jemalloc` feature (enabled through the `base` feature, not the default) sets `tikv_jemallocator` as global allocator on platforms where it is known to work; the `cfg` list in `main.rs` must stay in sync with `Cargo.toml`.
- Owner filtering (`-o`) and some file types exist only on Unix; `--one-file-system` only on Unix and Windows.

See [Build, Release and Packaging](../operations/build-release-packaging.md) and [Test Suite](../testing/test-suite.md) for the surrounding tooling.
