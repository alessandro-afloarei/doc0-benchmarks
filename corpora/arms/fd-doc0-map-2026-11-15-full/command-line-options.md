---
title: "Command-Line Options"
---
## Overview

Every flag fd accepts is a field of the `Opts` struct in `src/cli.rs`, declared with clap's derive API. The doc comment on each field is its `--help` text, and the `help` attribute is the shorter `-h` text. `Opts` holds raw user input only: [[Startup and Configuration]] turns it into the `Config` the search reads.

Sources: [src/cli.rs:21-32](repo://src/cli.rs#L21-L32), [src/main.rs:75-102](repo://src/main.rs#L75-L102)

The command sets `args_override_self`, so a flag given twice keeps its last value. The `execs` group (`--exec`, `--exec-batch`, `--list-details`) conflicts with `--max-results`, `--quiet` and `-1`, because a command run on each result cannot be cut short by a result limit.

Sources: [src/cli.rs:21-31](repo://src/cli.rs#L21-L31)

## Positional arguments

`fd [OPTIONS] [pattern [path]...]` takes an optional pattern and any number of root directories. The pattern defaults to the empty string, which matches every entry. A pattern starting with `-` must come after `--`. `--search-path` gives roots as an option instead and conflicts with positional paths.

Sources: [src/cli.rs:628-672](repo://src/cli.rs#L628-L672)

## Option groups

### Hidden and ignored files

| Flag | Field | Effect |
| --- | --- | --- |
| `-H`, `--hidden` | `hidden` | Include entries whose name starts with a dot |
| `-I`, `--no-ignore` | `no_ignore` | Ignore `.gitignore`, `.ignore`, `.fdignore` and the global ignore file |
| `--no-ignore-vcs` | `no_ignore_vcs` | Ignore only the VCS ignore files |
| `--no-require-git` | `no_require_git` | Respect git ignore rules outside a git repository too |
| `--no-ignore-parent` | `no_ignore_parent` | Ignore ignore files in parent directories |
| `--no-global-ignore-file` | `no_global_ignore_file` | Skip `~/.config/fd/ignore` (hidden flag) |
| `-u`, `--unrestricted` | `rg_alias_hidden_ignore` | Alias for `--no-ignore --hidden` |
| `--ignore-file <path>` | `ignore_file` | Add a `.gitignore`-format file with low precedence |
| `--ignore-contain <name>` | `ignore_contain` | Skip directories that contain an entry with this name |

Sources: [src/cli.rs:33-128](repo://src/cli.rs#L33-L128), [src/cli.rs:510-552](repo://src/cli.rs#L510-L552)

Most boolean flags have a hidden opposite (`--no-hidden`, `--ignore`, `--ignore-vcs`, `--require-git`, `--ignore-parent`, `--no-follow`, `--relative-path`) declared as a `()` field with `overrides_with`. These let an alias or a shell config turn a flag on and a later argument turn it off again.

Sources: [src/cli.rs:47-49](repo://src/cli.rs#L47-L49), [src/cli.rs:62-64](repo://src/cli.rs#L62-L64), [src/cli.rs:251-253](repo://src/cli.rs#L251-L253)

### Pattern syntax

| Flag | Effect |
| --- | --- |
| `-s`, `--case-sensitive` | Always match case |
| `-i`, `--ignore-case` | Never match case |
| `-g`, `--glob` | Read the pattern as a glob |
| `--regex` | Read the pattern as a regex (the default; overrides `--glob`) |
| `-F`, `--fixed-strings` | Match the pattern as a literal substring |
| `--exact` | Match the whole name literally; conflicts with `--glob` and `--fixed-strings` |
| `--and <pattern>` | Add a pattern that must also match |
| `-p`, `--full-path` | Match against the absolute path, not the file name |

Sources: [src/cli.rs:130-211](repo://src/cli.rs#L130-L211), [src/cli.rs:255-264](repo://src/cli.rs#L255-L264)

### Traversal

| Flag | Effect |
| --- | --- |
| `-L`, `--follow` | Follow symbolic links |
| `-d`, `--max-depth <n>` | Do not descend below depth `n` |
| `--min-depth <n>` | Only show results at depth `n` or deeper |
| `--exact-depth <n>` | Same as `--min-depth n --max-depth n` |
| `-E`, `--exclude <glob>` | Drop entries matching the glob, overriding other ignore logic |
| `--prune` | Do not descend into directories that match |
| `--one-file-system` | Stay on the starting file system (aliases `--mount`, `--xdev`) |
| `-j`, `--threads <n>` | Threads for searching and executing |
| `-C`, `--base-directory <path>` | Change the working directory before searching |

Sources: [src/cli.rs:240-331](repo://src/cli.rs#L240-L331), [src/cli.rs:554-557](repo://src/cli.rs#L554-L557), [src/cli.rs:613-626](repo://src/cli.rs#L613-L626), [src/cli.rs:682-688](repo://src/cli.rs#L682-L688)

### Filters

| Flag | Value | Effect |
| --- | --- | --- |
| `-t`, `--type` | `f`, `d`, `l`, `x`, `e`, `s`, `p`, `c`, `b` | Keep only these entry types; repeatable |
| `-e`, `--extension` | `ext` | Keep entries with this extension; repeatable |
| `-S`, `--size` | `<+-><NUM><UNIT>` | Keep files within a size bound |
| `--changed-within` | date or duration | Keep entries modified after it (aliases `--newer`, `--changed-after`) |
| `--changed-before` | date or duration | Keep entries modified before it (alias `--older`) |
| `-o`, `--owner` | `[user][:group]` | Keep entries with this owner (Unix only); `!` negates |

Sources: [src/cli.rs:333-417](repo://src/cli.rs#L333-L417), [src/cli.rs:419-473](repo://src/cli.rs#L419-L473)

[[Filters]] explains how each value is parsed and matched.

Sources: [src/cli.rs:412-417](repo://src/cli.rs#L412-L417), [src/cli.rs:469-473](repo://src/cli.rs#L469-L473)

### Output

| Flag | Effect |
| --- | --- |
| `-a`, `--absolute-path` | Print absolute paths |
| `-l`, `--list-details` | Run `ls -l` on the results |
| `-0`, `--print0` | Separate results with NUL |
| `--format <fmt>` | Print a placeholder template per result |
| `-c`, `--color <when>` | `auto` (default), `always`, `never` |
| `--hyperlink[=when]` | Wrap paths in terminal hyperlinks; bare flag means `auto` |
| `--path-separator <sep>` | Separator used when printing paths |
| `--strip-cwd-prefix[=when]` | Control the leading `./` on relative paths |
| `--max-results <n>`, `-1` | Stop after `n` results, or after one |
| `-q`, `--quiet` | Print nothing; exit code tells whether anything matched |
| `--show-errors` | Print filesystem errors such as permission denied |

Sources: [src/cli.rs:213-238](repo://src/cli.rs#L213-L238), [src/cli.rs:266-276](repo://src/cli.rs#L266-L276), [src/cli.rs:475-548](repo://src/cli.rs#L475-L548), [src/cli.rs:566-611](repo://src/cli.rs#L566-L611), [src/cli.rs:641-680](repo://src/cli.rs#L641-L680)

### Command execution

`-x`/`--exec` and `-X`/`--exec-batch` cannot be written with clap's derive API because they take grouped, repeated values. The `Exec` struct implements `clap::Args` by hand: each flag takes one or more values, allows values starting with `-`, and ends at a `;` terminator. `from_arg_matches` turns each occurrence into a `CommandSet` with `CommandSet::new` or `CommandSet::new_batch`, and a bad template becomes a clap `InvalidValue` error. `--batch-size` requires `--exec-batch`. See [[Command Execution]].

Sources: [src/cli.rs:855-957](repo://src/cli.rs#L855-L957), [src/cli.rs:492-508](repo://src/cli.rs#L492-L508)

## Derived values

The fields read by the rest of the program are often not the raw ones. `Opts` exposes helpers that resolve aliases and defaults.

Sources: [src/cli.rs:695-786](repo://src/cli.rs#L695-L786)

| Helper | Returns |
| --- | --- |
| `search_paths()` | Positional paths, else `--search-path`, else `./`. Each must be an existing directory: others are reported and dropped |
| `max_depth()`, `min_depth()` | The flag, else `--exact-depth` |
| `threads()` | `--threads`, else the available parallelism capped at 64, else 1 |
| `max_results()` | `--max-results` when above zero, else 1 for `-1`, else none |
| `rg_alias_ignore()` | Whether `-u` was given |
| `strip_cwd_prefix(auto)` | False when paths were given; otherwise `always`, `never`, or the `auto` predicate |
| `gen_completions()` | The shell from `--gen-completions`, or the shell detected from the environment |

Sources: [src/cli.rs:696-800](repo://src/cli.rs#L696-L800)

`normalize_path` adjusts each search path. With `--absolute-path` it makes the path absolute. It rewrites `.` as `./`, to work around an `ignore` crate issue, and `-` as `./-`, so the walker treats it as a path and not as standard input.

Sources: [src/cli.rs:723-736](repo://src/cli.rs#L723-L736)

The `auto` predicate for `--strip-cwd-prefix` comes from `construct_config`: fd strips `./` unless `--print0` or a command is in use, because there a leading `./` keeps a file named `-rf` from being read as an option.

Sources: [src/main.rs:390](repo://src/main.rs#L390), [src/cli.rs:674-680](repo://src/cli.rs#L674-L680)

## Shell completions

With the `completions` feature (on by default), the hidden `--gen-completions [shell]` flag is exclusive of every other argument. `run` checks it first and calls `print_completions`, which builds the clap command and writes the script for that shell, naming the program after the binary's file stem so an `fdfind` binary gets `fdfind` completions.

Sources: [src/cli.rs:690-692](repo://src/cli.rs#L690-L692), [src/main.rs:78-81](repo://src/main.rs#L78-L81), [src/main.rs:114-129](repo://src/main.rs#L114-L129)
