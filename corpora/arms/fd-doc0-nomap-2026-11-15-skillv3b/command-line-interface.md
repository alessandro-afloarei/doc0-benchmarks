---
title: "Command-Line Interface"
---
## Overview

Every option fd accepts is a field on the `Opts` struct in `src/cli.rs`, declared with clap's derive API. The struct's doc comments double as the `--help` text, and its `#[arg]` attributes carry short flags, aliases, conflicts and override rules. `run` in `src/main.rs` calls `Opts::parse()` first and uses a handful of helper methods on `Opts` to derive values (search paths, depths, thread count) before handing the struct to `construct_config`, which [[Search Patterns and Configuration]] describes.

Sources: [src/cli.rs:21-32](repo://src/cli.rs#L21-L32), [src/main.rs:75-88](repo://src/main.rs#L75-L88)

The `#[command]` attribute sets the program name, wraps help at 98 columns and turns on `args_override_self`, so repeating an option keeps the last value instead of failing. It also declares the `execs` argument group: `--exec`, `--exec-batch` and `--list-details` cannot be combined with `--max-results`, `--quiet` or `-1`, because a command consumes results that those options would otherwise count or hide.

Sources: [src/cli.rs:21-31](repo://src/cli.rs#L21-L31)

## Option groups

The options fall into a few families. Each family's behaviour lives on the page named in the last column.

Sources: [src/cli.rs:32-128](repo://src/cli.rs#L32-L128), [src/cli.rs:255-331](repo://src/cli.rs#L255-L331), [src/cli.rs:368-487](repo://src/cli.rs#L368-L487), [src/cli.rs:520-626](repo://src/cli.rs#L520-L626)

| Family | Options | Explained on |
| --- | --- | --- |
| Ignore and hidden | `-H`, `-I`, `--no-ignore-vcs`, `--no-require-git`, `--no-ignore-parent`, `--no-global-ignore-file`, `-u`, `--ignore-file`, `-E`, `--ignore-contain` | [[Ignore Rules and Traversal]] |
| Pattern mode | `-s`, `-i`, `-g`, `--regex`, `-F`, `--exact`, `--and`, `-p` | [[Search Patterns and Configuration]] |
| Traversal limits | `-d`, `--min-depth`, `--exact-depth`, `--prune`, `-L`, `--one-file-system`, `-j` | [[Ignore Rules and Traversal]] |
| Filters | `-t`, `-e`, `-S`, `--changed-within`, `--changed-before`, `-o` | [[Entry Filters]] |
| Output | `-a`, `-0`, `--format`, `-c`, `--hyperlink`, `--path-separator`, `--strip-cwd-prefix` | [[Output Formatting]] |
| Commands | `-x`, `-X`, `-l`, `--batch-size` | [[Command Execution]] |
| Stopping and status | `--max-results`, `-1`, `-q`, `--show-errors` | [[Parallel Search Pipeline]] |
| Locations | `pattern`, `path`, `--search-path`, `-C` | this page |

Sources: [src/cli.rs:32-128](repo://src/cli.rs#L32-L128), [src/cli.rs:255-331](repo://src/cli.rs#L255-L331), [src/cli.rs:368-487](repo://src/cli.rs#L368-L487), [src/cli.rs:520-626](repo://src/cli.rs#L520-L626)

## Overriding flags

Many flags have a hidden negative twin so that a later argument can undo an earlier one, for example an alias that always passes `--hidden`. The twin is a `()` field with `overrides_with` pointing at the positive flag and `hide = true`, so it never appears in help and stores nothing; clap simply clears the positive flag when the twin comes later on the command line.

Sources: [src/cli.rs:45-49](repo://src/cli.rs#L45-L49)

```rust
    pub hidden: bool,

    /// Overrides --hidden
    #[arg(long, overrides_with = "hidden", hide = true, action = ArgAction::SetTrue)]
    no_hidden: (),
```

Sources: [src/cli.rs:45-49](repo://src/cli.rs#L45-L49)

The pairs are `--hidden`/`--no-hidden`, `--no-ignore`/`--ignore`, `--no-ignore-vcs`/`--ignore-vcs`, `--no-require-git`/`--require-git`, `--no-ignore-parent`/`--ignore-parent`, `--absolute-path`/`--relative-path` and `--follow`/`--no-follow`. Case options override each other the same way: `-s` and `-i` both carry `overrides_with` naming the other, and `--regex` overrides `--glob`. `-u` is a counted flag (`ArgAction::Count`) that overrides `--ignore` and `--no-hidden`; `rg_alias_ignore()` reports whether it was given at least once.

Sources: [src/cli.rs:47-64](repo://src/cli.rs#L47-L64), [src/cli.rs:122-172](repo://src/cli.rs#L122-L172), [src/cli.rs:223-253](repo://src/cli.rs#L223-L253), [src/cli.rs:742-745](repo://src/cli.rs#L742-L745)

## Conflicts between options

Some options make no sense together and clap refuses them before fd runs. `--glob` conflicts with `--fixed-strings`; `--exact` conflicts with both; `--list-details` conflicts with `--absolute-path`, `--print0`, `--format`, `--exec` and `--exec-batch`; `--exact-depth` conflicts with `--max-depth` and `--min-depth`; `--prune` conflicts with `--size` and `--exact-depth`; `--quiet` conflicts with `--max-results`; `--search-path` conflicts with the positional `path`; and `--strip-cwd-prefix` conflicts with both kinds of path. `--batch-size` requires `--exec-batch`.

Sources: [src/cli.rs:153-198](repo://src/cli.rs#L153-L198), [src/cli.rs:231-238](repo://src/cli.rs#L231-L238), [src/cli.rs:304-331](repo://src/cli.rs#L304-L331), [src/cli.rs:498-508](repo://src/cli.rs#L498-L508), [src/cli.rs:592-601](repo://src/cli.rs#L592-L601), [src/cli.rs:664-680](repo://src/cli.rs#L664-L680)

## Positional arguments and search paths

The first positional argument is `pattern`, which defaults to the empty string so that `fd` alone matches everything. Every following positional argument is appended to `path`. `--search-path` is an alternative way to give roots, useful when the pattern must come last or when roots are generated by a script.

Sources: [src/cli.rs:628-672](repo://src/cli.rs#L628-L672)

`Opts::search_paths` picks the roots: the positional paths if any, else `--search-path` values, else `./` after checking that the current directory still exists. Each candidate that is not an existing directory is reported with `print_error` and dropped; `run` fails with "No valid search paths given." only when none survive.

Sources: [src/cli.rs:696-721](repo://src/cli.rs#L696-L721), [src/main.rs:81-85](repo://src/main.rs#L81-L85)

`normalize_path` adjusts each root. With `--absolute-path` it normalises and makes the path absolute. A bare `.` becomes `./`, a workaround for a ripgrep walker issue, and a root named `-` becomes `./-` so the walker does not read it as standard input.

Sources: [src/cli.rs:723-736](repo://src/cli.rs#L723-L736)

`--base-directory` (`-C`) is applied before any of this: `set_working_dir` checks the directory exists and calls `env::set_current_dir`, so relative roots and printed paths are relative to it.

Sources: [src/main.rs:131-148](repo://src/main.rs#L131-L148)

## Derived values

Several fields are private and read through methods that merge related options.

Sources: [src/cli.rs:747-800](repo://src/cli.rs#L747-L800)

| Method | Result |
| --- | --- |
| `max_depth()` | `--max-depth`, else `--exact-depth` |
| `min_depth()` | `--min-depth`, else `--exact-depth` |
| `threads()` | `--threads`, else `default_num_threads()`: available parallelism capped at 64, falling back to 1 |
| `max_results()` | `--max-results` if greater than 0, else 1 when `-1` is given |
| `strip_cwd_prefix(auto)` | false if any root was given; otherwise `always`, `never`, or the `auto` predicate |
| `rg_alias_ignore()` | true when `-u` was given |

Sources: [src/cli.rs:747-800](repo://src/cli.rs#L747-L800)

`--strip-cwd-prefix` takes an optional value through `Option<Option<StripCwdWhen>>`: absent means `auto`, a bare flag means `always`. `construct_config` passes an `auto` predicate that strips `./` unless `--print0` or a command is in use, which protects paths starting with `-` from being read as options by the receiving program.

Sources: [src/cli.rs:674-680](repo://src/cli.rs#L674-L680), [src/cli.rs:835-843](repo://src/cli.rs#L835-L843), [src/main.rs:388-389](repo://src/main.rs#L388-L389)

## Value enums

`FileType`, `ColorWhen`, `StripCwdWhen` and `HyperlinkWhen` derive `ValueEnum`, so clap validates their values and generates completions. `FileType` adds short aliases (`f`, `d`/`dir`, `l`, `b`, `c`, `x`, `e`, `s`, `p`). `--hyperlink` uses `require_equals` and `default_missing_value = "auto"`, so `--hyperlink` alone means `auto` and the default is `never`.

Sources: [src/cli.rs:802-853](repo://src/cli.rs#L802-L853), [src/cli.rs:537-548](repo://src/cli.rs#L537-L548)

Parsers for structured values run during argument parsing: `--size` uses `SizeFilter::from_string`, `--owner` uses `OwnerFilter::from_string` (Unix only), `--threads` parses a `NonZeroUsize`, and the hidden `--max-buffer-time` uses `parse_millis`. A bad value therefore fails with a clap usage error rather than later. [[Entry Filters]] documents the size and owner syntax.

Sources: [src/cli.rs:412-417](repo://src/cli.rs#L412-L417), [src/cli.rs:468-473](repo://src/cli.rs#L468-L473), [src/cli.rs:556-564](repo://src/cli.rs#L556-L564), [src/cli.rs:959-961](repo://src/cli.rs#L959-L961)

## Exec arguments

clap's derive API cannot express "a command template that runs until `;`", so `--exec` and `--exec-batch` are added by hand. `Exec` implements `clap::Args::augment_args` to register both as `num_args(1..)` with `allow_hyphen_values` and `value_terminator(";")`, so every argument after `-x` belongs to the command until a literal `;` (typed `\;` in a shell). Each occurrence is kept separately with `ArgAction::Append`.

Sources: [src/cli.rs:855-957](repo://src/cli.rs#L855-L957)

`Exec::from_arg_matches` reads `get_occurrences` for `exec`, falling back to `exec_batch`, and builds a `CommandSet` with `CommandSet::new` or `CommandSet::new_batch`. A template error, such as a batch command with two placeholders, becomes a clap `InvalidValue` error. [[Command Execution]] covers what the `CommandSet` does.

Sources: [src/cli.rs:861-880](repo://src/cli.rs#L861-L880)

## Shell completions

With the default `completions` feature, the hidden, exclusive `--gen-completions [shell]` option exists. `Opts::gen_completions` resolves the shell, using `Shell::from_env()` when none is given, and `run` returns early through `print_completions`, which names the completions after the binary's file stem so an `fdfind` install gets `fdfind` completions.

Sources: [src/cli.rs:690-692](repo://src/cli.rs#L690-L692), [src/cli.rs:775-785](repo://src/cli.rs#L775-L785), [src/main.rs:78-81](repo://src/main.rs#L78-L81), [src/main.rs:114-129](repo://src/main.rs#L114-L129)
