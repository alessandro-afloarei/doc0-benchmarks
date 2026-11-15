---
type: architecture
title: "Search Pipeline: CLI to Output"
description: End-to-end flow of an fd search — clap option parsing, pattern-to-regex conversion and smart case, Config construction, the parallel ignore-crate walk with per-entry filters, the batched channel, the buffering/streaming receiver, terminal-safe output, and exit codes.
tags: [architecture, walk, regex, ignore, concurrency, output, exit-codes]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T06:14:47.054Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-93a53f6e4cf137ef30c47edf
    resource: repo://src/output.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
  - id: openwiki-source-3a6ff89030cacfe8ee730edf
    resource: repo://src/sanitize.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-15T06:14:47.054Z" }
---

# Search Pipeline: CLI to Output

An `fd` invocation is a single pipeline: parse options → build regexes →
freeze an immutable `Config` → run a parallel directory walk whose worker
threads filter entries → send matches over a bounded channel → a receiver
prints them (or hands them to the command executor). Everything lives in the
single `fd` binary crate (`src/main.rs`).

## 1. Option parsing (`src/cli.rs`)

`Opts` is a clap derive struct; `main` calls `run()`, which does
`Opts::parse()`. `Opts` also exposes derived accessors used later:

- `search_paths()` — positional paths, or `--search-path`, or `./` by default.
  Non-directory paths are reported with an error message and dropped; if none
  remain, `run` fails with "No valid search paths given." `.` is normalized to
  `./` and a literal `-` path to `./-`; `--absolute-path` makes paths absolute.
- `threads()` — `--threads` or `available_parallelism()` capped at 64 (falls
  back to 1).
- `max_depth()`/`min_depth()` — fall back to `--exact-depth`.
- `max_results()` — `--max-results` (if > 0) or 1 for `-1`.
- `strip_cwd_prefix(auto)` — only possible when no search paths were given.

`--base-directory` is applied first by `set_working_dir` via
`env::set_current_dir`. With the `completions` feature, `--gen-completions`
short-circuits the run to print a shell completion script.

## 2. Pattern handling (`src/main.rs`, `src/regex_helper.rs`)

The positional pattern plus every `--and` pattern are processed together:

