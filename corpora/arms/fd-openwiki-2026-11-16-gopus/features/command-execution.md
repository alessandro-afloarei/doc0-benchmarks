---
type: feature
title: "Command Execution: --exec, --exec-batch, and --list-details"
description: How fd turns search results into external command invocations — parsing command templates and placeholders, running one command per result in parallel job threads with buffered output, batching many results into argument-length-limited invocations, the --list-details ls wrapper, and exit-code merging.
tags: [exec, exec-batch, commands, placeholders, concurrency]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-17f6c5c4eb575b153cce48c1
    resource: repo://src/exec/command.rs
  - id: openwiki-source-90d9fc679659a207a83140ba
    resource: repo://src/exec/job.rs
  - id: openwiki-source-47d76f6cde81cde2b78e68be
    resource: repo://src/exec/mod.rs
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-82ad9015e8518df8ee697487
    resource: repo://src/fmt/mod.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# Command Execution: --exec, --exec-batch, and --list-details

Instead of printing results, fd can pass them to external programs. The code
lives in `src/exec/` (`mod.rs` for templates and batch building, `job.rs` for the
consumer loops, `command.rs` for spawning and output handling) and reuses the
placeholder engine in `src/fmt/`.

## Parsing: from clap to `CommandSet`

`--exec/-x` and `--exec-batch/-X` are hand-written clap args (`Exec` in
`src/cli.rs`) because each *occurrence* is a separate command. Both take
`1..` values, allow hyphen-leading values, and end at a `;` terminator (pass
`\;` in a shell), so every positional after `-x` belongs to the command unless
terminated. `Exec::from_arg_matches` maps the occurrences to
`CommandSet::new` (one-by-one) or `CommandSet::new_batch`; parse errors become
clap `InvalidValue` errors. The two flags conflict with each other and with
`--list-details`, and the whole `execs` group conflicts with `--max-results`,
`--max-one-result`/`-1`, and `--quiet`.

Multiple occurrences (`-x echo \; -x echo test {/}`) run each command, in order,
for every result (one-by-one mode) or each as a separate batch command.

### `CommandTemplate`

Every argument is parsed into a `FormatTemplate` — either fixed `Text` or a
`Tokens` list containing placeholders. Rules enforced by `CommandTemplate::new`:

- At least one argument is required ("No executable provided ...").
- In batch mode the executable (first argument) must not contain a placeholder.
- If no argument contains a placeholder, `{}` is appended as a final argument.
- `new_batch` additionally rejects templates with more than one placeholder
  argument ("Only one placeholder allowed for batch commands").

Placeholders (shared with `--format`, see
[Output Formatting](output-formatting.md)): `{}` path, `{/}` basename, `{//}`
parent directory, `{.}` path without extension, `{/.}` basename without
extension; `{{` and `}}` are literal braces. Placeholders are substituted on the
OS string path (no shell is involved, so no quoting is needed), and
`--path-separator` is applied only to placeholder expansions, not fixed text.

The path passed in is `DirEntry::stripped_path`; since `--strip-cwd-prefix`
defaults to *not* stripping when a command is present, relative results reach
commands as `./name`, which prevents names starting with `-` from being read as
options.

## One-by-one mode (`--exec`)

The receiver side ([Parallel Walk](../architecture/parallel-walk-and-receiver.md))
spawns `config.threads` scoped threads, each running `exec::job` over a clone of
the batch receiver. Senders use a batch limit of 1 here (when `threads > 1`) so
results spread across job threads. For each `WorkerResult::Entry`, `job` calls
`CommandSet::execute`, which builds one `argmax::Command` per template and runs
them through `execute_commands`:

- **Multiple threads:** `cmd.output()` captures stdout/stderr into an
  `OutputBuffer`; when all commands for that entry finish (or one fails) the
  buffer is written while holding both the stdout and stderr locks, so output
  from concurrent commands never interleaves.
- **Single thread (`-j1`):** commands are spawned with inherited stdio so their
  output and any interaction appear live.
- With `--print0`, a `\0` is written after each entry's output.
- A command with a non-zero (or missing) exit status stops the remaining commands
  for that entry and yields `GeneralError`.

Execution order across results is not guaranteed; the help text says not to rely
on it. Errors from the walker are printed only with `--show-errors`.

## Batch mode (`--exec-batch`, `--list-details`)

`exec::batch` runs on the single receiver thread. It converts entries into
owned stripped paths and calls `CommandSet::execute_batch`, which keeps one
`CommandBuilder` per template. A builder splits the template into `pre_args`,
the single placeholder `path_arg`, and `post_args`, then for each path:

1. If `--batch-size` (default 0 = unlimited) is reached, run the current command.
2. If the new argument plus `post_args` would not fit the OS argument-length
   limit (`argmax::Command::args_would_fit`), run the current command.
3. Append the expanded argument.

`finish` appends `post_args`, runs the command with inherited stdio, records a
`GeneralError` if it exited unsuccessfully, and starts a fresh command. So
`-X` may invoke the program several times for large result sets. A spawn error
(e.g. "Command not found: ...") aborts the batch immediately.
`--batch-size` requires `--exec-batch`.

### `--list-details` (`-l`)

`-l` is sugar for a batch command synthesized by `determine_ls_command`
(`src/main.rs`):

- Linux and other GNU-like Unix: `ls -l -h -d --color=always|never` (short options
  for BusyBox compatibility; color follows fd's own color decision).
- macOS / BSDs: prefer GNU `gls` if it runs, else BSD `ls -l -h -d`, adding `-G`
  for color except on NetBSD/OpenBSD.
- Windows: GNU `ls` if available, otherwise an error.

`-l` conflicts with `--absolute-path`, `--exec`, `--exec-batch`, and `--print0`.

## Exit codes

Each job thread merges its per-entry codes, and the receiver merges all threads'
codes with `merge_exitcodes`: any error → `GeneralError` (1), otherwise
`Success`. See [Exit Codes and Errors](../reference/exit-codes-and-errors.md).

## Tests

- `src/exec/mod.rs` unit tests: placeholder parsing (`tokens_*`), batch
  constraints (`tokens_multiple_batch`, `placeholder_as_executable_rejected`),
  empty templates, and custom path separators.
- `tests/tests.rs`: `test_exec`, `test_exec_multi`, `test_exec_nulls`,
  `test_exec_batch`, `test_exec_batch_multi`, `test_exec_batch_with_limit`,
  `test_exec_with_separator`, `test_exec_invalid_utf8`, `test_list_details`.
