---
type: workflow
title: Running commands on search results
description: Per-result and batch command execution, shared path templates, concurrency, argument-size limits, output buffering, and failure propagation.
tags: [execution, commands, templates, batching, concurrency]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:26:52.841Z
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
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "codex", at: "2026-11-16T07:26:52.841Z" }
---

# Running commands on search results

`fd` can pass matched paths directly to child processes. `--exec` (`-x`) runs a command set for each result; `--exec-batch` (`-X`) expands multiple results into command arguments. Both consume the same filtered entries as listing, through the receiver dispatch in `walk.rs`. [Dispatch](../../src/walk.rs#L406-L439).

## CLI usage and boundaries

Put the command option after search roots and other fd options:

```sh
fd -t f -e rs . src -x wc -l
fd -t f -e rs . src -X wc -l
fd -t f -e rs --threads=1 . src -x wc -l
```

Arguments following `-x`/`-X`, including hyphenated arguments, belong to the child command until a literal semicolon terminator. In a shell, escape that terminator as `\;`. Repeated command options form a command set, for example `fd -e rs . src -x echo '{}' \; -x echo '{/}'`. The two execution modes conflict, and neither combines with `--list-details`. [CLI wiring](../../src/cli.rs#L861-L950).

Templates are argument vectors rather than shell scripts. The executable is passed to `Command::new`, with generated arguments added individually. Shell aliases, shell functions, pipes, and redirection are not implicitly interpreted. When shell syntax is needed, explicitly invoke a shell and pass paths as positional arguments rather than interpolating them into shell source. [Command creation](../../src/exec/mod.rs#L164-L170), [per-result generation](../../src/exec/mod.rs#L266-L271).

## Shared path templates

The formatter is shared with `--format` listing output:

| Placeholder | Expansion for `docs/report.txt` |
| --- | --- |
| `{}` | `docs/report.txt` |
| `{/}` | `report.txt` |
| `{//}` | `docs` |
| `{.}` | `docs/report` |
| `{/.}` | `report` |
| `{{` / `}}` | Literal braces |

Templates parse once into text and placeholder tokens using a cached matcher. Generation returns an `OsString`, preserving OS path representation for arguments. Custom separator replacement applies to placeholder-derived paths, not literal template text. If no placeholder-bearing argument exists, command construction appends an implicit `{}`. Empty command templates are rejected. [Template engine](../../src/fmt/mod.rs#L46-L140), [command validation](../../src/exec/mod.rs#L220-L255).

Per-result execution permits a placeholder in the executable position. Batch mode requires a fixed executable and at most one placeholder-bearing argument. The implementation counts arguments containing tokens, not individual placeholder occurrences: multiple tokens inside the same argument do not increase that count. This permits a single per-path argument template while avoiding multiple separately expanded argument groups. [Batch validation](../../src/exec/mod.rs#L51-L69), [template validation/counting](../../src/exec/mod.rs#L245-L260).

## Per-result execution

The receiver starts as many command workers as the configured thread count. Each consumes entries, generates its command set, and waits for those commands for that entry. Entries run in parallel and discovery/execution order is not guaranteed. `--threads=1` makes command execution sequential, but does not promise lexical order. [Pool](../../src/walk.rs#L415-L432), [worker loop](../../src/exec/job.rs#L11-L43).

With multiple threads, each entry's stdout and stderr are captured, then written while holding both stream locks. This keeps output from fd-managed entries grouped but buffers potentially large child output in memory. With one thread, children are spawned without that capture path so intermediate output and interaction are possible. `--print0` adds a NUL after each entry's command-set output. Child-produced bytes do not pass through fd's filename sanitizer. [Execution and output buffers](../../src/exec/command.rs#L18-L98).

A failed command stops the remaining commands for that entry. The worker still consumes later entries and merges statuses; any failed entry results in general error. Spawn failures produce an execution diagnostic, with a specific “Command not found” message for missing executables. The exact child exit code is not propagated. [Failure control](../../src/exec/command.rs#L60-L114), [aggregation](../../src/exec/job.rs#L19-L43).

## Batch execution and argument limits

Each batch command has fixed arguments before and after its one path-bearing template. For each result, the builder generates one argument and checks both `--batch-size` and operating-system argument capacity through `argmax`. It flushes when the configured positive count is reached or the next argument plus trailing fixed arguments would not fit. A zero batch-size imposes no count cap, but argument-size limits still apply. Thus `-X` can launch multiple processes even when the intent is to process all matches together. [Builders](../../src/exec/mod.rs#L125-L188).

Flushing runs only a nonempty batch, waits for its status, records failure, and resets the builder. No matches means no batch command is run. Batch children inherit stdin, stdout, and stderr and run synchronously as builders flush; the per-result execution pool and output buffer are not used. A nonzero child exit is remembered while processing can continue, whereas an argument-building or spawn I/O error returns early. With multiple batch templates, flushing depends on each builder's limits; there is no global “finish command A for every result, then command B” barrier. [Batch loop](../../src/exec/mod.rs#L90-L120), [flush](../../src/exec/mod.rs#L164-L207).

## Detailed listing as an integration

`--list-details` constructs a batch command for an external `ls`. Most Unix targets select GNU-style `ls`; macOS/BSD paths probe `gls` and otherwise choose BSD arguments. Windows requires a discoverable GNU `ls` or reports that detailed listing is unsupported. This behavior inherits command execution's batching and process failures rather than being an alternate Rust metadata renderer. [Command selection](../../src/main.rs#L395-L493).

## Regression and related guides

`test_exec_multi` covers repeated per-result commands and `test_exec_batch_with_limit` checks bounded batches through actual output. `exec` unit tests cover missing commands, placeholder placement, and batch rejection. Run targeted cases with `cargo test --locked --test tests test_exec` and binary unit tests with `cargo test --locked --bin fd exec::`. Consult the [testing guide](../testing/contributor-guide.md) for platform skips and assertion limits, [output and pipelines](../integrations/output-and-pipelines.md) for listing behavior, and the [pipeline architecture](../architecture/search-pipeline.md) for result transport.
