---
title: "Quickstart"
---
## Overview

This walkthrough builds the repository's `fd` executable, introduces searches, and shows how to send matches to a command. The package is named `fd-find`, while the executable is named `fd`. Work from the repository root for the build steps. The declared minimum Rust version is 1.90.0, and the repository's source-installation instructions also list `make` as a build prerequisite.

Sources: [Cargo.toml:16-31](repo://Cargo.toml#L16-L31), [README.md:720-746](repo://README.md#L720-L746)

## Build and install this checkout

Build the project with Cargo. This is the local development build used before running the unit and integration tests. The manifest's default feature enables shell completions; allocator support is a separate optional feature with platform-specific dependency conditions.

Sources: [README.md:734-746](repo://README.md#L734-L746), [Cargo.toml:65-71](repo://Cargo.toml#L65-L71), [Cargo.toml:94-98](repo://Cargo.toml#L94-L98)

```bash
cargo build
```

Sources: [README.md:738-740](repo://README.md#L738-L740)

To make the executable from this checkout available through Cargo's installation workflow, use the repository's local-path installation command. This selects the code in the current directory; the README separately documents `cargo install fd-find` for installing the published package.

Sources: [README.md:720-726](repo://README.md#L720-L726), [README.md:745-746](repo://README.md#L745-L746)

```bash
cargo install --path .
```

Sources: [README.md:745-746](repo://README.md#L745-L746)

## Inspect the command interface

Use `fd -h` for short help and `fd --help` for the detailed descriptions. The latter is useful for options whose full behavior is intentionally absent from short help, such as exact matching, extra required patterns, and explicit search paths. [[Search Patterns and Roots]] explains how those options become a single search definition.

Sources: [README.md:34-38](repo://README.md#L34-L38), [src/cli.rs:187-211](repo://src/cli.rs#L187-L211), [src/cli.rs:661-672](repo://src/cli.rs#L661-L672)

## Make a first search

Calling `fd` without a pattern lists matching entries recursively under the current directory. With a pattern, the default is a regular-expression search against each entry's name. A lowercase substring such as `netfl` can find a name containing that text, and uppercase characters in a pattern can make the search case-sensitive. The first positional value is the pattern, so a directory to search belongs after it.

Sources: [README.md:40-50](repo://README.md#L40-L50), [README.md:75-94](repo://README.md#L75-L94), [src/cli.rs:130-151](repo://src/cli.rs#L130-L151), [src/cli.rs:630-659](repo://src/cli.rs#L630-L659)

The README's root-selection example searches for names containing `passwd` below `/etc`. For a directory listing without a restrictive name, substitute a match-all pattern such as `.`. Search roots must be directories; invalid roots generate diagnostics, and a search with no valid roots fails before walking.

Sources: [README.md:65-94](repo://README.md#L65-L94), [src/cli.rs:696-720](repo://src/cli.rs#L696-L720), [src/main.rs:83-87](repo://src/main.rs#L83-L87)

```bash
fd passwd /etc
```

Sources: [README.md:65-73](repo://README.md#L65-L73)

## Narrow the results

Use `-e` to filter by extension. The following repository example searches for Markdown names. Extension matching applies to all entry types, including directories whose names have the suffix; add `--type file` if the desired results are regular files. Multiple extensions can be supplied, while a name pattern can narrow the extension-filtered results further.

Sources: [README.md:96-113](repo://README.md#L96-L113), [src/cli.rs:333-349](repo://src/cli.rs#L333-L349), [src/cli.rs:380-393](repo://src/cli.rs#L380-L393)

```bash
fd -e md
```

Sources: [README.md:96-105](repo://README.md#L96-L105)

For a literal full filename, `--exact` escapes regex characters and requires the entire name to match. `--fixed-strings` also escapes regex characters but keeps substring matching. Glob mode uses `-g`; quote patterns containing shell-sensitive characters as the README's glob examples do. These alternatives are described in detail in [[Search Patterns and Roots]].

Sources: [src/main.rs:218-231](repo://src/main.rs#L218-L231), [src/cli.rs:174-198](repo://src/cli.rs#L174-L198), [README.md:185-190](repo://README.md#L185-L190)

## Find entries omitted by defaults

Hidden entries and ignore rules are separate controls. `-H` enables hidden files and directories, while `-I` disables the default ignore-file filtering. Combine them as `-HI`, or use `-u` for both. If an entry is still absent, inspect the depth, exclusion, and metadata options explained in [[Traversal and Filtering]]; enabling hidden entries does not bypass those filters.

Sources: [src/cli.rs:33-60](repo://src/cli.rs#L33-L60), [src/cli.rs:122-128](repo://src/cli.rs#L122-L128), [src/walk.rs:508-591](repo://src/walk.rs#L508-L591)

`--show-errors` exposes filesystem errors encountered during discovery. An empty normal search still exits successfully, whereas `--quiet` reports existence through the exit status and stops on its first result. [[Output and Formatting]] covers these statuses and the distinction between terminal output and NUL-delimited pipeline output.

Sources: [src/main.rs:386-390](repo://src/main.rs#L386-L390), [src/walk.rs:198-231](repo://src/walk.rs#L198-L231), [src/walk.rs:281-292](repo://src/walk.rs#L281-L292), [src/exit_codes.rs:14-21](repo://src/exit_codes.rs#L14-L21)

## Pass matches to a command

Place `-x` after the search pattern and roots, because following arguments belong to the command template. This README example invokes `echo` for each match; a path placeholder is appended automatically when the template contains none. `-X` selects batch execution instead. [[Command Execution]] explains job counts, argument-size limits, and failure behavior before applying the same interface to commands that modify files.

Sources: [README.md:154-182](repo://README.md#L154-L182), [src/exec/mod.rs:245-253](repo://src/exec/mod.rs#L245-L253), [src/exec/mod.rs:173-200](repo://src/exec/mod.rs#L173-L200)

```bash
fd pattern path -x echo
```

Sources: [README.md:179-183](repo://README.md#L179-L183)

## Verify a development checkout

The documented test command runs both unit and integration tests. The integration harness creates temporary directory trees, adds `.git`, `.gitignore`, and `.fdignore` fixtures, and locates the executable through `CARGO_BIN_EXE_fd`. Its output comparison normalizes path separators and sorts lines, so an expected-output assertion does not generally imply that live search output is always sorted.

Sources: [README.md:742-743](repo://README.md#L742-L743), [tests/testenv/mod.rs:28-78](repo://tests/testenv/mod.rs#L28-L78), [tests/testenv/mod.rs:114-133](repo://tests/testenv/mod.rs#L114-L133)

```bash
cargo test
```

Sources: [README.md:742-743](repo://README.md#L742-L743)
