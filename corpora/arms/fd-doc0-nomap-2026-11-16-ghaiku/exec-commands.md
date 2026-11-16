---
title: "Running Commands"
---
## Overview

`--exec` and `--exec-batch` replace the printer with a command. A `CommandSet` holds the parsed command and its mode, and `receive` in the walk chooses how the results reach it: one job thread pool for `--exec`, one batch loop for `--exec-batch`. The placeholders in the command come from [[Format Templates]]; the channel that delivers the results is described in [[Result Streaming]].

Sources: [src/exec/mod.rs:22-34](repo://src/exec/mod.rs#L22-L34), [src/walk.rs:408-441](repo://src/walk.rs#L408-L441)

## One command per result

With `--exec`, `receive` starts `threads` job threads. Each thread takes results from the shared channel and runs `CommandSet::execute` for each, so commands run in parallel and in no fixed order. A walker error is shown only with `--show-errors` and is otherwise skipped. The thread's exit codes are merged into one.

Sources: [src/walk.rs:412-431](repo://src/walk.rs#L412-L431), [src/exec/job.rs:11-44](repo://src/exec/job.rs#L11-L44)

For each result, `execute` builds one command per template in the set, and `execute_commands` runs them in order. Output is buffered per result only when there is more than one thread; a single-threaded run leaves the child's stdio inherited so that its output appears live. A command that exits non-zero, or cannot be started, ends the list for that result and sets `GeneralError`; the job then goes on to the next result.

Sources: [src/exec/mod.rs:76-88](repo://src/exec/mod.rs#L76-L88), [src/exec/command.rs:60-99](repo://src/exec/command.rs#L60-L99), [src/exec/job.rs:11-14](repo://src/exec/job.rs#L11-L14)

Buffered output is kept in an `OutputBuffer`, created for each result. Each command's stdout and stderr are pushed onto it, and `write` copies them to the process's stdout and stderr while holding both locks, so one result's output is not interleaved with another's. With `--print0`, `write` ends the result with a NUL byte even when the command printed nothing.

Sources: [src/exec/command.rs:9-29](repo://src/exec/command.rs#L9-L29), [src/exec/command.rs:30-53](repo://src/exec/command.rs#L30-L53)

## Batches

`--exec-batch` runs on the receiver thread alone. `exec::batch` maps each result to its stripped path and passes the stream to `execute_batch`, which pulls paths as they arrive. For each command in the set, a `CommandBuilder` keeps a command open, adds the generated path argument to it, and runs it when the batch is full.

Sources: [src/exec/job.rs:46-64](repo://src/exec/job.rs#L46-L64), [src/exec/mod.rs:90-123](repo://src/exec/mod.rs#L90-L123)

`CommandBuilder` splits its arguments into three groups: the fixed arguments before the placeholder, the one argument that holds placeholders, and the fixed arguments after it. The path argument is added once per result. `push` closes the current command first when `--batch-size` is reached or when the next argument would overflow the operating system's limit, which `argmax::Command` checks with `args_would_fit`.

Sources: [src/exec/mod.rs:125-163](repo://src/exec/mod.rs#L125-L163), [src/exec/mod.rs:173-189](repo://src/exec/mod.rs#L173-L189)

`finish` runs the open command with its trailing arguments, records `GeneralError` if it fails, and starts a new command with the same leading arguments. A failed batch does not stop the later ones. Because the leading arguments are rebuilt, each batch has the same program and options.

Sources: [src/exec/mod.rs:191-213](repo://src/exec/mod.rs#L191-L213), [src/exec/mod.rs:51-70](repo://src/exec/mod.rs#L51-L70)

## Thread limits and exit codes

The sender's batch size depends on the mode. Only `--exec` on more than one thread uses a batch size of one, so that each result reaches whichever job thread is free; every other case, including `--exec-batch` and single-threaded `--exec`, keeps the usual 256 entries per batch.

Sources: [src/walk.rs:446-456](repo://src/walk.rs#L446-L456)

Exit codes from job threads, batch builders and the one-by-one loop are merged with `merge_exitcodes`, so one failed command makes the whole run return `GeneralError`. A command that cannot be found is reported as `Command not found: <name>`, and its failure counts the same way.

Sources: [src/exec/command.rs:101-115](repo://src/exec/command.rs#L101-L115), [src/walk.rs:431-441](repo://src/walk.rs#L431-L441), [src/exit_codes.rs:46-51](repo://src/exit_codes.rs#L46-L51)
