---
title: "Quickstart"
---
## Overview

This quickstart builds the checkout and uses the resulting `fd` executable to find entries, narrow a search, and run a command on matches. The program's pipeline is described in [[Overview]]; here the goal is to get a working local search before exploring its internals. The package declares Rust 1.90.0 as its minimum compiler version and uses edition 2024.

Sources: [Cargo.toml:16-31](repo://Cargo.toml#L16-L31), [src/main.rs:75-112](repo://src/main.rs#L75-L112), [src/walk.rs:408-438](repo://src/walk.rs#L408-L438)

## Build and install the checkout

From the repository root, build with Cargo. The repository's development instructions use the following command; the binary target is named `fd` and points at `src/main.rs`.

Sources: [README.md:734-740](repo://README.md#L734-L740), [Cargo.toml:29-31](repo://Cargo.toml#L29-L31)

```bash
cargo build
```

Sources: [README.md:738-740](repo://README.md#L738-L740)

To install this checkout for the following `fd` commands, use the repository's local install command. This selects the current source tree rather than specifying a released package version. The package name and executable name differ: the Cargo package is `fd-find`, and the installed program is `fd`.

Sources: [README.md:745-746](repo://README.md#L745-L746), [Cargo.toml:16-31](repo://Cargo.toml#L16-L31)

```bash
cargo install --path .
```

Sources: [README.md:745-746](repo://README.md#L745-L746)

## Run the first searches

Run `fd` without a pattern to consider every visited entry a match. Without a search root, it uses the current directory. Hidden entries and ignored paths remain excluded by default, so this is a listing of the searchable tree rather than an unconditional enumeration of everything on disk. Use `fd -h` for concise help or `fd --help` for the longer descriptions.

Sources: [src/cli.rs:25-45](repo://src/cli.rs#L25-L45), [src/cli.rs:628-659](repo://src/cli.rs#L628-L659), [src/cli.rs:696-705](repo://src/cli.rs#L696-L705), [README.md:306-307](repo://README.md#L306-L307)

The basic argument order is a pattern followed by optional search directories. The documented example below searches within `src` and echoes each match. The dot is the search expression; `src` is the root. [[Search Patterns and Paths]] explains why supplying a directory in the pattern position can produce a diagnostic and how full-path matching changes the search target.

Sources: [src/cli.rs:628-659](repo://src/cli.rs#L628-L659), [src/cli.rs:914-915](repo://src/cli.rs#L914-L915), [src/main.rs:203-212](repo://src/main.rs#L203-L212)

```bash
fd . src -x echo
```

Sources: [src/cli.rs:914-915](repo://src/cli.rs#L914-L915)

For a search without a command, use a filename expression or choose literal matching with `--fixed-strings`. Literal matching still finds substrings; `--exact` requires the entire filename to match. `--glob` provides glob matching instead. Case handling defaults to smart case, with `--case-sensitive` and `--ignore-case` available to choose it explicitly.

Sources: [src/cli.rs:130-198](repo://src/cli.rs#L130-L198)

## Narrow or expand the search

Extensions can restrict a query independently of its name expression. The following repository example selects Rust files and passes them to a line-counting command. Repeated extension arguments become alternatives, while the filename still has to satisfy the search expression. [[File Filters]] covers extension matching and the additional type, size, time, and ownership predicates.

Sources: [src/cli.rs:947-948](repo://src/cli.rs#L947-L948), [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/walk.rs:519-541](repo://src/walk.rs#L519-L541), [src/walk.rs:544-591](repo://src/walk.rs#L544-L591)

```bash
fd -e rs -X wc -l
```

Sources: [src/cli.rs:947-948](repo://src/cli.rs#L947-L948)

Use `--hidden` (`-H`) to include hidden entries and `--no-ignore` (`-I`) to disable the normal ignore-file rules. `--unrestricted` (`-u`) combines those choices. These switches address separate reasons an entry may be absent: enabling hidden entries does not automatically include entries excluded by ignore files. [[Directory Traversal and Ignore Rules]] explains the narrower VCS, parent, and global-ignore controls.

Sources: [src/cli.rs:33-128](repo://src/cli.rs#L33-L128)

To bound traversal, `--max-depth` limits descent and `--min-depth` suppresses shallower results. `--exact-depth` combines both bounds. To search from another working directory, `--base-directory` changes the base before relative search roots are resolved; it is useful when the displayed relative paths should be relative to that base.

Sources: [src/cli.rs:278-308](repo://src/cli.rs#L278-L308), [src/cli.rs:613-626](repo://src/cli.rs#L613-L626), [src/main.rs:83-84](repo://src/main.rs#L83-L84)

## Choose how to consume matches

The `-x` example above executes once per match, whereas `-X` collects arguments for batch execution. Put the execution option last: following arguments belong to the child command until the command terminator. [[Command Execution]] covers placeholders, concurrency, batch limits, and failure handling, including why a batch can require multiple subprocess invocations.

Sources: [src/cli.rs:884-915](repo://src/cli.rs#L884-L915), [src/cli.rs:922-948](repo://src/cli.rs#L922-L948), [src/exec/mod.rs:173-200](repo://src/exec/mod.rs#L173-L200)

For a pipeline that consumes path records, `--print0` (`-0`) replaces newline separators with NUL. For a boolean existence check, `--quiet` prints no matching paths and returns 0 if a match exists or 1 otherwise. Quiet mode conflicts with command execution. [[Output and Formatting]] covers the rendering and exit behavior behind these options.

Sources: [src/cli.rs:29-30](repo://src/cli.rs#L29-L30), [src/cli.rs:266-276](repo://src/cli.rs#L266-L276), [src/cli.rs:588-601](repo://src/cli.rs#L588-L601)

## Verify development changes

The repository runs unit and integration tests through Cargo. Its integration environment creates temporary directories, adds a `.git` directory so Git ignore behavior applies, and writes `.fdignore` and `.gitignore` fixtures. It locates the executable through `CARGO_BIN_EXE_fd`. The output comparison helper sorts lines, so a passing comparison does not establish deterministic traversal order.

Sources: [README.md:742-743](repo://README.md#L742-L743), [tests/testenv/mod.rs:28-78](repo://tests/testenv/mod.rs#L28-L78), [tests/testenv/mod.rs:114-133](repo://tests/testenv/mod.rs#L114-L133)

```bash
cargo test
```

Sources: [README.md:742-743](repo://README.md#L742-L743)

## Diagnose startup problems

An invalid base directory fails immediately. Invalid explicit search roots are reported and removed, and the search fails if no valid roots remain. Invalid regex syntax produces a message suggesting literal or glob matching. On Unix, a pattern recognized as requiring a leading dot also produces a diagnostic when hidden files are excluded. These checks happen before the walker starts, so changing output formatting cannot resolve them.

Sources: [src/main.rs:83-111](repo://src/main.rs#L83-L111), [src/main.rs:131-146](repo://src/main.rs#L131-L146), [src/cli.rs:707-720](repo://src/cli.rs#L707-L720), [src/main.rs:521-554](repo://src/main.rs#L521-L554)
