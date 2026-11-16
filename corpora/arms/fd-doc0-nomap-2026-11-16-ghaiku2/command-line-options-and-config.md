---
title: "Command-Line Options and Config"
---
## Overview

`Opts` holds every flag, parsed by clap from the command line. `run` in `main.rs` turns it into a `Config` value, which is the only settings object the search reads. The walk, the filters, the printer and the `--exec` runner each take the fields they need from that `Config`, so no later stage reads a flag directly.

Sources: [src/main.rs:75-111](repo://src/main.rs#L75-L111), [src/cli.rs:32-40](repo://src/cli.rs#L32-L40), [src/config.rs:14-20](repo://src/config.rs#L14-L20)

`run` parses the options, changes the working directory, validates the search paths, builds one regex per pattern, builds the `Config`, and finally calls `walk::scan`. The steps run in that order: a bad pattern fails before the walk starts, and the walk starts only with a complete `Config`.

Sources: [src/main.rs:76-111](repo://src/main.rs#L76-L111)

## Working directory and search paths

`--base-directory` changes the process working directory before anything else runs. The path must be an existing directory, or the run stops with an error.

Sources: [src/main.rs:131-146](repo://src/main.rs#L131-L146)

`search_paths` keeps only the given paths that are existing directories. Each rejected path prints an error and is dropped, and when none is left `run` fails with "No valid search paths given." With no path given, the search starts at the current directory, which is passed as `./`.

Sources: [src/cli.rs:696-721](repo://src/cli.rs#L696-L721), [src/main.rs:83-87](repo://src/main.rs#L83-L87)

`normalize_path` rewrites `.` to `./` and `-` to `./-`. The first is a workaround for a walker issue the code links to; the second keeps a directory named `-` from being read as an option. `--absolute-path` replaces every path with its absolute form.

Sources: [src/cli.rs:723-738](repo://src/cli.rs#L723-L738)

## Building the Config

`construct_config` resolves each flag into the field it sets. Some fields are computed from more than one flag: case sensitivity combines `--ignore-case`, `--case-sensitive` and the uppercase check on the patterns, and colouring depends on `--color`, `NO_COLOR` and whether stdout is a terminal.

Sources: [src/main.rs:248-256](repo://src/main.rs#L248-L256), [src/main.rs:277-296](repo://src/main.rs#L277-L296)

The ignore-file switches are inverted: `--no-ignore` turns off `.fdignore`, the VCS ignore files and the global ignore file together, and the `rg` alias flags do the same. `--hidden` turns off the hidden-entry filter. Each of these becomes one boolean in `Config`, and the walk reads them when it builds its walker.

Sources: [src/main.rs:310-325](repo://src/main.rs#L310-L325)

`--max-depth` and `--exact-depth` both set the depth limit, and the minimum depth takes the same value from `--exact-depth`. `Opts::threads` falls back to the available parallelism, capped at 64.

Sources: [src/cli.rs:747-758](repo://src/cli.rs#L747-L758), [src/cli.rs:789-799](repo://src/cli.rs#L789-L799)

`--max-results` and `-1` both limit the output. A value of zero for `--max-results` means no limit, and `-1` sets the limit to one.

Sources: [src/cli.rs:759-763](repo://src/cli.rs#L759-L763), [src/cli.rs:580-586](repo://src/cli.rs#L580-L586)

Paths in the output lose their leading `./` only when no search path was given. Under the default `auto` setting they lose it only when the output is not NUL-separated and no `--exec` command is set. The choice is made in `strip_cwd_prefix`, which takes the automatic rule as a closure so that the rule is evaluated only for `auto`.

Sources: [src/cli.rs:765-774](repo://src/cli.rs#L765-L774), [src/main.rs:390](repo://src/main.rs#L390)

## Time constraints

`--changed-within` and `--changed-before` are parsed into `TimeFilter` values before the walk starts. An unparsable value stops the run with the message "is not a valid date or duration".

Sources: [src/main.rs:496-519](repo://src/main.rs#L496-L519)

## The --list-details command

`--list-details` is not a `--exec` command: `extract_command` builds one for it, a batch `ls` call with the long, human-readable and directory-only flags. Which `ls` is used depends on the platform. On Linux it is `ls`; on macOS and the BSDs it is `gls` when that exists and the BSD `ls` otherwise; on Windows it needs GNU `ls` on the path.

Sources: [src/main.rs:395-410](repo://src/main.rs#L395-L410), [src/main.rs:412-494](repo://src/main.rs#L412-L494)

## The Config value

`Config` carries the settings the stages read. The walk reads the ignore and depth flags, the sender reads the filters, the printer reads the separators and colours, and the runner reads the command. `is_printing` tells the rest of the program whether results go to stdout or to a command.

Sources: [src/config.rs:14-60](repo://src/config.rs#L14-L60), [src/config.rs:61-136](repo://src/config.rs#L61-L136), [src/config.rs:138-142](repo://src/config.rs#L138-L142)
