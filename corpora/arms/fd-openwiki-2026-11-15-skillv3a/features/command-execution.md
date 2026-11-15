---
type: feature
title: Command Execution (--exec / --exec-batch)
description: How fd runs external commands for search results — template parsing and placeholders, per-result parallel execution with output buffering, batch execution with argmax-sized argument lists and --batch-size, --list-details as a synthesized ls batch, error handling and exit-code merging.
tags: [exec, exec-batch, commands, placeholders, list-details]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:39:25.366Z
sources:
  - id: openwiki-source-17f6c5c4eb575b153cce48c1
    resource: repo://src/exec/command.rs
  - id: openwiki-source-90d9fc679659a207a83140ba
    resource: repo://src/exec/job.rs
  - id: openwiki-source-47d76f6cde81cde2b78e68be
    resource: repo://src/exec/mod.rs
  - id: openwiki-source-82ad9015e8518df8ee697487
    resource: repo://src/fmt/mod.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-15T17:39:25.366Z" }
---

# Command Execution (`--exec` / `--exec-batch`)

fd can hand its results to other programs instead of printing them. The implementation lives in `src/exec/` and reuses the `FormatTemplate` placeholder engine from `src/fmt/` (shared with `--format`, see [Output Formatting](output-formatting.md)).

## Entry points

- `-x`/`--exec <cmd>...` → `CommandSet::new` (mode `OneByOne`): run a command per result, in parallel.
- `-X`/`--exec-batch <cmd>...` → `CommandSet::new_batch` (mode `Batch`): run the command once (or a few times) with many results as arguments.
- `-l`/`--list-details` → `construct_config` synthesizes a batch `ls -l -h -d [--color=...]` `CommandSet` (see [CLI Parsing and Configuration](../architecture/cli-and-configuration.md)).

Both exec options accept multiple values until a `;` terminator, may be repeated (each occurrence is one command template), and accept hyphenated values, so they should normally be the last fd arguments. They are parsed by the hand-written `Exec` clap implementation in `src/cli.rs`. `--exec` and `--exec-batch` conflict with each other, with `--list-details`, and (via the `execs` arg group) with `--max-results`, `-1` and `--quiet`.

Once `Config::command` is set, `Config::is_printing()` is false and the walker's receiver dispatches to `exec::job` or `exec::batch` instead of printing ([Parallel Walk and Receiver](../architecture/parallel-walk-and-receiver.md)).

## Templates and placeholders

Each argument of a command is parsed by `FormatTemplate::parse` into either fixed `Text` or a list of `Token`s. Placeholders are found with an Aho-Corasick automaton:

| Placeholder | Token | Expands to |
|-------------|-------|-----------|
| `{}` | `Placeholder` | the path |
| `{/}` | `Basename` | file name |
| `{//}` | `Parent` | parent directory (`.` if none) |
| `{.}` | `NoExt` | path without extension (leading `./` removed) |
| `{/.}` | `BasenameNoExt` | file name without extension |
| `{{`, `}}` | — | literal `{` / `}` |

`CommandTemplate::new` enforces:

- at least one argument ("No executable provided for --exec or --exec-batch");
- in batch mode the first argument must be a fixed executable, not a placeholder (`{}` *is* allowed as the executable for `--exec`);
- if no argument contains a placeholder, an implicit `{}` argument is appended;
- in batch mode only one argument may contain placeholders ("Only one placeholder allowed for batch commands").

When `--path-separator` is set, separators inside placeholder expansions (not fixed text) are rewritten component by component, with special handling of Windows drive and UNC prefixes. Paths passed to commands are the *stripped* paths (`DirEntry::stripped_path`), which keep `./` by default when commands are used — see [Output Formatting](output-formatting.md#paths).

## Per-result mode (`--exec`)

`WorkerState::receive` spawns `config.threads` scoped threads, each running `exec::job` over a clone of the channel receiver. The walker sends batches of size 1 in this mode so work is spread evenly across these threads. For every `WorkerResult::Entry`, `job` calls `CommandSet::execute`, which generates one `argmax::Command` per template and runs them **sequentially** through `execute_commands`:

- **Output buffering:** with more than one thread, each command is run with `output()` and its stdout/stderr captured into an `OutputBuffer`. After all commands for that entry finish, the buffer is written while holding both the stdout and stderr locks, so output from different entries never interleaves. With `--threads=1`, commands are spawned with inherited stdio so their output is live and interactive.
- **Short-circuit:** if a command exits non-zero, remaining commands for that entry are skipped, buffered output is flushed and the entry yields `GeneralError`.
- **`--print0`:** a `\0` is written after the output of each entry's command set (not after each command).
- **No ordering guarantee:** commands run in parallel in walk order per thread; users should not rely on order.

Each thread merges its per-entry exit codes, and the thread results are merged again with `merge_exitcodes`.

## Batch mode (`--exec-batch`, `--list-details`)

`exec::batch` runs on the receiver thread. It collects stripped paths from the channel (printing errors only with `--show-errors`) and calls `CommandSet::execute_batch(paths, config.batch_size, separator)`.

For each template a `CommandBuilder` splits the arguments into `pre_args`, the single placeholder argument `path_arg`, and `post_args`. For every path:

1. if `--batch-size` is non-zero and the current count has reached it, the pending command is run (`finish`);
2. if the expanded argument plus `post_args` would not fit in the OS argument-length limit (`argmax::Command::args_would_fit`), the pending command is run first;
3. the argument is appended.

At the end, `finish` runs any pending command. `finish` only executes when at least one path was added, so **no command runs if there were no results**. Batch commands inherit stdin/stdout/stderr. A non-zero exit sets the builder's exit code to `GeneralError`; all builders' codes are merged at the end. Thanks to argmax sizing, "Argument list too long" errors cannot occur, even without `--batch-size` (which defaults to 0 = unlimited and requires `--exec-batch`).

## Errors and exit codes

- Spawning failures go through `handle_cmd_error`: `NotFound` prints `Command not found: <program>`; other errors print `Problem while executing command: ...`. Both yield `GeneralError` (exit code 1).
- Any failed command makes fd exit with code 1. Interruption (`KilledBySigint`) inside merged results is also mapped to `GeneralError` by `merge_exitcodes`. See [Exit Codes, Errors, and Interrupts](../operations/exit-codes-and-errors.md).

## Tests

- `src/exec/mod.rs` unit-tests template parsing (placeholders, braces escaping, batch restrictions, custom separators incl. Windows paths).
- `src/fmt/input.rs` tests `basename`, `dirname` and `remove_extension`.
- `tests/tests.rs` has `test_exec`, `test_exec_multi`, `test_exec_nulls`, `test_exec_batch`, `test_exec_batch_multi`, `test_exec_batch_with_limit`, `test_exec_with_separator`, `test_exec_invalid_utf8`, `test_list_details` and `test_single_and_multithreaded_execution`. See [Testing](../testing/integration-tests.md).
