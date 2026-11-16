---
title: "Command-Line Options"
---
## Overview

All of fd's options are declared in one clap derive struct, `Opts`, in `src/cli.rs`. The doc comments on its fields are the `--help` text, so this file is also the source of the long help and of the generated shell completions. `Opts` holds raw values only: [[Startup and Configuration]] turns them into the `Config` the search uses.

Sources: [src/cli.rs:21-32](repo://src/cli.rs#L21-L32)

`fd -h` prints the short help and `fd --help` the long one; options marked `hide_short_help` appear only in the long help. The command sets `args_override_self`, so repeating a flag keeps the last value instead of failing, and puts `--exec`, `--exec-batch` and `--list-details` in one group that conflicts with `--max-results`, `--quiet` and `-1`.

Sources: [src/cli.rs:21-31](repo://src/cli.rs#L21-L31)

## Positional arguments

`fd [OPTIONS] [pattern] [path]...` takes an optional pattern (empty by default, which matches everything) and any number of root directories. A pattern starting with `-` must follow `--`. `--search-path` is an alternative to the positional paths and conflicts with them.

Sources: [src/cli.rs:628-672](repo://src/cli.rs#L628-L672)

## Option reference

### Matching

| Option | Effect |
| --- | --- |
| `-s`, `--case-sensitive` / `-i`, `--ignore-case` | Force case sensitivity; each overrides the other (default: smart case) |
| `-g`, `--glob` / `--regex` | Glob pattern instead of regex; `--regex` overrides `--glob` |
| `-F`, `--fixed-strings` (`--literal`) | Literal substring |
| `--exact` | Literal string that must match the whole name |
| `--and <pattern>` | Additional patterns that must all match |
| `-p`, `--full-path` | Match against the absolute path |

Sources: [src/cli.rs:130-211](repo://src/cli.rs#L130-L211), [src/cli.rs:255-264](repo://src/cli.rs#L255-L264)

### Hidden and ignored entries

| Option | Effect |
| --- | --- |
| `-H`, `--hidden` / `--no-hidden` | Include hidden entries |
| `-I`, `--no-ignore` / `--ignore` | Ignore `.gitignore`, `.ignore`, `.fdignore` and the global ignore file |
| `--no-ignore-vcs` / `--ignore-vcs` | Ignore only `.gitignore` rules |
| `--no-require-git` / `--require-git` | Apply git rules outside a git repository |
| `--no-ignore-parent` / `--ignore-parent` | Skip ignore files in parent directories |
| `--no-global-ignore-file` | Skip the global ignore file (hidden) |
| `-u`, `--unrestricted` | Alias for `--no-ignore --hidden` |
| `-E`, `--exclude <glob>` | Exclude matching entries, overriding other rules |
| `--ignore-file <path>` | Add a low-precedence ignore file |
| `--ignore-contain <name>` | Skip directories that contain an entry with this name |

Sources: [src/cli.rs:33-128](repo://src/cli.rs#L33-L128), [src/cli.rs:310-324](repo://src/cli.rs#L310-L324), [src/cli.rs:510-518](repo://src/cli.rs#L510-L518), [src/cli.rs:550-552](repo://src/cli.rs#L550-L552)

### Traversal

| Option | Effect |
| --- | --- |
| `-d`, `--max-depth` (`--maxdepth`) | Maximum depth |
| `--min-depth` (`--mindepth`) | Minimum depth of reported entries |
| `--exact-depth` | Both of the above at once |
| `--prune` | Do not descend into matching directories |
| `-L`, `--follow` (`--dereference`) / `--no-follow` | Follow symlinks |
| `--one-file-system` (`--mount`, `--xdev`) | Stay on the starting file system |
| `-C`, `--base-directory` | Change the working directory first |
| `-j`, `--threads` | Number of threads (non-zero) |

Sources: [src/cli.rs:240-253](repo://src/cli.rs#L240-L253), [src/cli.rs:278-331](repo://src/cli.rs#L278-L331), [src/cli.rs:554-557](repo://src/cli.rs#L554-L557), [src/cli.rs:613-626](repo://src/cli.rs#L613-L626), [src/cli.rs:682-688](repo://src/cli.rs#L682-L688)

### Filters

| Option | Effect |
| --- | --- |
| `-t`, `--type` | `f`/`file`, `d`/`dir`/`directory`, `l`/`symlink`, `s`/`socket`, `p`/`pipe`, `b`/`block-device`, `c`/`char-device`, `x`/`executable`, `e`/`empty`; repeatable |
| `-e`, `--extension` | File extension; repeatable |
| `-S`, `--size` | Size constraint such as `+10k` or `-1Mi`; repeatable |
| `--changed-within` (`--changed-after`, `--newer`, `--change-newer-than`) | Modified after a date or within a duration |
| `--changed-before` (`--older`, `--change-older-than`) | Modified before a date or longer ago than a duration |
| `-o`, `--owner` | `user:group`, Unix only |

Sources: [src/cli.rs:333-417](repo://src/cli.rs#L333-L417), [src/cli.rs:419-473](repo://src/cli.rs#L419-L473), [src/cli.rs:802-823](repo://src/cli.rs#L802-L823)

### Output

| Option | Effect |
| --- | --- |
| `-a`, `--absolute-path` / `--relative-path` | Print absolute paths |
| `-l`, `--list-details` | Run `ls -l` on the results |
| `-0`, `--print0` | NUL instead of newline after each result |
| `--format <fmt>` | Print a placeholder template instead of the path |
| `-c`, `--color` | `auto`, `always`, `never` |
| `--hyperlink[=when]` (`--hyper`) | `auto`, `always`, `never` (default `never`; bare flag means `auto`) |
| `--path-separator` | Separator used when printing paths |
| `--strip-cwd-prefix[=when]` | `auto`, `always`, `never` for the leading `./` |
| `--max-results`, `-1` | Stop after N results, or after one |
| `-q`, `--quiet` (`--has-results`) | Print nothing; exit code tells whether there was a match |
| `--show-errors` | Print filesystem errors |
| `--max-buffer-time` | Milliseconds to buffer before streaming (hidden) |

Sources: [src/cli.rs:213-238](repo://src/cli.rs#L213-L238), [src/cli.rs:266-276](repo://src/cli.rs#L266-L276), [src/cli.rs:475-487](repo://src/cli.rs#L475-L487), [src/cli.rs:520-548](repo://src/cli.rs#L520-L548), [src/cli.rs:559-611](repo://src/cli.rs#L559-L611), [src/cli.rs:641-650](repo://src/cli.rs#L641-L650), [src/cli.rs:674-680](repo://src/cli.rs#L674-L680)

### Commands

| Option | Effect |
| --- | --- |
| `-x`, `--exec <cmd>...` | Run a command per result, in parallel |
| `-X`, `--exec-batch <cmd>...` | Run a command once with all results |
| `--batch-size <size>` | Maximum arguments per `-X` invocation (0 means no limit; requires `-X`) |

Sources: [src/cli.rs:492-508](repo://src/cli.rs#L492-L508), [src/cli.rs:882-952](repo://src/cli.rs#L882-L952)

## Hand-written arguments

### exec and exec-batch

clap's derive API cannot return grouped values, so `Exec` implements `FromArgMatches` and `Args` by hand. Both `--exec` and `--exec-batch` append occurrences, take one or more values, accept values starting with `-`, and end at a `;` terminator. `from_arg_matches` reads every occurrence of `exec` into `CommandSet::new`, or else every occurrence of `exec_batch` into `CommandSet::new_batch`, and turns a template error into a clap `InvalidValue` error. Passing `-x` twice therefore runs two commands per result. [[Command Execution]] describes `CommandSet`.

Sources: [src/cli.rs:855-957](repo://src/cli.rs#L855-L957)

### Negation flags

Each switch such as `--hidden` has a hidden counterpart (`--no-hidden`, `--ignore`, `--ignore-vcs`, `--require-git`, `--ignore-parent`, `--relative-path`, `--no-follow`) declared as a unit field with `overrides_with`. The later of the two on the command line wins, which lets an alias or wrapper script set a default that the user can still turn off.

Sources: [src/cli.rs:47-64](repo://src/cli.rs#L47-L64), [src/cli.rs:223-225](repo://src/cli.rs#L223-L225), [src/cli.rs:251-253](repo://src/cli.rs#L251-L253)

## Derived helpers

`Opts` exposes small methods that resolve combinations of fields.

Sources: [src/cli.rs:695-786](repo://src/cli.rs#L695-L786)

| Method | Returns |
| --- | --- |
| `search_paths()` | Existing root directories, or `./` |
| `rg_alias_ignore()` | Whether `-u` was given at least once |
| `max_depth()`, `min_depth()` | The depth, falling back to `--exact-depth` |
| `threads()` | `-j`, or available parallelism capped at 64 |
| `max_results()` | `--max-results` if above 0, else 1 for `-1` |
| `strip_cwd_prefix(auto)` | Whether to strip `./`; only without explicit paths |
| `gen_completions()` | The shell for `--gen-completions`, from the argument or the environment |

Sources: [src/cli.rs:696-800](repo://src/cli.rs#L696-L800)

## Completions and man page

With the `completions` feature, a hidden, exclusive `--gen-completions [shell]` option prints completions through `clap_complete`; without a shell name it detects one from the environment and fails with "Unable to get shell from environment" if it cannot.

Sources: [src/cli.rs:690-693](repo://src/cli.rs#L690-L693), [src/cli.rs:775-785](repo://src/cli.rs#L775-L785), [src/main.rs:114-129](repo://src/main.rs#L114-L129)

The man page `doc/fd.1` is a separate roff file installed by `make install`. The README's "Command-line options" block is regenerated from `fd -h`: `scripts/update-help.awk` replaces the fenced block after that heading with the output of `cargo run --release --quiet -- -h`, starting at the `Usage` line.

Sources: [scripts/update-help.awk:1-41](repo://scripts/update-help.awk#L1-L41), [Makefile:44-52](repo://Makefile#L44-L52), [doc/release-checklist.md:25-28](repo://doc/release-checklist.md#L25-L28)
