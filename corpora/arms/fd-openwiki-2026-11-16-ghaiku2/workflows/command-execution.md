---
type: workflow
title: Command Execution (--exec and --exec-batch)
description: How fd runs an external command for each search result (-x/--exec) or for batches of results (-X/--exec-batch) - the CommandSet and CommandTemplate model, placeholder expansion, argument-limit batching with argmax, output buffering across threads, and exit-status merging.
tags: [exec, exec-batch, commands, placeholders, threads, batching, exit-codes, argmax]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:10:54.611Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
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
generated: { by: "claude-code", at: "2026-11-16T18:10:54.611Z" }
---

# Command Execution (`--exec` and `--exec-batch`)

`fd` can run a command on each result instead of printing it. The option
`-x/--exec` runs one process per result, and `-X/--exec-batch` passes many
results to one process at a time. Both are parsed into a `CommandSet` in
`src/exec/mod.rs`, and the `walk` receiver hands results to the runners in
`src/exec/job.rs`. Placeholder expansion is implemented in `src/fmt/mod.rs`,
which is also used by `--format`.

## Parsing and the command model

`cli::Exec` collects the `-x`/`-X` argument groups by hand, because clap has
no derive support for grouped values here. Each group becomes a
`CommandTemplate` through `CommandSet::new` (one-by-one) or
`CommandSet::new_batch`. A `CommandSet` contains:

- `mode`: `OneByOne` or `Batch`.
- `commands`: a list of templates. Several `-x` options may be given, and each
  runs for every result in order.

`CommandTemplate::new` enforces these rules:

- At least one argument must be present. Otherwise the error is
  "No executable provided for --exec or --exec-batch".
- In batch mode, the first argument must be fixed text, not a placeholder.
- In batch mode, each command may contain at most one placeholder
  (`number_of_tokens() > 1` is rejected in `CommandSet::new_batch`).
- If the arguments contain no placeholder at all, `{}` is appended as the last
  argument. So `fd -x wc -l` is equivalent to `fd -x wc -l {}`.

`CommandSet::in_batch_mode` decides how the receiver dispatches results (see
below).

## Placeholders

Placeholders are parsed by `FormatTemplate::parse` using an Aho-Corasick
automaton over `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}` and `{/.}`:

| Token | Expands to |
| --- | --- |
| `{}` | the path as printed, with a leading `./` stripped when appropriate |
| `{/}` | the basename |
| `{//}` | the parent directory |
| `{.}` | the path without its extension |
| `{/.}` | the basename without its extension |
| `{{` and `}}` | literal braces |

`--path-separator` changes separators in the generated argument. Each argument
is turned into a value through `FormatTemplate::generate`, which works on the
path before the command is spawned. There is no shell involved: each argument
is passed as one `argv` element, so a path with spaces is never split.

The path given to a template is `DirEntry::stripped_path` (or
`into_stripped_path` in batch mode). That path drops a leading `./` unless the
result would begin with `-`, which would otherwise be read as an option by the
child program.

## One-by-one execution (`-x`)

When the receiver is in non-batch mode, `receive` in `src/walk.rs` starts
`config.threads` job threads, and each runs `exec::job` over the shared channel.
With `--threads=1` there is a single job thread. The receiver then merges the
job threads' exit codes. When there is more than one thread, senders use a
batch size of 1 so that work is distributed evenly.

`exec::job` takes each `WorkerResult`. Filesystem errors are printed only when
`--show-errors` is set. For each entry it calls `CommandSet::execute`, which
generates a `Command` for each template and runs them with
`execute_commands`:

1. Each generated command is run with `cmd.output()` when output buffering is
   enabled (`config.threads > 1`), or with `spawn` and `wait_with_output` when
   it is single-threaded. In the single-threaded case the child inherits stdio,
   so interactive commands work.
2. In buffered mode, stdout and stderr of each child are kept in an
   `OutputBuffer` and written together at the end of the entry. That keeps the
   output of concurrent commands from interleaving at the byte level.
