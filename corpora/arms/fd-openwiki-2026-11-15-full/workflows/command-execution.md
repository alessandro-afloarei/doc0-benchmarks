---
type: workflow
title: Command Execution (--exec, --exec-batch, --list-details)
description: How fd runs external commands on search results. Covers how CommandSet and CommandTemplate are built and validated, the placeholder template language shared with --format, per-result job threads versus batch mode, argmax-aware argument splitting and --batch-size, output buffering across threads, exit-code merging, and how --list-details maps onto ls.
tags: [exec, exec-batch, placeholders, templates, concurrency, list-details]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:44:06.029Z
sources:
  - id: openwiki-source-17f6c5c4eb575b153cce48c1
    resource: repo://src/exec/command.rs
  - id: openwiki-source-90d9fc679659a207a83140ba
    resource: repo://src/exec/job.rs
  - id: openwiki-source-47d76f6cde81cde2b78e68be
    resource: repo://src/exec/mod.rs
  - id: openwiki-source-2deefc22f345fd7e2c28832d
    resource: repo://src/fmt/input.rs
  - id: openwiki-source-82ad9015e8518df8ee697487
    resource: repo://src/fmt/mod.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-15T08:44:06.029Z" }
---

# Command Execution

fd can pass each search result to an external command instead of printing it:

- `-x/--exec <cmd...> [;]` runs the command **once per result**, in parallel.
- `-X/--exec-batch <cmd...> [;]` runs the command **once with all results** as arguments. If the results don't fit on one command line, it is split into several runs.
- `-l/--list-details` is shorthand for a batch `ls -l` invocation.

All three put `Config.command = Some(Arc<CommandSet>)`. With a command present, `Config::is_printing()` returns false, and the walk receiver hands results to `exec::job` or `exec::batch` instead of printing them (see [Parallel Search Pipeline](../architecture/search-pipeline.md)).

## Building the CommandSet

The CLI collects each `-x`/`-X` occurrence as a list of strings that ends at `;`. `-x` and `-X` can't be used together. Several `-x` occurrences, or several `-X` occurrences, produce one `CommandSet` that holds several `CommandTemplate`s (`src/exec/mod.rs`).

`CommandTemplate::new(args, mode)` parses every argument with `FormatTemplate::parse` and then validates the result:

- An empty argument list is an error: `No executable provided for --exec or --exec-batch`.
- In **batch** mode the first argument (the executable) can't be a placeholder. In one-by-one mode it can, which lets each result run as a program (`fd -x {}`).
- If no argument contains a placeholder, `{}` is appended as a final argument.
- `CommandSet::new_batch` also rejects templates with more than one placeholder **argument**: `Only one placeholder allowed for batch commands`.

## Placeholder templates (`src/fmt/`)

`FormatTemplate` is used by both exec and `--format`. Parsing scans the string with one Aho-Corasick automaton (built once in a `OnceLock`) for these tokens:

| Token | Expands to (for `dir/sub/file.tar.gz`) |
| --- | --- |
| `{}` | the path, `dir/sub/file.tar.gz` |
| `{/}` | basename, `file.tar.gz` |
| `{//}` | parent directory, `dir/sub` (`.` if the path has no parent component) |
| `{.}` | path without the last extension, `dir/sub/file.tar` |
| `{/.}` | basename without the last extension, `file.tar` |
| `{{`, `}}` | literal `{`, `}` |

A placeholder that is immediately followed by `}` is treated as literal text, and the extra `}` is consumed. So `{.}}` becomes the literal string `{.}`. An argument with no placeholder is stored as `FormatTemplate::Text` and passed through unchanged. Escapes are already resolved at that point.

`generate(path, path_separator)` builds an `OsString`, so non-UTF-8 paths reach commands without loss. When `--path-separator` is set, only the **placeholder expansions** are rewritten component by component. This includes Windows drive and UNC prefixes. Literal text is left alone. `{.}` also strips a leading `./` (`remove_extension` calls `strip_current_dir`).

