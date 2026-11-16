---
type: architecture
title: CLI Parsing and Configuration
description: How fd defines its command-line interface with clap (Opts in src/cli.rs) and how main.rs's construct_config turns parsed options into the immutable Config struct shared by the walker, output, and exec subsystems.
tags: [cli, clap, configuration, options]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:39:25.366Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-f5ea23b51c582bb354c81514
    resource: repo://src/filesystem.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-15T17:39:25.366Z" }
---

# CLI Parsing and Configuration

fd separates *what the user typed* from *what the search engine needs*:

- `src/cli.rs` defines `Opts`, a `clap` derive struct that mirrors the command line one-to-one (flags, hidden negation flags, aliases, conflicts, help text).
- `src/config.rs` defines `Config`, a plain struct of resolved, ready-to-use values (booleans, compiled regex sets, parsed filters, an optional `CommandSet`, an `LsColors` instance, …).
- `construct_config` in `src/main.rs` is the single translation step between the two. After it runs, `Opts` is discarded and every downstream module (walker, output, exec) only sees `Config`.

See [Architecture Overview](overview.md) for where this sits in the full pipeline.

## The `Opts` struct (`src/cli.rs`)

### Global clap settings

The `#[command(...)]` attribute sets a few behaviors that matter for users and contributors:

- `args_override_self = true` – repeating a flag simply overrides its earlier value instead of erroring.
- An `ArgGroup` named `execs` contains `--exec`, `--exec-batch` and `--list-details`, and conflicts with `--max-results`, `--quiet` and `-1`. Running commands and limiting/suppressing results are therefore mutually exclusive at parse time.
- `max_term_width = 98` caps help-text wrapping.

### Negation flags

Many boolean options have a hidden counterpart that resets them, implemented as a `()` field with `overrides_with`:

| Flag | Hidden negation |
|------|-----------------|
| `--hidden` / `-H` | `--no-hidden` |
| `--no-ignore` / `-I` | `--ignore` |
| `--no-ignore-vcs` | `--ignore-vcs` |
| `--no-require-git` | `--require-git` |
| `--no-ignore-parent` | `--ignore-parent` |
| `--absolute-path` / `-a` | `--relative-path` |
| `--follow` / `-L` | `--no-follow` |

Because later flags override earlier ones, this lets users put defaults in a shell alias and undo them per invocation.

`-u`/`--unrestricted` is a counted flag (`rg_alias_hidden_ignore: u8`, read through `rg_alias_ignore()`); any count > 0 acts as `--no-ignore --hidden`, mirroring ripgrep. `--no-global-ignore-file` is hidden.

### Pattern and path positionals

- `pattern` is an optional positional that defaults to `""` (match everything).
- `path` is an appendable positional of root directories. `--search-path` is an alternative named form that conflicts with positional paths.
- `--and <pattern>` (`exprs`) adds extra patterns that all must match – see [Pattern Matching](../concepts/pattern-matching.md).

### Hand-rolled `--exec` parsing

`--exec`/`-x` and `--exec-batch`/`-X` need *grouped* values (each occurrence is a full command template, terminated by `;`). clap's derive API cannot express this, so `Exec` implements `clap::Args` and `clap::FromArgMatches` manually. It reads `get_occurrences("exec")` into `CommandSet::new`, otherwise `get_occurrences("exec_batch")` into `CommandSet::new_batch`, converting template errors into clap `InvalidValue` errors. Both arguments use `allow_hyphen_values(true)` and `value_terminator(";")`, which is why `-x` should usually be placed last. Details are in [Command Execution](../features/command-execution.md).

### Value parsers that build filters early

Some options are parsed straight into domain types by clap value parsers, so invalid input fails during argument parsing:

- `--size`/`-S` → `SizeFilter::from_string`
- `--owner`/`-o` (Unix only) → `OwnerFilter::from_string`
- `--threads`/`-j` → `NonZeroUsize`
- `--max-buffer-time` (hidden) → milliseconds `Duration`

Time filters (`--changed-within`, `--changed-before`) are kept as strings and only parsed later in `construct_config` (see [Entry Filters](../concepts/entry-filters.md)).

### Derived helpers on `Opts`

