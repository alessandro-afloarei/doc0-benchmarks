---
type: workflow
title: Executing commands over search results
description: Per-result and batch command consumers, template validation, argument limits, concurrency, output synchronization, and child-process failure behavior in fd.
tags: [execution, subprocess, batching, concurrency, templates]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:27.513Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-17f6c5c4eb575b153cce48c1
    resource: repo://src/exec/command.rs
  - id: openwiki-source-90d9fc679659a207a83140ba
    resource: repo://src/exec/job.rs
  - id: openwiki-source-47d76f6cde81cde2b78e68be
    resource: repo://src/exec/mod.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "codex", at: "2026-11-16T16:28:27.513Z" }
---

# Executing commands over search results

`--exec` / `-x` and `--exec-batch` / `-X` replace ordinary result printing with child processes. They consume accepted entries from the same walker and filters as a normal search. `CommandSet` owns validated templates; `walk::receive` selects per-result workers or a batch consumer. See [pipeline architecture](../architecture/search-pipeline.md) for the channel boundary.

## Choose the execution mode

| Mode | Runtime behavior | Suitable example |
| --- | --- | --- |
| `-x` | Expand and execute the command set once per result; multiple workers can execute concurrently. | `fd -e rs src -x wc -l` |
| `-x --threads=1` | One command worker, inherited live output, sequential result processing. | `fd -j 1 -e rs src -x wc -l` |
| `-X` | Accumulate result arguments into commands, splitting at configured or system limits. | `fd -e rs src -X wc -l` |

Put execution options after search arguments because subsequent values, including values beginning with `-`, belong to the command. A shell-escaped semicolon terminates a template when further fd options or another template are needed:

```bash
fd -e rs src -x echo '{/}' \; -x wc -l '{}'
fd -e rs src --batch-size 20 -X wc -l '{}'
```

Multiple `-x` templates form an ordered command set for each entry. Multiple `-X` templates form separate builders. Mixing `-x` and `-X`, or combining execution with `--list-details`, is rejected by the CLI. The execution option group also conflicts with quiet mode and result-limit options.

## Direct process arguments and template validation

fd constructs `argmax::Command` with generated executable and argument OS strings. It does not implicitly run a shell. Shell aliases, functions, redirections, and pipelines require an explicitly invoked shell or external executable. Template expansions remain arguments rather than being reparsed as command text.

Templates use the same `{}`, `{/}`, `{//}`, `{.}`, `{/.}`, and brace escapes as `--format`; see [output and paths](../concepts/output-and-paths.md). If no placeholder is present, fd appends an implicit `{}` argument. An empty executable list is rejected. Per-result mode permits a placeholder in the executable position; batch mode requires a fixed executable there.

Batch validation permits at most one argument containing placeholder tokens. This is a restriction on placeholder-bearing arguments, not the literal number of tokens inside that argument: one composite argument can combine several expansions. Two separate arguments such as `echo '{}' '{/}'` are rejected for a batch command. The builder separates fixed pre-arguments, one repeated path argument template, and fixed post-arguments.

Paths use `DirEntry::stripped_path` or `into_stripped_path`. Without explicit roots, the default retains `./` for execution; `--strip-cwd-prefix` can request removal while preserving protection for leading-dash paths. `--path-separator` transforms placeholder-generated paths, including command arguments. It changes representation, not the actual filesystem location or fd's working directory.

## Per-result concurrency and output

The configured thread count controls both traversal and the per-result execution pool. Each worker receives results from cloned channel receivers, executes its command set, accumulates failure status, and continues consuming entries. Execution order across entries is unspecified. One worker makes execution sequential but does not impose a sorted traversal order.

With more than one command worker, `execute_commands` captures each child's stdout and stderr, holds the outputs for the entry's command set, and writes them while holding both output locks. This groups an entry's output and avoids byte interleaving between fd workers, but can retain substantial child output in memory. It also does not preserve the original temporal interleaving between stdout and stderr.

With one worker, children run via `spawn` with inherited streams, enabling live intermediate output and interaction. The condition in `job` is `config.threads > 1`, despite a nearby comment suggesting otherwise. NUL mode appends a NUL byte to stdout after each entry's command-set output; it does not rewrite child output into filename records or affect batch output delimiters.

If a generated command fails to start or returns nonzero, later commands for that same entry are skipped. Captured output collected up to that failure is flushed. Other entries continue. A missing program produces a `Command not found` diagnostic; other spawn/argument problems produce an execution diagnostic. Aggregation returns general failure rather than propagating an exact child exit code.

## Batch construction and limits

Batch mode has one consumer. For each discovered path, it expands the repeated path argument for each command builder. A nonzero `--batch-size` causes a builder to execute before accepting a path beyond that count; zero leaves only system argument limits. `args_would_fit` reserves space for fixed trailing arguments before appending the next path. If needed, the builder finishes its current command and creates a fresh one.

Finishing appends the fixed post-arguments and runs the child synchronously with inherited stdin/stdout/stderr. Empty batches never spawn a child, so no matches means no invocation. A child returning failure records general error while later batches can still run; an I/O or construction error returns immediately through the error handler. Multiple builders may flush at different times, so repeated `-X` templates do not form a transaction over the full result set.

Although short help describes a command with all results, command-line size limits and explicit batch sizes can produce multiple invocations. Result argument order is the discovery order and must not be relied upon.

## Detailed listing integration

`--list-details` is implemented as a batch command set around a platform-selected `ls` command. The command includes long, human-readable listing options and directory-self listing (`-d`). GNU-style platforms select color arguments; BSD-family platforms probe `gls` first and otherwise use BSD options. Windows requires a usable GNU `ls` or returns an unsupported-operation error. This feature therefore depends on an external program and inherits batch argument limits and status handling.

## Verification and change boundaries

Keep template syntax in `fmt`, mode validation in `CommandTemplate`/`CommandSet`, argument-limit handling in `CommandBuilder`, process status/output handling in `exec::command`, and scheduling in `walk::receive`. Test invalid templates as well as successful expansion.

Useful unit tests include `tokens_multiple_batch`, `placeholder_as_executable_rejected`, and path-separator expansion cases in `exec`. Integration coverage includes `test_exec`, `test_exec_multi`, `test_exec_nulls`, `test_exec_batch`, `test_exec_batch_multi`, `test_exec_batch_with_limit`, `test_exec_invalid_utf8`, and `test_single_and_multithreaded_execution`. The batch tests normalize word order intentionally; see [development and testing](development-and-testing.md).
