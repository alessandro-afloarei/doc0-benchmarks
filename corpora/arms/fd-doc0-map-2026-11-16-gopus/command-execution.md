---
title: "Command Execution"
---
## Overview

Instead of printing results, fd can run a command on them. `-x`/`--exec` runs the command once per result, in parallel, and `-X`/`--exec-batch` runs it once with all results as arguments. `-l`/`--list-details` is a built-in batch command that runs `ls` in long format. All three produce a `CommandSet` in `src/exec/mod.rs`, which `Config.command` holds; when it is set, the receiver hands results to `exec::job` or `exec::batch` instead of printing them ([[Result Buffering and Exit Codes]]).

Sources: [README.md:154-160](repo://README.md#L154-L160), [src/exec/mod.rs:20-33](repo://src/exec/mod.rs#L20-L33), [src/walk.rs:408-433](repo://src/walk.rs#L408-L433)

This page follows a command template from the command line to the processes fd starts. The placeholders inside the template, such as `{}` and `{/.}`, are parsed and expanded as described on [[Format Templates]].

Sources: [src/exec/mod.rs:219-256](repo://src/exec/mod.rs#L219-L256)

## Building a CommandSet

### From the command line

The hand-written `Exec` argument parser collects every `-x` occurrence, each a list of strings ending at the next `;` (written `\;` in a shell), and calls `CommandSet::new`, or `CommandSet::new_batch` for `-X`. Repeating `-x` gives several commands that all run for each result. `-x`, `-X` and `-l` conflict with each other, and with `--max-results`, `--quiet` and `-1` ([[Command-Line Options and Config]]).

Sources: [src/cli.rs:861-880](repo://src/cli.rs#L861-L880), [src/cli.rs:882-952](repo://src/cli.rs#L882-L952), [src/cli.rs:29-30](repo://src/cli.rs#L29-L30)

### Validating a template

`CommandTemplate::new` parses each argument into a `FormatTemplate` and enforces three rules.

Sources: [src/exec/mod.rs:219-234](repo://src/exec/mod.rs#L219-L234)

- An empty template is an error, "No executable provided for --exec or --exec-batch"; the comment explains that otherwise fd would try to execute each file it finds, and that clap cannot express this check.
- In batch mode the first argument must be a fixed executable; `--exec` allows a placeholder there, so `fd -x {}` runs each result.
- If no argument contains a placeholder, a `{}` argument is appended at the end.

Sources: [src/exec/mod.rs:219-256](repo://src/exec/mod.rs#L219-L256), [src/exec/mod.rs:437-443](repo://src/exec/mod.rs#L437-L443)

`new_batch` additionally refuses a template with more than one placeholder argument, "Only one placeholder allowed for batch commands", because every result is inserted at a single position.

Sources: [src/exec/mod.rs:51-70](repo://src/exec/mod.rs#L51-L70), [src/exec/mod.rs:420-423](repo://src/exec/mod.rs#L420-L423)

## Per-result execution

### Job threads

For `--exec`, `receive` starts `config.threads` scoped threads, each running `exec::job` on its own clone of the result channel, and merges their exit codes. Sender threads use a batch limit of 1 in this mode so that results are spread evenly over the job threads ([[Parallel Directory Walk]]). The help text warns that commands run in no guaranteed order, and the README recommends `--threads=1` for serial execution.

Sources: [src/walk.rs:415-432](repo://src/walk.rs#L415-L432), [src/walk.rs:449-457](repo://src/walk.rs#L449-L457), [src/cli.rs:894-899](repo://src/cli.rs#L894-L899), [README.md:238-241](repo://README.md#L238-L241)

`job` loops over the results. Walk errors are printed with `--show-errors` and skipped; each entry calls `CommandSet::execute` with its `stripped_path`, the custom path separator and the `--print0` flag, and the exit code is merged into the job's result.

Sources: [src/exec/job.rs:8-44](repo://src/exec/job.rs#L8-L44)

### Running the commands

`execute` generates one `argmax::Command` per template with `CommandTemplate::generate`, expanding each argument for the path, and passes them to `execute_commands`. The commands for one result run in sequence; the first that fails to start, or exits with a status other than 0, ends that result's run with `GeneralError`, and the remaining commands for that result are skipped.

Sources: [src/exec/mod.rs:76-88](repo://src/exec/mod.rs#L76-L88), [src/exec/mod.rs:266-272](repo://src/exec/mod.rs#L266-L272), [src/exec/command.rs:59-99](repo://src/exec/command.rs#L59-L99)

### Output buffering

With more than one thread, `job` enables output buffering: `execute_commands` runs each command with `output()`, collects its stdout and stderr in an `OutputBuffer`, and writes them only after the result's commands finish. `OutputBuffer::write` holds the stdout and stderr locks while it writes every collected output, so the output of parallel commands is never interleaved; the README calls this out as making `fd -x` usable to parallelize work such as `md5sum` over many files.

Sources: [src/exec/job.rs:16-17](repo://src/exec/job.rs#L16-L17), [src/exec/command.rs:9-57](repo://src/exec/command.rs#L9-L57), [README.md:209-214](repo://README.md#L209-L214)

With one thread, output is not buffered: the command is spawned and waited for, which the comment says "allows for viewing and interacting with intermediate command output". With `--print0`, `write` appends a NUL byte after each result's output, even when nothing was buffered, because the output may have gone straight to stdout.

Sources: [src/exec/command.rs:30-57](repo://src/exec/command.rs#L30-L57), [src/exec/command.rs:71-78](repo://src/exec/command.rs#L71-L78)

## Batch execution

### Collecting arguments

For `--exec-batch` and `--list-details`, the receiver calls `exec::batch` directly. It turns the results into an iterator of `into_stripped_path` paths, printing and dropping walk errors with `--show-errors`, and passes it to `CommandSet::execute_batch` with `--batch-size` and the path separator. Commands start while the walk is still running, as soon as a batch is full.

Sources: [src/walk.rs:412-414](repo://src/walk.rs#L412-L414), [src/exec/job.rs:46-64](repo://src/exec/job.rs#L46-L64)

`execute_batch` creates one `CommandBuilder` per template and pushes every path into every builder, then calls `finish` on each to run what remains. `CommandBuilder::new` splits the template around its placeholder argument: fixed arguments before it are `pre_args`, those after it are `post_args`, and the placeholder argument is `path_arg`. Each new command is created from `pre_args` with stdin, stdout and stderr inherited.

Sources: [src/exec/mod.rs:90-120](repo://src/exec/mod.rs#L90-L120), [src/exec/mod.rs:123-171](repo://src/exec/mod.rs#L123-L171)

### Splitting into several runs

`push` starts a new run of the command in two cases: when `--batch-size` is above zero and the current run already holds that many paths, and when `argmax`'s `args_would_fit` reports that the next path plus the `post_args` would exceed the operating system's command-line limit. `finish` appends `post_args`, runs the command with `status()`, records `GeneralError` if it fails, and starts a fresh command from `pre_args`.

Sources: [src/exec/mod.rs:173-207](repo://src/exec/mod.rs#L173-L207)

The `--batch-size` help matches this: the default of zero means no limit, but "batching might still happen due to OS restrictions on the maximum length of command lines". The option requires `--exec-batch`, and the help notes that argument order is non-deterministic.

Sources: [src/cli.rs:492-508](repo://src/cli.rs#L492-L508), [src/cli.rs:932-934](repo://src/cli.rs#L932-L934)

## Errors and exit codes

`handle_cmd_error` turns an I/O error into `GeneralError` and prints either "Command not found: PROGRAM", when the program does not exist, or "Problem while executing command". In batch mode an error while building or running a command stops `execute_batch` at once; a command that runs but exits unsuccessfully only marks its builder's exit code.

Sources: [src/exec/command.rs:101-115](repo://src/exec/command.rs#L101-L115), [src/exec/mod.rs:100-119](repo://src/exec/mod.rs#L100-L119)

fd's exit code is `GeneralError` if any command failed, and `Success` otherwise; per-thread and per-builder codes are combined with `merge_exitcodes` ([[Result Buffering and Exit Codes]]).

Sources: [src/exec/job.rs:19-43](repo://src/exec/job.rs#L19-L43), [src/exec/mod.rs:116-116](repo://src/exec/mod.rs#L116-L116)

Commands run directly, not through a shell, so shell aliases and functions cannot be used; the README suggests `fd -x bash -c 'my_function "$1"' bash` after `export -f` in bash, and quoting placeholders when a shell would interpret the braces.

Sources: [README.md:439-450](repo://README.md#L439-L450)

## List details

`extract_command` builds a batch `CommandSet` from `determine_ls_command` when `--list-details` is given without `-x` or `-X`. The command depends on the platform.

Sources: [src/main.rs:395-410](repo://src/main.rs#L395-L410)

| Platform | Command |
| --- | --- |
| Unix other than macOS and the BSDs | GNU `ls -l -h -d --color=always` or `--color=never` |
| macOS, DragonFly, FreeBSD, NetBSD, OpenBSD with `gls` | `gls -l -h -d --color=...` |
| Those platforms without `gls` | BSD `ls -l -h -d`, plus `-G` for colour except on NetBSD and OpenBSD |
| Windows with GNU `ls` installed | `ls -l -h -d --color=...` |
| Windows without it, other platforms | error |

Sources: [src/main.rs:412-494](repo://src/main.rs#L412-L494)

The colour argument follows fd's own colour decision. Short options are used "to support more platforms (like BusyBox)", and `-d` lists directories themselves rather than their contents. `--list-details` conflicts with `--absolute-path`, `--print0` and `--format`.

Sources: [src/main.rs:412-429](repo://src/main.rs#L412-L429), [src/cli.rs:227-238](repo://src/cli.rs#L227-L238), [src/cli.rs:266-276](repo://src/cli.rs#L266-L276), [src/cli.rs:481-487](repo://src/cli.rs#L481-L487)