3. A non-zero exit status flushes the buffer and returns `GeneralError` for that
   entry. Remaining templates for the same entry are skipped, but other entries
   continue.
4. A spawn failure is reported through `handle_cmd_error`. A missing program
   gives "Command not found: <program>"; other errors give "Problem while
   executing command". Both return `GeneralError`.
5. With `--null-separator`, a NUL byte is written after each entry's output, so
   the output stream stays delimited even when children print nothing.

The job's exit code is the merge of its entries' codes. `merge_exitcodes`
returns `GeneralError` if any entry failed and `Success` otherwise. The
receiver merges the codes of all job threads in the same way.

## Batch execution (`-X`)

In batch mode the receiver calls `exec::batch`, which filters the results to
stripped paths and calls `CommandSet::execute_batch` with the batch limit
`config.batch_size`. The default for `--batch-size` is 0, which means no
count limit, so only the operating-system argument limit applies.

`CommandBuilder` is created for each template. It separates the template into:

- `pre_args`: fixed arguments before the placeholder (the command name and any
  fixed options).
- `path_arg`: the placeholder argument, generated once per path.
- `post_args`: fixed arguments after the placeholder.

For each path, `push` does the following:

1. If `count` has reached a non-zero limit, the current command is finished.
2. It checks whether the new argument would still fit in the command line using
   `argmax`'s `args_would_fit`. If not, the current command is finished first.
3. It appends the argument and increments `count`.

`finish` runs the command with the post-arguments appended, sets
`GeneralError` on failure but keeps going, and creates a fresh command from
`pre_args`. So a large result set becomes several invocations, each as large
as the platform allows, and a single failing batch does not stop later batches.

Because `CommandSet::execute_batch` processes all templates over the same path
stream, `-X` with several commands runs each command on the whole stream. In
batch mode stdio is inherited, since output cannot be attributed to one result.

## Threads, ordering and output

- `--exec` is run in parallel by default. The documentation for `-x` states
  that no order should be relied on, and `--threads=1` gives sequential
  execution.
- `--exec-batch` runs on a single receiver thread, so batches are sequential.
- Output from one-by-one children is buffered per entry only when
  `config.threads > 1`. With one thread the child's output goes straight to the
  terminal.

## Extension seams

- New placeholders belong in `FormatTemplate::parse` and `Token`, which keeps
  `--format` and `--exec` consistent.
- Alternative batching policies belong in `CommandBuilder::push`, since that is
  where the argument limit is enforced.
- The thread decision lives in `WorkerState::receive`
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  (see [Parallel Traversal](/openwiki/architecture/parallel-traversal.md)).

## Failure behavior summary

| Situation | Effect |
| --- | --- |
| Child exits non-zero (`-x`) | Entry output flushed, `GeneralError`, other entries continue |
| Program not found | `Command not found` on stderr, `GeneralError` |
| Child fails in a batch (`-X`) | Error recorded, later batches still run |
| Filesystem error during walk | Printed only with `--show-errors`, not fatal |
| Invalid template | Rejected during argument parsing |

## Tests

Unit tests in `src/exec/mod.rs` construct `CommandSet` values and check the
generated arguments for placeholders and for appended `{}`. Integration tests
in `tests/tests.rs` cover `test_exec`, `test_exec_multi`, `test_exec_nulls`,
`test_exec_batch`, `test_exec_batch_multi`, `test_exec_batch_with_limit`,
`test_exec_with_separator`, `test_exec_invalid_utf8` and
`test_single_and_multithreaded_execution`. See
<!-- openwiki: broken internal link [/openwiki/testing/integration-tests.md] link "/openwiki/testing/integration-tests.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Testing Strategy](/openwiki/testing/integration-tests.md).

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Parallel Directory Traversal](/openwiki/architecture/parallel-traversal.md)
<!-- openwiki: broken internal link [/openwiki/workflows/output-formatting.md] link "/openwiki/workflows/output-formatting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Output Formatting](/openwiki/workflows/output-formatting.md)
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md)
