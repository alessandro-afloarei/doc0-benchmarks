---
title: "Command Execution"
---
## Overview

`--exec` (`-x`) runs a command for every search result and `--exec-batch` (`-X`) runs one command with many results as arguments. Both use a command template whose arguments may contain placeholders such as `{}` and `{/.}`. The same placeholder syntax is used by `--format` when printing, so the parser lives in `src/fmt/mod.rs` and is shared. The code that runs the commands is in `src/exec/`. How results get to these runners over the channel is in [[Result Pipeline and Output]].

Sources: [src/exec/mod.rs:1-33](repo://src/exec/mod.rs#L1-L33), [src/fmt/mod.rs:41-49](repo://src/fmt/mod.rs#L41-L49), [src/walk.rs:408-433](repo://src/walk.rs#L408-L433)

## Parsing the command line

clap cannot return grouped values from a derive, so `Exec` implements `FromArgMatches` by hand. It reads the `exec` occurrences into `CommandSet::new` or, failing that, the `exec_batch` occurrences into `CommandSet::new_batch`. Both options take one or more values, allow hyphen-leading values, end at `;`, and conflict with each other and with `--list-details`. A single occurrence is one command; repeating `-x` builds several commands that are all run for each result. Errors from the constructors become clap `InvalidValue` errors.

Sources: [src/cli.rs:857-880](repo://src/cli.rs#L857-L880), [src/cli.rs:882-893](repo://src/cli.rs#L882-L893), [src/cli.rs:921-930](repo://src/cli.rs#L921-L930)

`CommandTemplate::new` parses each argument with `FormatTemplate::parse` and then checks three rules:

Sources: [src/exec/mod.rs:219-234](repo://src/exec/mod.rs#L219-L234)

- no arguments is an error ("No executable provided"), since fd would otherwise try to execute every file it finds;
- in batch mode, the first argument must be a fixed executable, not a placeholder;
- if no argument has a placeholder, a `{}` token is appended, so `fd -e zip -x unzip` runs `unzip <path>`.

Sources: [src/exec/mod.rs:236-256](repo://src/exec/mod.rs#L236-L256)

`CommandSet::new_batch` adds one more rule: only one argument of a batch command may contain a placeholder.

Sources: [src/exec/mod.rs:51-70](repo://src/exec/mod.rs#L51-L70)

## Placeholder templates

`FormatTemplate` is either `Text` or `Tokens`. `parse` scans with an Aho-Corasick automaton over seven patterns: `{{`, `}}`, `{}`, `{/}`, `{//}`, `{.}` and `{/.}`. Doubled braces are escapes for literal braces. A placeholder followed immediately by `}` is treated as text so that `{{}}`-style escapes behave. A string with no placeholder becomes `Text`.

Sources: [src/fmt/mod.rs:51-107](repo://src/fmt/mod.rs#L51-L107)

| Token | Replaced by |
| --- | --- |
| `{}` | the path |
| `{/}` | the basename |
| `{//}` | the parent directory (`.` if the path has none) |
| `{.}` | the path without its extension |
| `{/.}` | the basename without its extension |

Sources: [src/fmt/mod.rs:17-39](repo://src/fmt/mod.rs#L17-L39), [src/fmt/input.rs:6-31](repo://src/fmt/input.rs#L6-L31), [src/fmt/mod.rs:116-136](repo://src/fmt/mod.rs#L116-L136)

`generate` builds an `OsString`, so a path that is not valid UTF-8 is passed to the command unchanged. If a custom `--path-separator` is set, it is substituted into the path pieces of placeholders only; fixed text is untouched. `remove_extension` also removes a leading `./` from the result.

Sources: [src/fmt/mod.rs:109-141](repo://src/fmt/mod.rs#L109-L141), [src/fmt/input.rs:10-17](repo://src/fmt/input.rs#L10-L17)

## One command per result

With `--exec`, `receive` spawns `config.threads` scoped threads, each cloning the channel receiver and running `exec::job`. Each job loops over the batches it receives and, for each entry, calls `CommandSet::execute` with the path (after the `./` stripping rules in [[Startup and Configuration]]), the path separator and the null-separator flag. The codes of all runs are combined with `merge_exitcodes`, and the thread results are merged the same way. Filesystem errors are printed only with `--show-errors`.

Sources: [src/walk.rs:412-433](repo://src/walk.rs#L412-L433), [src/exec/job.rs:8-44](repo://src/exec/job.rs#L8-L44)

`execute` generates one `Command` per template in the set, then `execute_commands` runs them in order. It stops at the first one that fails to start or exits with a non-zero code and returns `GeneralError`.

Sources: [src/exec/mod.rs:76-88](repo://src/exec/mod.rs#L76-L88), [src/exec/command.rs:59-99](repo://src/exec/command.rs#L59-L99)

Output handling depends on the thread count. With more than one thread (`buffer_output`), each command's stdout and stderr are captured with `cmd.output()` and held in an `OutputBuffer`, which writes them while holding the stdout and stderr locks. A command's output is therefore never interleaved with another's. With one thread the command is spawned directly and inherits the terminal, so its output and any prompts are visible as they happen. With `--print0` the buffer also writes a `\0` after each entry's output.

Sources: [src/exec/job.rs:16-17](repo://src/exec/job.rs#L16-L17), [src/exec/command.rs:9-57](repo://src/exec/command.rs#L9-L57), [src/exec/command.rs:71-78](repo://src/exec/command.rs#L71-L78)

Because several commands run in parallel, the help text states that the order of execution cannot be relied on, and that `--threads=1` gives sequential execution.

Sources: [src/cli.rs:896-899](repo://src/cli.rs#L896-L899)

## One command for all results

With `--exec-batch`, `exec::batch` flattens the received batches into an iterator of paths and calls `execute_batch` on the calling thread, with `config.batch_size` as the limit (zero means unlimited).

Sources: [src/walk.rs:412-415](repo://src/walk.rs#L412-L415), [src/exec/job.rs:46-64](repo://src/exec/job.rs#L46-L64)

For each command template, `CommandBuilder::new` splits the arguments into those before the placeholder argument (`pre_args`), the placeholder argument itself (`path_arg`) and those after it (`post_args`). It starts an `argmax::Command` with `pre_args`, and stdin, stdout and stderr inherited.

Sources: [src/exec/mod.rs:123-171](repo://src/exec/mod.rs#L123-L171)

`push` adds one path to the command line. It first flushes (runs the command) if the batch limit is reached, or if `args_would_fit` says that adding the new argument and the `post_args` would exceed the operating system's argument-length limit. `finish` appends `post_args`, runs the command, and starts a fresh command from `pre_args`. Any non-zero status sets the builder's exit code to `GeneralError`, and after the last path, `finish` runs the final partial batch. If no path was found, `count` is 0 and the command is never run.

Sources: [src/exec/mod.rs:173-208](repo://src/exec/mod.rs#L173-L208), [src/exec/mod.rs:100-120](repo://src/exec/mod.rs#L100-L120)

## Errors

`handle_cmd_error` prints "Command not found: <program>" when the failure is `ErrorKind::NotFound` and the command is known, and "Problem while executing command: ..." for anything else; both return `GeneralError`. Under `--exec`, a failing command makes the final exit code non-zero but does not stop other results from being processed in other threads' jobs; the job itself carries on with the next entry.

Sources: [src/exec/command.rs:101-115](repo://src/exec/command.rs#L101-L115), [src/exec/job.rs:19-43](repo://src/exec/job.rs#L19-L43)

## --list-details

`--list-details` reuses this machinery: it builds a batch `CommandSet` around `ls -l -h -d` (with colour flags) and runs it like `--exec-batch`. How the `ls` variant is chosen per platform is in [[Startup and Configuration]].

Sources: [src/main.rs:395-410](repo://src/main.rs#L395-L410)
