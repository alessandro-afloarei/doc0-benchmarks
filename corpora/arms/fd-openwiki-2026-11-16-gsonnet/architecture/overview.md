---
type: "Reference"
title: "Architecture Overview: From argv to Output"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:03:56.385Z
sources:
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-f5ea23b51c582bb354c81514
    resource: repo://src/filesystem.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T09:03:56.385Z" }
---


# Architecture Overview: From argv to Output

`fd` (crate `fd-find`, binary `fd`, entrypoint `src/main.rs`) is a single-binary CLI that searches directory trees for entries whose *names* (or full paths) match a regex or glob. It is a thin, performance-oriented layer on top of the `ignore` crate's parallel walker, `regex` (byte regexes), and `clap`.

## The pipeline

```
argv --clap--> Opts --validate/lower--> Config + Vec<Regex>
                                            |
                              walk::scan(paths, regexes, config)
                                            |
        N sender threads (ignore::WalkParallel closure: filters, style)
                                            |  bounded channel of Batch
                              receiver (1 thread, or N exec jobs)
                              /                              \
              ReceiverBuffer -> output::print_entry     exec::job / exec::batch
                              \                              /
                                   ExitCode -> process exit
```

<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/concepts/pattern-matching.md] link "/openwiki/concepts/pattern-matching.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
1. **Parse and lower** (`src/cli.rs`, `src/main.rs`, `src/config.rs`): see [CLI parsing and config construction](/openwiki/architecture/cli-and-configuration.md). Output is an immutable `Config` and a list of compiled regexes (one per `--and` expression plus the main pattern; an entry must match *all*). Pattern details live in [pattern matching](/openwiki/concepts/pattern-matching.md).
<!-- openwiki: broken internal link [/openwiki/concepts/ignore-and-visibility-rules.md] link "/openwiki/concepts/ignore-and-visibility-rules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. **Walk** (`src/walk.rs`): `WorkerState::build_walker` configures `ignore::WalkBuilder` from `Config` (hidden, ignore files, depth, symlinks, one-file-system, overrides). See [ignore and visibility rules](/openwiki/concepts/ignore-and-visibility-rules.md).
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-walk-and-receiver.md] link "/openwiki/architecture/parallel-walk-and-receiver.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/concepts/entry-filters.md] link "/openwiki/concepts/entry-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
3. **Filter in the sender closure**: each walker thread runs the per-entry filters in a deliberate cheap-first order: ignore-contain, depth, name/path regex, extension, file type, owner, size, modification time. See [parallel walk and receiver](/openwiki/architecture/parallel-walk-and-receiver.md) and [entry filters](/openwiki/concepts/entry-filters.md).
4. **Transport**: matching entries are wrapped as `WorkerResult::Entry(DirEntry)` (errors as `WorkerResult::Error`) and sent in `Batch`es through a `crossbeam_channel::bounded(2 * threads)` channel, giving backpressure.
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
5. **Consume**: without a command, a single `ReceiverBuffer` collects results, sorting them if the search finishes within a short window and otherwise streaming (see below); with `--exec`/`--exec-batch`/`--list-details`, receiver work moves into `exec::job` threads or `exec::batch` ([command execution](/openwiki/workflows/command-execution.md)).
<!-- openwiki: broken internal link [/openwiki/concepts/output-and-terminal-safety.md] link "/openwiki/concepts/output-and-terminal-safety.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
6. **Render** (`src/output.rs`, `src/sanitize.rs`, `src/hyperlink.rs`): see [output and terminal safety](/openwiki/concepts/output-and-terminal-safety.md).
<!-- openwiki: broken internal link [/openwiki/operations/exit-codes-and-error-handling.md] link "/openwiki/operations/exit-codes-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
7. **Exit**: results are folded to an `ExitCode` and the process exits through `ExitCode::exit` ([exit codes](/openwiki/operations/exit-codes-and-error-handling.md)).

## Key design decisions

- **Config is the contract.** `Config` is built once and shared by reference across threads; only `WorkerState` holds mutable shared state, and that is limited to two `AtomicBool`s (`quit_flag`, `interrupt_flag`).
- **Hybrid output ordering.** fd is parallel and therefore nondeterministic, but for small results it is deterministic: for the first ~100 ms (`DEFAULT_MAX_BUFFER_TIME`, or `--max-buffer-time`) or up to 1000 entries, results are buffered and sorted by path; beyond that the receiver switches permanently to streaming.
- **Lazy, cached metadata.** `DirEntry` wraps either an `ignore::DirEntry` or a broken symlink path and lazily caches `metadata` and LS_COLORS `style` in `OnceCell`s, so filters that don't need a stat don't pay for it.
- **Bytes, not strings.** Names are matched as bytes (`osstr_to_bytes`), so invalid UTF-8 file names are searchable on Unix.
<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-packaging.md] link "/openwiki/operations/build-release-and-packaging.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Platform gating.** Owner filtering, device/socket/pipe types, `nix`-based hostname/signals are `cfg(unix)`; jemalloc is an opt-in feature on selected targets ([build and packaging](/openwiki/operations/build-release-and-packaging.md)).

## Module ownership map

| Module | Responsibility |
| --- | --- |
| `src/main.rs` | startup orchestration, config lowering, pattern→regex, `ls` command selection, embedded default `LS_COLORS` |
| `src/cli.rs` | clap `Opts`, `Exec` arg parsing, search-path normalization |
| `src/config.rs` | `Config` struct |
| `src/walk.rs` | walker construction, sender closure, batching, `ReceiverBuffer`, Ctrl-C handling |
| `src/dir_entry.rs` | `DirEntry`, stripped-path logic, LS_COLORS `Colorable` impl |
| `src/filetypes.rs`, `src/filter/*`, `src/filesystem.rs` | type/size/time/owner filters and filesystem predicates |
| `src/regex_helper.rs` | smart-case and leading-dot analysis on regex HIR |
| `src/exec/*`, `src/fmt/*` | command templates, execution, placeholder formatting (also used by `--format`) |
| `src/output.rs`, `src/sanitize.rs`, `src/hyperlink.rs`, `src/error.rs` | rendering and error printing |
| `src/exit_codes.rs` | `ExitCode`, merge semantics, SIGINT re-raise |
<!-- openwiki: broken internal link [/openwiki/testing/integration-test-harness.md] link "/openwiki/testing/integration-test-harness.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| `tests/` | black-box integration tests ([harness](/openwiki/testing/integration-test-harness.md)) |

## Where to go next

<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Start with the [quickstart](/openwiki/quickstart.md) for task routing. For behavior changes to filtering, read the walk page first; for new flags, the CLI page; for anything affecting terminal output, the output page.
