---
title: "Running Commands"
---
## Overview

With `--exec` or `--exec-batch` set, the receiver does not print. Instead, `receive` starts one job thread per configured thread, and each job takes entries from the same channel and runs the command for each one. With `--exec-batch`, one thread collects the paths and runs the command over groups of them. Both paths use the templates of [[Exec Templates]] to build the commands.

Sources: [src/walk.rs:408-438](repo://src/walk.rs#L408-L438), [src/exec/job.rs:9-11](repo://src/exec/job.rs#L9-L11)

## One command per entry

`job` loops over the entries of its share of the channel. For each entry it calls `CommandSet::execute` with the presented path, the path separator and the NUL setting. It merges each command's exit code into one code for the job, and a walk error on the channel is printed and skipped.

Sources: [src/exec/job.rs:18-43](repo://src/exec/job.rs#L18-L43), [src/exec/mod.rs:76-88](repo://src/exec/mod.rs#L76-L88)

`execute` generates one `Command` for each template in the set and hands the iterator to `execute_commands`. The commands of one entry run in order, and a command that fails stops the rest of that entry's commands. The job then moves on to the next entry, so one failure does not stop the search.

Sources: [src/exec/command.rs:60-99](repo://src/exec/command.rs#L60-L99), [src/exec/mod.rs:76-88](repo://src/exec/mod.rs#L76-L88)

When the job runs more than one thread, each command's output is captured with `cmd.output()` and held in an `OutputBuffer`. The buffer is written to stdout and stderr together, after the command ends, while the thread holds the stdout and stderr locks. This keeps the output of concurrent commands from interleaving, and with NUL output a NUL byte closes each entry's block.

Sources: [src/exec/job.rs:17-18](repo://src/exec/job.rs#L17-L18), [src/exec/command.rs:13-57](repo://src/exec/command.rs#L13-L57), [src/exec/command.rs:60-86](repo://src/exec/command.rs#L60-L86)

With one thread, the command is spawned and waited for without capturing its output, so its output appears as it is produced. Nothing is buffered, so an interactive command can be used.

Sources: [src/exec/job.rs:17-18](repo://src/exec/job.rs#L17-L18), [src/exec/command.rs:71-78](repo://src/exec/command.rs#L71-L78)

A command that exits with a non-zero status makes the job return `GeneralError`, and a command that cannot be started reports "Command not found" when the program is missing, or the error otherwise. Both give the run an error exit code; the walk itself is unaffected.

Sources: [src/exec/command.rs:86-115](repo://src/exec/command.rs#L86-L115)

## Batch mode

`batch` converts each entry to its presented path and calls `execute_batch` with the batch size from the configuration and the path separator. A walk error is printed and skipped, as in the one-by-one job.

Sources: [src/exec/job.rs:46-63](repo://src/exec/job.rs#L46-L63)

`execute_batch` makes one `CommandBuilder` per command in the set, then pushes each path into every builder. A builder keeps the fixed arguments before the placeholder, the placeholder itself, and the arguments after it. A path is added as a new argument. When the batch size limit is reached, or when the next path would overflow the operating system's argument size limit, the builder runs the command with the paths collected so far and starts a new one.

Sources: [src/exec/mod.rs:90-123](repo://src/exec/mod.rs#L90-L123), [src/exec/mod.rs:125-171](repo://src/exec/mod.rs#L125-L171), [src/exec/mod.rs:173-188](repo://src/exec/mod.rs#L173-L188)

`finish` runs the collected command with the trailing arguments appended and waits for it, so a batch command's output is not captured. A non-zero status sets the builder's exit code to `GeneralError`. The command is then rebuilt from the fixed arguments for the next group.

Sources: [src/exec/mod.rs:191-203](repo://src/exec/mod.rs#L191-L203)

## Thread count and ordering

A batch always runs on one thread, so the batch receiver in `receive` consumes the whole channel. For one-by-one execution, the sender's batch limit drops to one entry per batch when there is more than one thread, so the work is spread across the job threads rather than handed to one of them in a block.

Sources: [src/walk.rs:408-412](repo://src/walk.rs#L408-L412), [src/walk.rs:449-456](repo://src/walk.rs#L449-L456)

The output of an `--exec` run comes in the order the commands finish, not in path order. Only the printing path sorts results, see [[Result Buffering and Exit Codes]].

Sources: [src/walk.rs:408-438](repo://src/walk.rs#L408-L438), [src/walk.rs:281-291](repo://src/walk.rs#L281-L291)