| Helper | Behavior |
|--------|----------|
| `search_paths()` | Uses positional `path`, else `--search-path`, else `./`. Non-directory paths print an error and are dropped; if the default `./` does not exist (deleted CWD) it errors. `main` bails with "No valid search paths given." if the list ends up empty. |
| `normalize_path()` | With `--absolute-path`, normalizes and makes the path absolute. Rewrites `.` to `./` (ripgrep workaround) and `-` to `./-` so the walker treats it as a path. |
| `max_depth()` / `min_depth()` | Fall back to `--exact-depth` when not set explicitly. |
| `threads()` | `--threads` or `available_parallelism()`, capped at 64 and falling back to 1. |
| `max_results()` | `--max-results` if > 0, else `1` when `-1` is given. |
| `strip_cwd_prefix(pred)` | Only applies when *no* search paths were given; `--strip-cwd-prefix` with no value means `always`; `auto` defers to the predicate supplied by `construct_config`. |
| `gen_completions()` | (feature `completions`) returns the requested shell or detects it from the environment. |

## From `Opts` to `Config` (`construct_config`)

`run()` in `src/main.rs` performs these steps before the search starts:

1. `Opts::parse()`; optionally print shell completions and exit.
2. `set_working_dir` applies `--base-directory`/`-C` via `env::set_current_dir`, failing if it is not a directory.
3. Resolve search paths, check that patterns don't look like paths, and convert each pattern to a regex string.
4. `construct_config(opts, &pattern_regexps)`.
5. Check the leading-dot/hidden warning, compile the final regexes, call `walk::scan`.

Inside `construct_config` the notable resolutions are:

- **Case sensitivity (smart case):** `case_sensitive = !ignore_case && (case_sensitive_flag || any pattern has an uppercase char)`.
- **Path separator:** `--path-separator`, otherwise `filesystem::default_path_separator()` (returns `/` on Windows when `MSYSTEM` is set, i.e. MSYS/MSYS2). On Windows a separator longer than one byte is rejected with a hint that the shell may have expanded `/`. `actual_path_separator` always holds a concrete string (falls back to `MAIN_SEPARATOR`).
- **Colors:** `--color always|never|auto`. `auto` enables color only if ANSI is supported, `NO_COLOR` is unset or empty, and stdout is a terminal. When enabled, `LsColors::from_env()` is used, falling back to a built-in `DEFAULT_LS_COLORS` theme (generated with `vivid ... molokai`).
- **Hyperlinks:** `--hyperlink` defaults to `never`; `auto` follows the color decision.
- **Command:** `extract_command` takes `--exec`/`--exec-batch`, or synthesizes a batch `ls -l -h -d` command for `--list-details` (choosing GNU `ls`, `gls`, or BSD `ls` per platform; unsupported on Windows without GNU `ls`).
- **Ignore flags:** `ignore_hidden`, `read_fdignore`, `read_vcsignore`, `read_global_ignore`, etc. combine `--hidden`, `--no-ignore*` and `-u` – see [Ignore Rules](../concepts/ignore-rules-and-hidden-files.md).
- **File types:** `--type` values are folded into a `FileTypes` struct; `executable` also implies `files`, and `empty` alone implies both files and directories.
- **Extensions:** each `--extension` (leading dots trimmed) becomes a case-insensitive `RegexSet` entry `.\.<ext>$`.
- **Exclude patterns:** each `--exclude` glob is prefixed with `!` so it can be fed to the `ignore` crate as an override.
- **`--full-path`:** caches `env::current_dir()` in `full_path_base` once, instead of per entry.
- **Strip `./` prefix:** in `auto` mode, stripped unless `--print0` or a command is in use.

### `Config` invariants

- `Config` is built once and then shared by reference across walker threads (and wrapped in `Arc` for the command set), so it is effectively immutable during the search.
- `Config::is_printing()` is simply `command.is_none()`; many code paths (color computation, Ctrl-C handler, output) branch on it.
- `owner_constraint` exists only on Unix (`#[cfg(unix)]`).

## Extension seams

Adding a new option typically means: add a field to `Opts` (with help text and conflicts), add a resolved field to `Config`, populate it in `construct_config`, and consume it in `walk.rs`, `output.rs` or `exec`. Remember to regenerate the help snippet in the README (`scripts/update-help.awk`) and update `doc/fd.1` and completions – see [Build, Release, and Packaging](../operations/build-release-and-packaging.md).

## Related tests

`tests/tests.rs` exercises most options end to end (e.g. smart case, `--strip-cwd-prefix`, `--base-directory`, `--max-results`). See [Testing](../testing/integration-tests.md).
