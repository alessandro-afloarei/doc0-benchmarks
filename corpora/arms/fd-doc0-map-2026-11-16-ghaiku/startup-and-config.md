---
title: "Startup and Configuration"
---
## Overview

`run()` is where a search starts. It parses the command line, checks the working directory and the search paths, compiles every pattern into a regular expression, and then builds one `Config` that the walk and its receiver read for the rest of the run. Nothing is walked until all of that has succeeded, so a bad option stops the program before any output.

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112)

## Search paths and the pattern check

`set_working_dir` changes the process's working directory when `--base-directory` is given, and refuses a path that is not an existing directory. The search paths come next: `Opts::search_paths` keeps only the arguments that are existing directories, prints an error for each other one, and falls back to `./` when none are given. A run with no usable path stops with "No valid search paths given."

Sources: [src/main.rs:131-147](repo://src/main.rs#L131-L147), [src/cli.rs:696-721](repo://src/cli.rs#L696-L721), [src/main.rs:83-87](repo://src/main.rs#L83-L87)

Patterns are checked for path separators before they are compiled. A pattern containing `/` cannot match a file name, because fd matches names unless `--full-path` is given, so fd returns an error that suggests `fd . 'dir'` or `fd --full-path`. Every `--and` pattern gets the same check. On Windows, a `\` triggers the same error only when the pattern also names an existing directory, because `\` is also the regex escape character.

Sources: [src/main.rs:169-181](repo://src/main.rs#L169-L181), [src/main.rs:185-216](repo://src/main.rs#L185-L216)

## Pattern compilation

Each pattern goes through `build_pattern_regex` first. With `--glob` it becomes the regex of a glob that does not let `*` cross a separator. With `--exact` the escaped text is anchored with `^` and `$`. With `--fixed-strings` it is escaped and left unanchored. Anything else is used as written.

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232)

Case is decided once for all patterns together. The search is case-sensitive when `--case-sensitive` is given, or when no `--ignore-case` is given and some pattern contains an uppercase character (smart case). `pattern_has_uppercase_char` checks the parsed regex, so a class such as `[a-zA-Z]` counts, while an escape such as `\A` does not.

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255), [src/regex_helper.rs:4-36](repo://src/regex_helper.rs#L4-L36)

After `construct_config`, each string becomes a `regex::bytes::Regex` built with the case setting and `dot_matches_new_line(true)`. A compile error is shown with a hint to use `--fixed-strings`, `--exact` or `--glob`.

Sources: [src/main.rs:106-109](repo://src/main.rs#L106-L109), [src/main.rs:541-555](repo://src/main.rs#L541-L555)

A pattern that can only match names starting with a dot is refused on Unix when hidden files are being skipped, since the search would silently find nothing. The check looks only for the simplest form, a start anchor followed by a literal dot, so other patterns that match only hidden files are not caught.

Sources: [src/main.rs:521-539](repo://src/main.rs#L521-L539), [src/regex_helper.rs:40-78](repo://src/regex_helper.rs#L40-L78)

## Colours and hyperlinks

Colour is decided in `construct_config`. `--color=always` and `--color=never` settle it. In `auto` mode, colour is used only when stdout is a terminal, `NO_COLOR` is unset or empty, and the terminal supports ANSI. On Windows, the ANSI check enables VT support or accepts a `TERM` variable.

Sources: [src/main.rs:277-286](repo://src/main.rs#L277-L286), [src/main.rs:271-275](repo://src/main.rs#L271-L275)

When colour is on, the `LS_COLORS` environment variable is parsed, and the built-in `DEFAULT_LS_COLORS` table is used when it is missing or empty. The result is stored in `Config.ls_colors`, which the walker uses to attach styles to each entry.

Sources: [src/main.rs:288-292](repo://src/main.rs#L288-L292), [src/main.rs:57-60](repo://src/main.rs#L57-L60)

Hyperlinks follow the same rule. `--hyperlink=auto` turns them on exactly when colour is on, and `always` or `never` override it.

Sources: [src/main.rs:293-297](repo://src/main.rs#L293-L297)

## Command and listing options

`extract_command` produces the `CommandSet` for the run. An `--exec` or `--exec-batch` command takes precedence. Otherwise `--list-details` builds a batch command that runs `ls -l -h -d`, using GNU `ls` on Linux, GNU or BSD `ls` on macOS and the BSDs, and GNU `ls` on Windows only when it is installed. Other platforms are refused.

Sources: [src/main.rs:395-410](repo://src/main.rs#L395-L410), [src/main.rs:412-494](repo://src/main.rs#L412-L494)

`--changed-within` and `--changed-before` are parsed into `TimeFilter`s here, and an invalid date or duration is an error. Size, owner and file-type options are copied into the `Config` in the same function. The rest of the filter logic is on [[Entry Filters]].

Sources: [src/main.rs:496-519](repo://src/main.rs#L496-L519), [src/main.rs:266-269](repo://src/main.rs#L266-L269), [src/main.rs:333-360](repo://src/main.rs#L333-L360)

The `--strip-cwd-prefix` setting depends on the command. It is on by default only for a plain search with no `--exec` and no `--print0`, and only when no search path was given.

Sources: [src/main.rs:390-390](repo://src/main.rs#L390-L390), [src/cli.rs:765-773](repo://src/cli.rs#L765-L773)

## What the Config holds

`construct_config` fills every field of `Config` in one struct literal. The walk reads the ignore settings directly: `--hidden` and the `rg-alias` options clear `ignore_hidden`, `--no-ignore` clears `read_fdignore`, and `--no-ignore-vcs` and `--no-require-git` adjust the VCS settings. Global ignore files are read only when `--no-global-ignore-file` and the other no-ignore options are off. Exclude patterns are stored with a `!` prefix so that the override builder treats them as exclusions.

Sources: [src/main.rs:310-320](repo://src/main.rs#L310-L320), [src/main.rs:380-381](repo://src/main.rs#L380-L381)

Extension filters are compiled into a `RegexSet` of `\.ext$` patterns, case-insensitive, with leading dots removed from the input. The thread count comes from `--threads`, or from the number of CPUs up to 64. The maximum result count comes from `--max-results`, or 1 when `--max-one-result` is given.

Sources: [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/cli.rs:755-763](repo://src/cli.rs#L755-L763), [src/cli.rs:789-800](repo://src/cli.rs#L789-L800)

The `Config` struct documents its fields. The `max_buffer_time` field is the one [[Result Receiver and Ordering]] uses to decide when to stream.

Sources: [src/config.rs:68-71](repo://src/config.rs#L68-L71)

## Failures at startup

Every error here is returned from `run()`, which `main` prints and turns into the general-error exit code. The checks run in this order: the base directory, the search paths, the path-separator check on each pattern, the pattern regex building, then `construct_config` (the path-separator length, the time constraints, and the `--exec` or `--list-details` command). After that come the leading-dot check and the regex compilation. The first failing check ends `run()`, so the first message the user sees is the first problem in that order.

Sources: [src/main.rs:62-73](repo://src/main.rs#L62-L73), [src/main.rs:83-109](repo://src/main.rs#L83-L109), [src/main.rs:234-246](repo://src/main.rs#L234-L246)

Once `walk::scan` is called, the walk owns the `Config`. The next stage is [[Walker and Ignore Rules]].

Sources: [src/main.rs:111-111](repo://src/main.rs#L111-L111), [src/walk.rs:306-310](repo://src/walk.rs#L306-L310)
