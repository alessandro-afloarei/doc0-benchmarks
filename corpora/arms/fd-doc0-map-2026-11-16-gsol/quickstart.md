---
title: "Quickstart"
---
## Overview

Start here to build `fd` from this repository and try its filesystem search. The checkout declares the Cargo package `fd-find` and the executable `fd`; its minimum Rust version is 1.90.0 and it uses Rust edition 2024. The [[Overview]] maps the search pipeline, while this page follows a first invocation from build to useful results.

Sources: [Cargo.toml:15-31](repo://Cargo.toml#L15-L31), [src/main.rs:75-112](repo://src/main.rs#L75-L112)

## Build and verify the checkout

Have Rust 1.90.0 or later, Cargo, and `make` available. From the repository root, build the binary, run the existing unit and integration tests, and optionally install this checkout. The repository's development instructions use the following Cargo commands; installing from the current path selects this source tree rather than the package registry.

Sources: [README.md:720-746](repo://README.md#L720-L746), [Cargo.toml:20-31](repo://Cargo.toml#L20-L31)

```bash
cargo build
```

Sources: [README.md:738-740](repo://README.md#L738-L740)

```bash
cargo test
```

Sources: [README.md:742-743](repo://README.md#L742-L743)

```bash
cargo install --path .
```

Sources: [README.md:745-746](repo://README.md#L745-L746)

The integration harness creates temporary directories and files, adds a `.git` directory so Git ignore behavior is active, and writes sample `.fdignore` and `.gitignore` files. It discovers the executable through `CARGO_BIN_EXE_fd`. On Windows, its symlink setup requires the privilege to create symbolic links, which the source notes is normally granted to administrators. These details help distinguish an environment issue during tests from a search behavior failure.

Sources: [tests/testenv/mod.rs:28-79](repo://tests/testenv/mod.rs#L28-L79)

## Perform a first search

Run `fd -h` for concise help or `fd --help` for detailed help. A basic invocation such as `fd netfl` recursively looks for entries whose names contain that pattern. With no pattern, every entry is considered a match; with no root directory, the search starts in the current working directory. The returned entries still pass the default visibility rules, so this first listing excludes hidden and ignored content.

Sources: [README.md:34-50](repo://README.md#L34-L50), [src/cli.rs:628-672](repo://src/cli.rs#L628-L672), [src/main.rs:310-320](repo://src/main.rs#L310-L320)

To search elsewhere, place the pattern first and the root second: the repository's example `fd passwd /etc` searches under `/etc`. To list everything visible beneath a chosen root, use a match-all pattern such as `fd . fd/tests/`. A directory is the second positional argument because the first positional argument always occupies the pattern slot; [[Search Patterns and Roots]] explains the alternative `--search-path` form and root validation.

Sources: [README.md:65-94](repo://README.md#L65-L94), [src/cli.rs:628-672](repo://src/cli.rs#L628-L672)

## Refine the match

The default pattern is a regular expression. The example `fd '^x.*rc$'` selects names starting with `x` and ending with `rc`. For glob syntax, `fd -g libc.so /usr` matches the glob as a filename. Use `--fixed-strings` for a literal substring or `--exact` for a complete literal name. Matching is case insensitive unless smart case detects uppercase content or you select `--case-sensitive`; `--ignore-case` forces insensitive matching. [[Search Patterns and Roots]] follows these choices into the actual regex builder.

Sources: [README.md:52-61](repo://README.md#L52-L61), [README.md:115-122](repo://README.md#L115-L122), [src/cli.rs:130-198](repo://src/cli.rs#L130-L198), [src/main.rs:218-231](repo://src/main.rs#L218-L231), [src/main.rs:248-255](repo://src/main.rs#L248-L255)

Use `fd -e md` to select entries ending in the Markdown extension, or combine a pattern and extension as in `fd -e rs mod`. Add `--type file` when the result must be a regular file: extension matching alone also admits directories with the requested suffix. Multiple extensions can be supplied, while the pattern and extension requirements both apply. [[File Filters]] describes how these name checks combine with type, size, modification time, and ownership predicates.

Sources: [README.md:96-113](repo://README.md#L96-L113), [src/cli.rs:333-393](repo://src/cli.rs#L333-L393), [src/walk.rs:519-542](repo://src/walk.rs#L519-L542)

## Choose how to consume results

Ordinary searches print one result per line. `--print0` changes the delimiter to a NUL character for consumers that need explicit record boundaries. `--quiet` prints nothing and returns status 0 if a match exists or 1 if none exists. A normal search with no matches instead finishes successfully. [[Result Output]] explains delimiters, path rendering, quiet mode, and why a short result list may be sorted while a longer search streams discoveries.

Sources: [src/output.rs:38-42](repo://src/output.rs#L38-L42), [src/cli.rs:266-276](repo://src/cli.rs#L266-L276), [src/cli.rs:588-601](repo://src/cli.rs#L588-L601), [src/walk.rs:198-216](repo://src/walk.rs#L198-L216), [src/walk.rs:281-292](repo://src/walk.rs#L281-L292)

To run a command for each match, place `-x` last among `fd`'s options. The repository's `fd -e zip -x unzip` example runs `unzip` for each matching archive; arguments after `-x` belong to the command template. `-X` selects batch execution, which accepts multiple paths per invocation. [[Command Execution]] explains placeholder insertion, parallel jobs, batch splitting, and how failed child processes affect the final status.

Sources: [README.md:154-180](repo://README.md#L154-L180), [src/exec/mod.rs:173-203](repo://src/exec/mod.rs#L173-L203), [src/exec/mod.rs:250-253](repo://src/exec/mod.rs#L250-L253)

## Diagnose missing results

If an expected entry is absent, first check visibility: `-H` includes hidden files and directories, `-I` disables ignore-file filtering, and `-u` combines both. These controls address different causes, so including hidden entries alone does not undo an ignore rule. [[Ignore Rules and Traversal]] covers parent and global ignores, explicit excludes, symlink following, and depth limits that can also narrow the search.

Sources: [src/cli.rs:33-60](repo://src/cli.rs#L33-L60), [src/cli.rs:122-128](repo://src/cli.rs#L122-L128), [src/walk.rs:347-403](repo://src/walk.rs#L347-L403)

If a pattern contains directory separators, either supply that directory as a root with a match-all pattern or enable `--full-path` to match absolute paths. Startup checks diagnose this confusion before traversal. For traversal problems such as inaccessible directories, enable `--show-errors`; otherwise filesystem errors are not printed by the receiver. These checks are separate from a valid search producing no matching entries.

Sources: [src/main.rs:169-215](repo://src/main.rs#L169-L215), [src/cli.rs:603-611](repo://src/cli.rs#L603-L611), [src/walk.rs:227-231](repo://src/walk.rs#L227-L231)