The path that is substituted is `DirEntry::stripped_path`. Because `--strip-cwd-prefix` defaults to *off* in exec modes, `{}` usually looks like `./sub/file`. That protects commands from filenames that start with `-` (see [Output Formatting](../concepts/output-formatting.md)).

## One-by-one mode (`--exec`)

- `WorkerState::receive` starts `config.threads` scoped threads. Each one runs `exec::job` on a clone of the channel receiver. To spread work evenly, walker threads send batches of **one** entry when more than one thread is used.
- For each entry, `CommandSet::execute` generates one command per template and runs them **in order** through `execute_commands`. The first command that fails stops the rest for that entry.
- **Output buffering**: if `threads > 1`, each command runs with `output()`. Its stdout and stderr are captured into an `OutputBuffer`, and after the entry's commands finish, the buffer is written while **holding both stdout and stderr locks**. This keeps output from different entries from interleaving. With `--threads=1`, commands are `spawn()`ed with inherited stdio, so output streams live and interactive programs work.
- With `--print0`, a `\0` is written after each entry's command output, so a consumer can separate the per-result output blocks.
- Execution order is not deterministic. Use `-j1` for sequential runs.
- The exit codes from all entries and threads are combined with `merge_exitcodes`. If any command fails, fd exits with status 1.

## Batch mode (`--exec-batch`, `--list-details`)

`exec::batch` runs on the receiver thread itself. It collects stripped paths and calls `CommandSet::execute_batch(paths, batch_size, path_separator)`:

- For each template, a `CommandBuilder` splits the arguments into `pre_args` (before the placeholder argument), `path_arg` (the single placeholder argument), and `post_args`. It creates an `argmax::Command`, with inherited stdin, stdout, and stderr, already containing `pre_args`.
- For every path, the builder expands `path_arg` and pushes it. Before pushing, it **finishes** the current command (appends `post_args`, runs it, and starts a fresh one) in either of these cases:
  - `--batch-size N` is non-zero and N paths have already been added, or
  - `argmax`'s `args_would_fit` reports that the next argument plus `post_args` would exceed the OS command-line limit.
- At the end, any pending command is finished. A non-zero status marks the builder as failed. Later chunks still run.
- If several `-X` templates are given, each one gets its own builder and all of them see every path.

`--batch-size` defaults to 0, meaning unlimited, and requires `--exec-batch`.

## `--list-details`

`construct_config` calls `extract_command`. If there is no explicit `-x`/`-X` and `-l` is set, it builds `CommandSet::new_batch([ls_cmd])`, and `determine_ls_command` chooses the command:

- Linux and other GNU-ish Unix systems: `ls -l -h -d --color=always|never`. The color setting follows fd's own color decision. Short options are used so BusyBox `ls` also works.
- macOS and the BSDs: `gls` (GNU ls) if it is installed. Otherwise BSD `ls -l -h -d`, plus `-G` for color except on NetBSD and OpenBSD.
- Windows: works only if a GNU `ls` is on `PATH`. Otherwise fd errors out.
- Other platforms: unsupported, and fd errors out.

`-l` conflicts with `--exec`, `--exec-batch`, `--format`, `--print0`, and `--absolute-path`.

## Failure semantics

- A `NotFound` spawn error prints `Command not found: <prog>`. Any other I/O error prints `Problem while executing command: ...`. Both lead to `GeneralError`.
- Argument construction errors (`try_arg`/`try_args`) are reported the same way.
- See [Exit Codes, Errors and Signals](../operations/exit-codes-and-errors.md).

## Tests

- Unit tests in `src/exec/mod.rs` cover template parsing, implicit placeholders, brace escapes, batch validation, a placeholder as the executable, and custom path separators. `src/fmt/` has tests for placeholder parsing and for the basename, dirname, and extension helpers.
- Integration tests: `test_exec`, `test_exec_multi`, `test_exec_nulls`, `test_exec_batch`, `test_exec_batch_multi`, `test_exec_batch_with_limit`, `test_exec_with_separator`, `test_exec_invalid_utf8`, `test_list_details`, `test_single_and_multithreaded_execution`.