1. `ensure_search_pattern_is_not_a_path` — without `--full-path`, any pattern
   containing `/` (or, on Windows, `\` *and* naming an existing directory) is
   rejected with a hint to use `fd . <dir>` or `--full-path`.
2. `build_pattern_regex` — `--glob` converts via `globset` with
   `literal_separator(true)`; `--exact` yields `^escaped$`; `--fixed-strings`
   escapes; otherwise the pattern is used as a regex.
3. Smart case — the search is case-sensitive if `--case-sensitive` is given or
   any pattern contains a literal uppercase character (determined by parsing
   the regex HIR, so `\S` does not count), unless `--ignore-case` wins.
4. `ensure_use_hidden_option_for_leading_dot_pattern` — on Unix, if hidden
   files are filtered and a pattern starts with `^\.`, fd errors and suggests
   `-H`.
5. `build_regex` compiles each pattern as `regex::bytes::Regex` with
   `dot_matches_new_line(true)`, so non-UTF-8 file names can be matched.

All patterns must match (logical AND).

## 3. Config construction (`src/config.rs`)

`construct_config` consumes `Opts` into a `Config` that is shared read-only by
all threads. Notable derivations:

- Ignore toggles: `--hidden`, `--no-ignore`, `--no-ignore-vcs`,
  `--no-ignore-parent`, `--no-global-ignore-file`, `--no-require-git`, and the
  ripgrep-style `-u` alias (which disables both hidden and ignore filtering).
- Color: `--color auto` enables color only when stdout is a terminal, ANSI is
  supported and `NO_COLOR` is unset/empty. `LS_COLORS` is read from the
  environment, falling back to a built-in `DEFAULT_LS_COLORS` theme.
  `--hyperlink auto` follows the color decision.
- Path separator: `--path-separator`, or `/` on Windows under MSYS
  (`MSYSTEM`); on Windows a custom separator must be one byte.
- `--extension` values become a case-insensitive `RegexSet` of `.\.ext$`.
- `--type` values become a `FileTypes` struct; `executable` implies files and
  `empty` alone implies files and directories.
- `--size`, `--changed-within`/`--changed-before` and (Unix) `--owner` produce
  `SizeFilter`, `TimeFilter` and `OwnerFilter` values (`src/filter/`).
- `--exclude` patterns are prefixed with `!` for the ignore crate's override
  builder.
- `command` is set from `--exec`/`--exec-batch`/`--list-details`; when it is
  present `Config::is_printing()` is false. See
  [Command Execution](command-execution.md).

## 4. The walk (`src/walk.rs`)

`walk::scan` creates a `WorkerState` and builds an `ignore::WalkParallel`
rooted at the first search path (additional paths are added to the builder).
The builder wires `.gitignore`, global git excludes, `.git/info/exclude`,
`.ignore` and `.fdignore` handling from the config, plus the global ignore file
at `<config_dir>/fd/ignore` and any `--ignore-file`. Malformed patterns in
these files are reported but not fatal. `--one-file-system`,
`--follow`, `--max-depth` and thread count are passed straight through.

Each walker thread runs a closure that, per entry, in order:

1. returns `Quit` if the quit flag is set;
2. skips directories containing any `--ignore-contain` marker file;
3. skips the depth-0 root entry;
4. converts `NotFound` errors on symlinks into `DirEntry::broken_symlink`,
   and forwards other errors as `WorkerResult::Error`;
5. applies `--min-depth`;
6. matches every regex against the file name, or the absolute path when
   `--full-path` is set (`search_str_for_entry`);
7. applies extension, file-type, owner, size (files only) and modification
   time filters — metadata-dependent checks come after the cheap name check;
8. pre-computes the `LS_COLORS` style when printing with color, so styling runs
   in parallel;
9. sends `WorkerResult::Entry`, and returns `Skip` when `--prune` is set so
   matched directories are not descended into.

### Batching and backpressure

Results travel over a `crossbeam_channel::bounded(2 * threads)` channel of
`Batch` values. `BatchSender` sends a shared `Arc<Mutex<Option<Vec<_>>>>` as
soon as its first item is pushed, then keeps appending to it until it reaches
the limit (0x100 normally) or the receiver takes it. This amortizes channel
overhead while the bounded channel provides backpressure.

### Receiver: buffering then streaming

Without a command, the receiver is `ReceiverBuffer` writing to a locked
`BufWriter<Stdout>`. It starts in `Buffering` mode: results are collected
until either `max_buffer_time` (default 100 ms; hidden `--max-buffer-time`)
expires or more than 1000 entries arrive, at which point it switches to
`Streaming` and prints everything as it arrives. If the walk finishes while
still buffering, the buffer is **sorted by path** before printing — so fast
searches produce deterministic output while long searches stream promptly.
In streaming mode, stdout is flushed whenever the channel is momentarily empty.

Stopping conditions:

- `--quiet` returns `HasResults(true)` at the first match;
- `--max-results` stops after N results;
- channel disconnection (walk finished) stops normally.

Returning an error from the receiver sets the shared quit flag, causing walker
threads to return `WalkState::Quit`.

### Ctrl-C

When printing colored output, a `ctrlc` handler sets the quit and interrupt
flags; the receiver flushes and returns `KilledBySigint`. A second Ctrl-C exits
immediately. This prevents leaving the terminal in a colored state.

## 5. Output (`src/output.rs`, `src/sanitize.rs`, `src/hyperlink.rs`)

`print_entry` optionally wraps the path in an OSC 8 hyperlink, then uses
`--format` template output, colorized output (parent directory in the
directory style, basename in the entry's `LS_COLORS` style), or plain output.
Directories get a trailing path separator. Entries end with `\n` or `\0`
(`--print0`).

When stdout is an interactive terminal, `maybe_sanitize` escapes control
characters, bidi overrides, zero-width/format characters and tag characters in
file names (as `\xNN` / `\u{NNNN}`) to prevent terminal escape injection. On
Unix, uncolored piped output without a custom separator writes raw path bytes,
so non-UTF-8 names reach downstream tools intact. A broken pipe on write is
not reported as an error.

## 6. Exit codes (`src/exit_codes.rs`)

| Code | Meaning |
| --- | --- |
| 0 | `Success`, or `--quiet` with results |
| 1 | `GeneralError` (also `--quiet` with no results, errors in setup, failed commands) |
| 130 | `KilledBySigint`; on Unix fd resets the SIGINT handler and re-raises the signal |

Errors from `run()` are printed via `error::print_error` as
`[fd error]: ...` and exit 1.

## Tests

`tests/tests.rs` drives the compiled binary through `TestEnv`
(`tests/testenv/mod.rs`), which builds a temporary directory tree and compares
normalized output. Relevant tests include `test_smart_case`, `test_full_path`,
`test_gitignore_and_fdignore`, `test_gitignore_parent`, `test_prune`,
`test_quiet` and `test_max_results`. `src/walk.rs` has unit tests for
`search_str_for_entry`.

See also: [Command Execution](command-execution.md), [Quickstart](../quickstart.md).
