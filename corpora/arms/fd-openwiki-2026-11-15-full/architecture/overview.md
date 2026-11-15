---
type: architecture
title: Architecture Overview
description: End-to-end architecture of the fd binary, from clap argument parsing through pattern compilation and Config construction to the parallel walk and the output or exec sinks, with each module's responsibility.
tags: [architecture, startup, modules, data-flow]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:44:06.029Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-15T08:44:06.029Z" }
---

# Architecture Overview

`fd` is a single Rust binary crate (`fd-find`, binary name `fd`) with no library target. Every run is one short-lived process that goes through the same stages: parse arguments, validate and compile the search patterns, freeze everything into an immutable `Config`, then run a parallel directory walk whose results go either to stdout or to external commands.

## Startup sequence

`main()` (`src/main.rs`) calls `run()`. If `run()` returns `Ok(exit_code)`, it calls `exit_code.exit()`. If it returns an error, the error goes through `error::print_error` as `[fd error]: ...` and the process exits with `ExitCode::GeneralError`. Exit code details are in [Exit Codes, Errors and Signals](../operations/exit-codes-and-errors.md).

`run()` does these steps in strict order:

1. **Parse CLI**: `Opts::parse()` (clap derive, `src/cli.rs`). If the `completions` feature is enabled and `--gen-completions` was passed, fd prints shell completions and returns early.
2. **Working directory**: `set_working_dir` handles `--base-directory` by calling `env::set_current_dir`. Everything after this step, including search-path resolution, is relative to the new directory.
3. **Search paths**: `opts.search_paths()` resolves positional `<path>` or `--search-path` values, or defaults to `./`. Paths that are not existing directories are reported and dropped. If none remain, fd exits with `No valid search paths given.`
4. **Pattern sanity**: `ensure_search_pattern_is_not_a_path` rejects patterns that contain a path separator (unless `--full-path` is set).
5. **Pattern → regex source**: the primary pattern and every `--and` pattern go through `build_pattern_regex`, which turns glob, fixed-string, or exact patterns into regex source strings.
6. **Config**: `construct_config(opts, &pattern_regexps)` uses the `Opts` to build the immutable `Config` (`src/config.rs`). Smart case uses the regex sources here, which is why this step must come before regex compilation.
7. **Hidden-file hint**: `ensure_use_hidden_option_for_leading_dot_pattern` errors out when a pattern can only match dotfiles but hidden files are excluded.
8. **Compile**: `build_regex` builds `regex::bytes::Regex` values with the case sensitivity from `Config`.
9. **Walk**: `walk::scan(&search_paths, regexps, config)` runs the search and returns the final `ExitCode`.

Pattern details are in [Pattern Matching](../concepts/pattern-matching.md). The option-to-config mapping is in [CLI Options and Config Mapping](../reference/cli-and-configuration.md).

## Module map

| Module | Responsibility |
| --- | --- |
| `cli.rs` | clap `Opts` definition, the hand-rolled `Exec` arg group, search-path normalization, derived defaults (threads, max results, strip-cwd-prefix). |
| `main.rs` | Orchestration (steps above), `Config` construction, color/hyperlink detection, `--list-details` → `ls` command selection, default `LS_COLORS`, global allocator selection. |
| `config.rs` | The `Config` struct: the single immutable bundle of runtime settings shared by all threads. |
| `walk.rs` | Builds the `ignore` crate parallel walker, applies per-entry filters on worker threads, and runs the receiver (printing or exec dispatch). See [Parallel Search Pipeline](search-pipeline.md). |
| `dir_entry.rs` | `DirEntry` wrapper around `ignore::DirEntry` or a broken symlink path, with lazily cached metadata and LS_COLORS style, path-based ordering, and `./`-stripping. |
| `filter/`, `filetypes.rs`, `filesystem.rs` | Metadata filters (size, time, owner, file type) and platform helpers. See [Entry Filters](../concepts/entry-filters.md). |
| `regex_helper.rs` | Regex HIR inspection for smart case and leading-dot detection. |
| `exec/` | `--exec` / `--exec-batch` command templates and execution. See [Command Execution](../workflows/command-execution.md). |
| `fmt/` | Placeholder template parser (`{}`, `{/}`, `{//}`, `{.}`, `{/.}`), used by both `--format` and exec. |
| `output.rs`, `sanitize.rs`, `hyperlink.rs` | Printing of entries: colors, format templates, OSC 8 hyperlinks, and terminal-escape sanitization. See [Output Formatting](../concepts/output-formatting.md). |
| `exit_codes.rs`, `error.rs` | Exit code model and error printing. |

## Data flow

```
argv ──clap──▶ Opts ──construct_config──▶ Config ─┐
                 │                                │
                 └─build_pattern_regex─▶ regex src ─build_regex─▶ Vec<Regex>
                                                  │
                         walk::scan(paths, regexps, config)
                                                  │
        ignore::WalkParallel worker threads (filter + style) ──Batch channel──▶ receiver
                                                                          │
                                       ┌──────────────────────────────────┴───────────┐
                              ReceiverBuffer → output::print_entry      exec::job / exec::batch
```

`Config` is moved into a `WorkerState` together with the compiled regexes. Worker closures and the receiver share it by reference inside `std::thread::scope`, so no per-entry cloning or locking of configuration is needed. Exec mode only adds an `Arc<CommandSet>` inside `Config`.

## Cross-cutting design points

- **Byte-level matching.** Patterns are compiled as `regex::bytes::Regex` and matched against `OsStr` bytes (`filesystem::osstr_to_bytes`), so non-UTF-8 filenames on Unix can be matched and printed without loss.
- **Lazy metadata.** `DirEntry` caches `metadata` and `style` in `OnceCell`s, so a `stat` call only happens when a filter or colorizer actually needs it. Styles are computed on worker threads ("compute colors in parallel") instead of on the single output thread.
- **Allocator.** On most Linux targets, building with the `use-jemalloc` feature (part of the `base` feature) installs `tikv_jemallocator` as the global allocator. The platform `cfg` lists in `src/main.rs` and `Cargo.toml` must stay in sync. See [Build, Release and Packaging](../operations/build-release-and-packaging.md).
- **No persistent state.** fd reads configuration only from argv, environment variables (`LS_COLORS`, `NO_COLOR`, `MSYSTEM`, `TERM` on Windows), and ignore files, including the global `<config dir>/fd/ignore`.
