---
type: workflow
title: Executing commands over search results
description: Per-result and batch execution, placeholder expansion, argument limits, concurrent output and command failure semantics.
tags: [execution, commands, batching, shell, placeholders]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:13:39.635Z
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
generated: { by: "codex", at: "2026-11-16T17:13:39.635Z" }
---

# Executing commands over search results

Execution replaces fd's normal printing receiver. Search workers still apply the same traversal and matching rules, but matching entries become process arguments through `CommandSet` and `FormatTemplate`.

## Choose the execution mode

```sh
# One command per Rust file
fd -t f -e rs -x wc -l

# Pass Rust files together, splitting when necessary
fd -t f -e rs -X wc -l

# Run per-result commands sequentially
fd --threads=1 -t f -e rs -x wc -l
```

`-x` / `--exec` starts a pool of consumers sized by `--threads`. Each consumes entries and executes the configured command sequence for one result. `-X` / `--exec-batch` feeds one batch-execution path. Traversal and command/argument order are not guaranteed. A single thread provides sequential execution, not an alphabetical ordering contract. See [receiver selection](../../src/walk.rs#L408-L439) and [CLI execution contract](../../src/cli.rs#L883-L949).

Put execution options last because following positional arguments belong to the command. An escaped semicolon, `\;` in a POSIX shell, terminates a template so fd options or another command can follow. Repeated `-x` commands form a sequence per entry; repeated `-X` commands create separate batch builders. The two modes conflict with each other and with `--list-details`.

## Templates and process arguments

| Placeholder | Expansion for `src/example.rs` |
| --- | --- |
| `{}` | `src/example.rs` |
| `{/}` | `example.rs` |
| `{//}` | `src` |
| `{.}` | `src/example` |
| `{/.}` | `example` |
| `{{`, `}}` | Literal opening or closing brace |

If a command has no placeholder, fd appends an implicit `{}` argument. Empty command templates are rejected. A per-result command may use a placeholder as its executable; batch mode requires a fixed executable. Batch validation permits only one argument containing placeholders, although that argument may itself contain multiple token expansions. See [template validation](../../src/exec/mod.rs#L220-L271) and [batch validation](../../src/exec/mod.rs#L51-L68).

Templates build `OsString` arguments and pass them to `argmax::Command`; fd does not invoke a shell automatically. Shell functions, aliases, pipelines and redirection therefore require an explicitly selected shell when needed. A path with spaces remains one expanded argument. Separator replacement applies to path tokens, not literal template text. See [format generation](../../src/fmt/mod.rs#L109-L140) and [command generation](../../src/exec/mod.rs#L266-L271).

Execution normally retains the current-directory prefix. Even when stripping is requested, `DirEntry` preserves the original path if stripping would expose a leading dash, avoiding accidental option interpretation in downstream commands. See [prefix default](../../src/main.rs#L389-L390) and [path protection](../../src/dir_entry.rs#L56-L79).

## Per-result concurrency and errors

With more than one execution thread, each result's command outputs are captured and written while holding stdout and stderr locks. This groups outputs from that result's command sequence and avoids interleaving from other fd execution workers; it consumes memory proportional to captured output. With one thread, output is not captured, permitting intermediate output and interaction. See [job loop](../../src/exec/job.rs#L11-L43) and [OutputBuffer](../../src/exec/command.rs#L18-L98).

A nonzero or signaled child status stops the remaining commands for that entry and records fd's general error status. The worker continues processing other entries, and merged worker statuses fail if any command failed. A missing executable emits a command-not-found diagnostic. The child's numeric failure code is not forwarded verbatim: general failure maps to 1. `--print0` adds a NUL after each entry's command output in this per-result path. See [execution errors](../../src/exec/command.rs#L60-L114) and [exit-code mapping](../../src/exit_codes.rs#L14-L21).

## Batch size and argument capacity

Each batch builder separates fixed leading arguments, one expandable argument and fixed trailing arguments. It expands that argument once per path. Before appending, it checks both a positive `--batch-size` limit and `argmax` capacity including trailing arguments. A full batch runs synchronously and resets the command. A zero batch-size removes the count limit but not operating-system argument limits. No command runs for an empty batch, including a search with no matches. See [CommandBuilder](../../src/exec/mod.rs#L135-L203).

Batch commands inherit stdin/stdout/stderr. A child returning failure records an error but later batches can still run. An I/O error while building or running a command returns early from batch execution. With repeated `-X` templates, builders can flush at different times, so do not assume a per-file sequence like repeated `-x`. See [batch orchestration](../../src/exec/mod.rs#L90-L119).

## Detailed listings and verification

`--list-details` constructs a batch command using `ls -l -h -d`. On GNU-style Unix systems it adds a color option; on macOS/BSD it probes `gls` before choosing BSD `ls` flags. Windows requires an available GNU `ls` or setup fails. This behavior belongs to execution and depends on an external program. See [list command selection](../../src/main.rs#L395-L493).

Useful regressions include `test_exec_multi`, `test_exec_nulls`, `test_exec_batch_multi`, `test_exec_batch_with_limit` and `test_exec_invalid_utf8`. Unit tests cover escaped braces, implicit placeholders, multiple batch placeholder arguments and executable validation. The batch-limit test inspects raw stdout before sorting paths, so it verifies the size of each invocation as well as result membership. See [tests](../../tests/tests.rs#L2065-L2098) and [template unit tests](../../src/exec/mod.rs#L406-L443).

Related: [output and shell pipelines](output-and-pipelines.md), [search pipeline](../architecture/search-pipeline.md), [build and test guide](../operations/build-test-release.md).
