---
title: "Startup and Configuration"
---
## Overview

`run` in `main.rs` is the single path from process start to a search. It parses the options into `Opts`, checks the roots and the patterns, builds one regular expression per pattern, turns the options into a `Config`, and only then calls `walk::scan`. Everything the walk and the printer need is read from that `Config`; neither reads `Opts` again.

Sources: [src/main.rs:75-111](repo://src/main.rs#L75-L111)

## Order of checks

`--base-directory` is applied first, so the roots and any relative ignore file are resolved against it. A `--base-directory` that is not a directory stops the run. A search path that is not a directory is reported and skipped, and the run continues with the rest.

Sources: [src/main.rs:131-143](repo://src/main.rs#L131-L143), [src/main.rs:83-87](repo://src/main.rs#L83-L87), [src/cli.rs:696-721](repo://src/cli.rs#L696-L721)

The pattern check comes next, before any regex is compiled. `ensure_search_pattern_is_not_a_path` runs over the positional pattern and each `--and` pattern, and it is skipped under `--full-path`. The patterns are then converted to regex source (glob, exact or fixed-string modes; see [[Pattern Matching]]), and only after the `Config` exists is each source compiled. A compile error carries a hint toward `--fixed-strings`, `--exact` or `--glob`.

Sources: [src/main.rs:89](repo://src/main.rs#L89), [src/main.rs:169-182](repo://src/main.rs#L169-L182), [src/main.rs:94-109](repo://src/main.rs#L94-L109), [src/main.rs:541-552](repo://src/main.rs#L541-L552)

The leading-dot check runs once the `Config` exists, because it needs `ignore_hidden`. On Unix, a pattern that can only match names starting with a dot is an error unless `--hidden` is given, since hidden entries are skipped and such a search would otherwise always come back empty.

Sources: [src/main.rs:104](repo://src/main.rs#L104), [src/main.rs:521-539](repo://src/main.rs#L521-L539)

## Building the Config

`construct_config` resolves each option once and stores the result in `Config`. It decides four things that depend on the environment:

Sources: [src/main.rs:248-256](repo://src/main.rs#L248-L256)

- Case sensitivity: the search is case-sensitive only when `--case-sensitive` is set or a pattern has an uppercase literal, and `--ignore-case` wins over both.
- Colour: `--color=auto` colours only when stdout is a terminal and `NO_COLOR` is unset. The colour table comes from `LS_COLORS` when it is set, and from the built-in default otherwise.
- Hyperlinks: `--hyperlink=auto` follows the colour decision.
- The full-path base: with `--full-path`, the current directory is captured here so that matching can build absolute paths later.

Sources: [src/main.rs:251-256](repo://src/main.rs#L251-L256), [src/main.rs:277-297](repo://src/main.rs#L277-L297), [src/main.rs:301-309](repo://src/main.rs#L301-L309)

The ignore flags are stored as independent booleans, so the walker does not need to know which flag was given. Each one is the negation of the option that turns it off: `ignore_hidden` is false under `--hidden`, `read_fdignore` is false under `--no-ignore`, and `read_vcsignore` is also false under `--no-ignore-vcs`. The `-u` count (`rg_alias_ignore`) turns off hidden and ignore handling together.

Sources: [src/main.rs:313-324](repo://src/main.rs#L313-L324), [src/config.rs:14-40](repo://src/config.rs#L14-L40)

Time limits are parsed here, not in the walk. `extract_time_constraints` turns `--changed-within` into an `After` filter and `--changed-before` into a `Before` filter; a value that is not a date, a duration, or an `@` timestamp is an error. The filters are then evaluated by the sender for each entry.

Sources: [src/main.rs:496-519](repo://src/main.rs#L496-L519), [src/filter/time.rs:28-55](repo://src/filter/time.rs#L28-L55)

## Commands and listing

`extract_command` takes the `--exec` or `--exec-batch` command set if one was given. With `--list-details` and no command, it builds a batch command for `ls`: GNU `ls` with `-l -h -d` on Linux and the other non-BSD Unix systems, `gls` when it is installed or BSD `ls` on macOS and the BSD systems, and GNU `ls` on Windows. On Windows without GNU `ls`, and on other platforms, the run stops with an error.

Sources: [src/main.rs:395-410](repo://src/main.rs#L395-L410), [src/main.rs:412-494](repo://src/main.rs#L412-L494)

The finished `Config` is passed to `walk::scan`. Its `command` field decides the receiver's mode: `receive` runs `exec::batch` or the job threads when a command is set, and the buffered printer otherwise. Colouring is also decided by `is_printing`, which is true when no command was given, so the sender styles entries only when they will be printed.

Sources: [src/walk.rs:408-412](repo://src/walk.rs#L408-L412), [src/config.rs:138-143](repo://src/config.rs#L138-L143), [src/walk.rs:593-598](repo://src/walk.rs#L593-L598), [src/main.rs:111](repo://src/main.rs#L111)
