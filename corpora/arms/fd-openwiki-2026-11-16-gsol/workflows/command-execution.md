---
type: execution-workflow
title: Running commands on search results
description: Use fd execution templates with per-result workers or argument-limited batches, and understand placeholder expansion, stdio, ordering, and failure propagation.
tags: [execution, workflows, concurrency, templates, integration]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:51.346Z
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
generated: { by: "codex", at: "2026-11-16T06:05:51.346Z" }
---

# Running commands on search results

`-x`/`--exec` and `-X`/`--exec-batch` replace normal path printing with child commands. Search criteria still run in walker producers; the receiver side consumes accepted `DirEntry` values. `--list-details` is another entry into this system: it constructs a platform-appropriate batch `ls` command.

## Select the execution mode

| Mode | Scheduling | Appropriate use |
| --- | --- | --- |
| `-x` | One command set per result, processed by a pool of `--threads` workers | Independent operations on each path |
| `-x -j 1` | One result's command set at a time | Serial commands or interaction with child output |
| `-X` | One result iterator feeds batch command builders | Commands that accept a list of paths |

Command execution order and batch argument order follow discovery and scheduling rather than sorted path output. Even with one execution worker, do not rely on alphabetical order. The [search pipeline](../architecture/search-pipeline.md) explains how the traversal channel distributes work.

Place fd arguments before the command template:

```sh
fd -t f -e rs . src -x echo '{}'
fd -t f -e rs . src -X wc -l
```

All arguments after `-x`/`-X`, including option-looking arguments, belong to the command until a literal `;` terminates it. In a shell, escape that terminator as `\;`. For example, `fd -x echo \; pattern src` resumes fd argument parsing after the template. Repeated occurrences create a command set; per-result commands run in supplied order for that result:

```sh
fd -t f -e rs -x echo 'path={}' \; -x echo 'name={/}'
```

The two execution modes conflict with each other and with `--list-details`. Execution modes and details also conflict with quiet mode and result-limit switches. `--batch-size` requires batch execution.

## Arguments and placeholders

Templates are argument vectors passed directly to `argmax::Command`; fd does not interpret a single string as shell syntax. For example, `-x 'echo {}'` does not mean executable `echo` plus an argument. Shell aliases/functions, pipes, variable expansion, and redirection need an explicitly invoked shell or a script. If invoking a shell, pass result paths as separate positional arguments rather than interpolating filenames into shell source.

The shared format parser supports `{}` (path), `{.}` (path without final extension), `{/}` (basename), `{//}` (parent), and `{/.}` (basename without extension). Tokens may appear inside an argument such as `name={/}`. Double braces produce literal braces. When no token appears anywhere in an execution template, an implicit `{}` argument is appended. Empty templates are rejected.

Expansion produces `OsString` arguments, preserving native path representation without terminal escaping. Custom separator replacement affects expanded path tokens, not fixed text. The [formatting page](../output/rendering-and-formatting.md) explains the shared transformations and contrasts them with output formats, which do not append an implicit token.

Implicit current-directory execution retains a `./` path prefix by default. `--strip-cwd-prefix` changes that policy, with protection against exposing a leading dash when stripping the full result path. Basename placeholders intentionally produce basenames, so use the target command's `--` delimiter when its argument syntax requires it.

## Per-result workers and stdio

The receiver creates `config.threads` per-result workers sharing cloned channel receivers. Each accepted entry is consumed by one worker, which expands and executes its command set. With more than one thread, child stdout and stderr are captured, accumulated for that result, and written while holding fd's stdout/stderr locks. This prevents different results' captured output from interleaving, but it does not preserve a child's original ordering between stdout and stderr. Large child output consumes memory until the result's command set completes or fails.

With one thread, fd spawns and waits without the capture path, allowing intermediate output and interaction. With `-0`, the per-result output buffer writes a NUL to stdout at the end of each result's command output, including in the single-thread path. Batch execution uses inherited stdio and does not pass through that per-result NUL buffer.

A nonzero child exit or spawn failure stops the remaining commands for that result and returns a general error. The worker continues consuming later results and aggregates any error into the final status. Missing executables get a `Command not found` diagnostic; other execution errors get a `Problem while executing command` diagnostic. fd returns status 1 for these errors instead of forwarding the child's exact numeric exit code.

## Batch expansion and splitting

Batch templates require a fixed executable and at most one placeholder-bearing argument. The validation counts arguments containing tokens, so several tokens embedded within one argument are distinct from tokens in two arguments. Each result expands the one path-bearing argument once; fixed arguments before it are prefixes, and fixed arguments after it are appended to every launched batch. If there is no token, the implicit trailing `{}` supplies the path-bearing argument.

`CommandBuilder::push` flushes a batch before adding a result if the configured positive batch size is reached or `argmax` says the argument plus fixed suffix would exceed command-line capacity. Zero batch size means no user count limit, while operating-system argument limits still apply. A final flush executes any remaining paths. No matches means no child invocation.

```sh
fd -t f -e rs --batch-size 50 -X wc -l '{}'
```

Each repeated `-X` template has its own builder. Small searches commonly launch these once each at the final flush; size or OS limits may cause earlier executions while results are still arriving. Do not assume a global phase in which one repeated command always processes all paths before the next starts.

A failed child status is remembered and later batches can continue. Argument-building or spawn I/O errors instead return early from batch execution. The final status merges builder failures. `--list-details` uses the same machinery; on macOS/BSD it can prefer `gls`, and on Windows it requires GNU `ls` to be available.

## Tests and extension seams

Change command collection and CLI conflicts in `src/cli.rs`, template validation and batching in `src/exec/mod.rs`, per-result iteration in `src/exec/job.rs`, and capture/error handling in `src/exec/command.rs`. New placeholder behavior belongs in the shared `src/fmt/` layer and should remain consistent with `--format`.

`test_exec`, `test_exec_multi`, `test_exec_nulls`, `test_exec_batch`, `test_exec_batch_multi`, `test_exec_batch_with_limit`, `test_exec_with_separator`, `test_exec_invalid_utf8`, and `test_list_details` cover user-facing behavior. Unit tests pin brace escaping, implicit tokens, placeholder executable restrictions, and batch token restrictions. See [development and testing](../development/build-test-release.md) for harness normalization and platform exclusions.
