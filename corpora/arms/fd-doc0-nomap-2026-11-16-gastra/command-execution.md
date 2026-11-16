---
title: "Command Execution"
---
## Overview

Command execution replaces the normal path-printing consumer with subprocess work. `--exec` runs a command set for each accepted entry, while `--exec-batch` accumulates path arguments for batch commands. Both consume the entries already selected by [[Search Patterns and Paths]] and [[Result Filters]] through the channel described in [[Traversal and Ignore Rules]]. They do not run the normal formatted-path renderer; the shared placeholder language is documented in [[Output and Formatting]].

Sources: [src/walk.rs:408-438](repo://src/walk.rs#L408-L438), [src/exec/job.rs:11-64](repo://src/exec/job.rs#L11-L64), [src/exec/mod.rs:228-233](repo://src/exec/mod.rs#L228-L233)

## Supply commands on the command line

`-x` and `-X` accept one or more command arguments, including arguments beginning with dashes. The parser treats a semicolon as the end of one command occurrence; in a shell, escape that semicolon so it reaches fd. Place execution options last unless using that terminator, because subsequent positional values belong to the command rather than the fd search. Repeating an execution option builds a command set in occurrence order.

Sources: [src/cli.rs:861-873](repo://src/cli.rs#L861-L873), [src/cli.rs:883-908](repo://src/cli.rs#L883-L908), [src/cli.rs:921-930](repo://src/cli.rs#L921-L930), [src/exec/mod.rs:35-69](repo://src/exec/mod.rs#L35-L69)

```bash
fd . src -x echo
fd -e rs -X wc -l
```

Sources: [src/cli.rs:914-915](repo://src/cli.rs#L914-L915), [src/cli.rs:947-948](repo://src/cli.rs#L947-L948)

The modes conflict with one another and with long listing. The CLI execution group also rejects quiet and result-limit options. `--batch-size` requires an explicit batch command. These constraints are resolved by argument parsing, and command-template construction errors are converted into Clap invalid-value errors before the filesystem scan begins.

Sources: [src/cli.rs:29-30](repo://src/cli.rs#L29-L30), [src/cli.rs:498-508](repo://src/cli.rs#L498-L508), [src/cli.rs:861-873](repo://src/cli.rs#L861-L873), [src/cli.rs:892-892](repo://src/cli.rs#L892-L892), [src/cli.rs:930-930](repo://src/cli.rs#L930-L930), [src/main.rs:75-111](repo://src/main.rs#L75-L111)

## Validate and expand templates

Every command argument is parsed with the shared `FormatTemplate` language from [[Output and Formatting]]. If the entire command contains no placeholder-bearing argument, the command layer appends an implicit path placeholder. Empty command input is rejected so an omitted executable cannot accidentally turn discovered entries into commands. In per-entry mode, a placeholder in the executable position is permitted; batch mode requires a fixed executable.

Sources: [src/exec/mod.rs:219-255](repo://src/exec/mod.rs#L219-L255)

Batch validation rejects more than one placeholder-bearing argument. Although the diagnostic says only one placeholder is allowed, the implementation counts arguments whose templates have tokens, rather than individual tokens inside one argument. The accepted variable argument is expanded once for every result; fixed arguments before and after it are stored separately. This ensures trailing fixed options remain after the collected path arguments when the batch runs.

Sources: [src/exec/mod.rs:51-69](repo://src/exec/mod.rs#L51-L69), [src/exec/mod.rs:135-161](repo://src/exec/mod.rs#L135-L161), [src/exec/mod.rs:191-199](repo://src/exec/mod.rs#L191-L199), [src/exec/mod.rs:258-260](repo://src/exec/mod.rs#L258-L260)

Per-entry generation creates an `argmax::Command` from the generated first argument and adds each subsequent generated argument directly. There is no intervening shell parsing step in that code. Commands receive the entry's display-path form and optional separator transformation; the prefix rules described in [[Output and Formatting]] therefore apply to command inputs as well. Terminal color, hyperlink wrapping, and display sanitization are not applied to those arguments.

Sources: [src/exec/mod.rs:266-271](repo://src/exec/mod.rs#L266-L271), [src/exec/job.rs:33-39](repo://src/exec/job.rs#L33-L39), [src/fmt/mod.rs:112-140](repo://src/fmt/mod.rs#L112-L140), [src/walk.rs:412-438](repo://src/walk.rs#L412-L438)

## Run commands per entry

The receiver starts as many job threads as the configured thread count. Each clones the result receiver, takes entries, and executes the command set for one entry before taking another. Execution order across entries is not guaranteed; `--threads=1` makes command execution sequential but does not sort the walker stream. Within an entry, command templates are generated in stored order and executed in sequence.

Sources: [src/walk.rs:416-431](repo://src/walk.rs#L416-L431), [src/exec/job.rs:19-40](repo://src/exec/job.rs#L19-L40), [src/exec/mod.rs:76-87](repo://src/exec/mod.rs#L76-L87), [src/exec/command.rs:65-98](repo://src/exec/command.rs#L65-L98), [src/cli.rs:895-896](repo://src/cli.rs#L895-L896)

With multiple threads, the job enables output buffering: each child runs through `output()`, and its stdout and stderr are collected. After the entry's command sequence finishes, the buffer takes stdout and stderr locks and writes the collected outputs, preventing another job's buffered output from interleaving while those locks are held. With one thread, spawning and waiting uses the direct-output path so intermediate output and interaction remain available.

Sources: [src/exec/job.rs:16-17](repo://src/exec/job.rs#L16-L17), [src/exec/command.rs:30-55](repo://src/exec/command.rs#L30-L55), [src/exec/command.rs:71-98](repo://src/exec/command.rs#L71-L98)

`--print0` adds a NUL to stdout after the output associated with an entry, including when the child's output was direct rather than captured. It does not replace the child's own line endings. Writes from `OutputBuffer` discard write errors, so this path does not implement the same output-error reporting as the normal printing receiver. The distinction matters when interpreting fd's status after a command pipeline closes early.

Sources: [src/exec/job.rs:33-39](repo://src/exec/job.rs#L33-L39), [src/exec/command.rs:30-55](repo://src/exec/command.rs#L30-L55), [src/walk.rs:251-258](repo://src/walk.rs#L251-L258)

## Build and execute batches

The batch consumer removes traversal-error records from the stream and converts accepted entries to owned paths. For every configured template, `execute_batch` creates a `CommandBuilder` with fixed leading arguments, one variable argument template, fixed trailing arguments, and an accumulated status. Batch commands inherit stdin, stdout, and stderr. Paths are fed to every builder as they arrive, so argument order follows discovery rather than a sorted print buffer.

Sources: [src/exec/job.rs:46-64](repo://src/exec/job.rs#L46-L64), [src/exec/mod.rs:90-119](repo://src/exec/mod.rs#L90-L119), [src/exec/mod.rs:135-170](repo://src/exec/mod.rs#L135-L170), [src/cli.rs:933-934](repo://src/cli.rs#L933-L934)

```mermaid
flowchart TD
  path["Next result path"] --> count["Configured batch limit reached?"]
  count -->|yes| flush["Run current nonempty batch and reset"]
  count -->|no| fit["New argument plus trailing arguments fit?"]
  flush --> fit
  fit -->|no| space["Run current nonempty batch and reset"]
  fit -->|yes| append["Append expanded argument"]
  space --> append
  append --> next["Continue consuming paths"]
  next --> end["At end, run remaining nonempty batch"]
```

Sources: [src/exec/mod.rs:100-116](repo://src/exec/mod.rs#L100-L116), [src/exec/mod.rs:173-202](repo://src/exec/mod.rs#L173-L202)

Before adding a path, the builder flushes if a positive `--batch-size` has been reached. It also checks whether the next generated argument plus trailing fixed arguments fit the operating-system command limit, flushing if necessary. Zero removes the configured count limit but does not disable this command-length check. A flush runs only when the count is positive, so an empty result stream launches no batch command. The final pass flushes any remaining arguments.

Sources: [src/cli.rs:492-508](repo://src/cli.rs#L492-L508), [src/exec/mod.rs:100-116](repo://src/exec/mod.rs#L100-L116), [src/exec/mod.rs:173-202](repo://src/exec/mod.rs#L173-L202)

## Aggregate failures

For a single entry, failure to generate or launch a command stops that entry's sequence. A child status other than code zero also stops the sequence after flushing collected output. The job remembers that failure but continues processing later entries. Job-thread statuses are merged so any error yields fd's general error status; the child's original numeric exit code is not preserved.

Sources: [src/exec/command.rs:65-98](repo://src/exec/command.rs#L65-L98), [src/exec/job.rs:19-43](repo://src/exec/job.rs#L19-L43), [src/walk.rs:430-431](repo://src/walk.rs#L430-L431), [src/exit_codes.rs:14-21](repo://src/exit_codes.rs#L14-L21), [src/exit_codes.rs:46-50](repo://src/exit_codes.rs#L46-L50)

Batch child failure records general error in its builder, then resets the command and continues collecting paths. In contrast, builder construction, argument insertion, or spawn-related I/O failure returns immediately through `handle_cmd_error`. A missing executable receives a command-not-found diagnostic when the command is available; other failures get a general execution diagnostic. Successfully completed builders have their statuses merged at the end.

Sources: [src/exec/mod.rs:94-119](repo://src/exec/mod.rs#L94-L119), [src/exec/mod.rs:191-206](repo://src/exec/mod.rs#L191-L206), [src/exec/command.rs:101-113](repo://src/exec/command.rs#L101-L113)

## Long listings use batch execution

`--list-details` constructs an internal batch command when no explicit command exists. On most Unix targets it selects `ls -l -h -d` with an explicit color choice. On macOS and the listed BSD targets, it probes `gls --version` and uses GNU-style arguments if that command launches; otherwise it selects BSD `ls`, adding `-G` for color except on NetBSD and OpenBSD. The `-d` option lists matching directories themselves rather than their contents.

Sources: [src/main.rs:395-429](repo://src/main.rs#L395-L429), [src/main.rs:430-469](repo://src/main.rs#L430-L469)

On Windows, the implementation probes `ls --version` and uses GNU-style arguments if the status call returns successfully; otherwise it reports that GNU `ls` is required. Other unsupported platforms return an explicit error. Because long listing becomes a `CommandSet`, it inherits batch execution, output inheritance, and failure aggregation rather than the normal fd path renderer.

Sources: [src/main.rs:395-409](repo://src/main.rs#L395-L409), [src/main.rs:470-493](repo://src/main.rs#L470-L493), [src/walk.rs:412-415](repo://src/walk.rs#L412-L415), [src/exec/mod.rs:164-170](repo://src/exec/mod.rs#L164-L170), [src/exec/mod.rs:191-206](repo://src/exec/mod.rs#L191-L206)
