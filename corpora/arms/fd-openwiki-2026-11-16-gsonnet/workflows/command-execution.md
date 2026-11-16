---
type: workflow
title: "Command Execution: --exec, --exec-batch and Format Templates"
description: How fd runs commands on results - placeholder template parsing shared with --format, per-result (--exec) versus batched (--exec-batch) execution, thread usage and output buffering, argmax-based argument-limit handling, --list-details, and error behavior.
tags: [exec, exec-batch, placeholders, format, threads, list-details]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:03:56.385Z
sources:
  - id: openwiki-source-17f6c5c4eb575b153cce48c1
    resource: repo://src/exec/command.rs
  - id: openwiki-source-90d9fc679659a207a83140ba
    resource: repo://src/exec/job.rs
  - id: openwiki-source-47d76f6cde81cde2b78e68be
    resource: repo://src/exec/mod.rs
  - id: openwiki-source-82ad9015e8518df8ee697487
    resource: repo://src/fmt/mod.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T09:03:56.385Z" }
---

# Command Execution: --exec, --exec-batch and Format Templates

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-walk-and-receiver.md] link "/openwiki/architecture/parallel-walk-and-receiver.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Command execution replaces the printing receiver of the [walk pipeline](/openwiki/architecture/parallel-walk-and-receiver.md). It is selected when `Config.command` is `Some(Arc<CommandSet>)`; `Config::is_printing()` is then false (no LS_COLORS styling is computed, no sorted/buffered printing).

## Template language (`src/fmt`)

`FormatTemplate::parse` turns a string into either `Text(String)` (no placeholder) or `Tokens(Vec<Token>)`. Placeholders are found with a single Aho-Corasick automaton over `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}`, `{/.}` (initialized once in a `OnceLock`):

| Token | Meaning | Example for `dir/foo.txt` |
| --- | --- | --- |
| `{}` | the path | `dir/foo.txt` |
| `{/}` | basename | `foo.txt` |
| `{//}` | parent directory (`.` if none) | `dir` |
| `{.}` | path without extension | `dir/foo` |
| `{/.}` | basename without extension | `foo` |
| `{{`, `}}` | literal `{`, `}` | |

Escapes are handled while scanning; a placeholder directly followed by `}` is treated as text. Rendering (`generate`) produces an `OsString` so non-UTF-8 paths survive. If `path_separator` is set, separators are rewritten *only inside placeholder expansions*, component-wise (with special handling of Windows UNC prefixes); literal text is never altered. The helpers `basename`, `dirname` and `remove_extension` live in `src/fmt/input.rs` (hidden files like `.foo` keep their name; the empty path stays empty).

<!-- openwiki: broken internal link [/openwiki/concepts/output-and-terminal-safety.md] link "/openwiki/concepts/output-and-terminal-safety.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The same engine renders `--format`, so `--format '{/}'` and `--exec echo {/}` share semantics ([output rendering](/openwiki/concepts/output-and-terminal-safety.md)).

## Building a `CommandSet` (`src/exec/mod.rs`)

`CommandSet` holds an `ExecutionMode` (`OneByOne` or `Batch`) and one or more `CommandTemplate`s (each `--exec` occurrence is a separate command run in sequence for a result). `CommandTemplate::new` enforces:

- at least one argument (otherwise `No executable provided for --exec or --exec-batch`);
- in batch mode the first argument must not contain a placeholder;
- if no argument has a placeholder, an implicit `{}` is *appended*.

<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`CommandSet::new_batch` additionally allows only **one** placeholder-bearing argument ("Only one placeholder allowed for batch commands"). These errors surface through clap as `InvalidValue` during [argument parsing](/openwiki/architecture/cli-and-configuration.md).

## Mode 1: `--exec` (one process per result)

`WorkerState::receive` spawns `config.threads` scoped worker threads, each running `exec::job` over a clone of the channel receiver; senders use batch size 1 (with more than one thread) to distribute work evenly. Per result, `job` calls `CommandSet::execute` with the (prefix-stripped) path, the path separator, the `--print0` flag, and `buffer_output = threads > 1`. `execute_commands` runs each template in order and **stops at the first failing command** for that result.

- **Buffered output** (multi-threaded): the child's stdout/stderr are captured with `Command::output()` into an `OutputBuffer`, written all at once under the stdout/stderr locks so outputs of different jobs never interleave. With `--print0`, a `\0` follows each result's output.
- **Unbuffered** (`--threads=1`): the child runs via `spawn().wait_with_output()`, so interactive programs and live output work.
- Exit codes from all job threads are folded with `merge_exitcodes` (any failure → `GeneralError`). Execution order is not deterministic with multiple threads.

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-walk-and-receiver.md] link "/openwiki/architecture/parallel-walk-and-receiver.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Because the command line is the *template*, `{}` is passed as a single argument (no shell, no word splitting). When `strip_cwd_prefix` is active, paths that would start with `-` keep their `./` prefix ([DirEntry](/openwiki/architecture/parallel-walk-and-receiver.md)), preventing option injection.

## Mode 2: `--exec-batch` (few processes, many arguments)

`exec::batch` collects all paths (dropping errors unless `--show-errors`) and calls `CommandSet::execute_batch(paths, limit = config.batch_size, separator)`. For each template a `CommandBuilder` splits arguments into `pre_args`, the single `path_arg` template and `post_args`. It uses the `argmax` crate's `Command`, whose `args_would_fit` accounts for the OS `ARG_MAX` limit: when the next path would not fit, or `--batch-size` (0 = unlimited) is reached, the current command is run (`finish`) and a fresh one started with the pre-args. Child stdio is inherited. Any non-success status marks the builder `GeneralError`, but remaining chunks still run; results are merged at the end. Batch mode runs on the receiver thread only, so output ordering is arrival order (not guaranteed).

## `--list-details` / `-l`

Lowered in `extract_command` (`src/main.rs`) into a *batch* `CommandSet` around `ls -l -h -d --color=always|never` (short options for BusyBox compatibility). Selection: on Linux and other Unix, GNU `ls`; on macOS and BSDs, `gls` if `gls --version` runs, else BSD `ls -lhd` plus `-G` for color when supported (not NetBSD/OpenBSD); on Windows, only if a GNU `ls` is found, otherwise an error. It is mutually exclusive with `--exec`/`--exec-batch`.

## Failure semantics

<!-- openwiki: broken internal link [/openwiki/operations/exit-codes-and-error-handling.md] link "/openwiki/operations/exit-codes-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
See [exit codes](/openwiki/operations/exit-codes-and-error-handling.md): a command that cannot be found reports `Command not found: <prog>`; spawn problems report `Problem while executing command`; non-zero child exit yields `GeneralError`. Walker errors are skipped silently unless `--show-errors`.

## Tests

<!-- openwiki: broken internal link [/openwiki/testing/integration-test-harness.md] link "/openwiki/testing/integration-test-harness.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`test_exec`, `test_exec_multi`, `test_exec_nulls`, `test_exec_batch`, `test_exec_batch_multi`, `test_exec_batch_with_limit`, `test_exec_with_separator`, `test_exec_invalid_utf8`, `test_list_details`, `test_single_and_multithreaded_execution` in `tests/tests.rs`, plus unit tests for template parsing in `src/exec/mod.rs` and `src/fmt` ([harness](/openwiki/testing/integration-test-harness.md)).
