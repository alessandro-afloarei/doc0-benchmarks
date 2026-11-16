---
title: "Quickstart"
---
## Overview

Start with a local build, use `fd` to search names, and then add the options needed for your selection or output. This checkout declares Rust edition 2024 and a minimum Rust version of 1.90.0. The package is `fd-find`, but the installed binary is named `fd`. The repository documents Cargo as its development workflow and also provides a Makefile for release builds, completion files, and installation assets.

Sources: [Cargo.toml:16-31](repo://Cargo.toml#L16-L31), [README.md:720-747](repo://README.md#L720-L747), [Makefile:1-18](repo://Makefile#L1-L18), [Makefile:44-52](repo://Makefile#L44-L52)

## Build and install this checkout

From the repository root, build the executable, run the test suite, and install the local package when ready. The following commands are the repository's documented development sequence; installing with `--path .` selects this checkout, whereas the separate `cargo install fd-find` instruction installs the named package.

Sources: [README.md:720-746](repo://README.md#L720-L746)

```bash
cargo build
cargo test
cargo install --path .
```

Sources: [README.md:738-746](repo://README.md#L738-L746)

The default feature set enables completion generation. `use-jemalloc` is an optional feature, also included by `base`; the allocator dependency and global allocator are gated to selected platforms. The development profile keeps line-table debug information, the `debugging` profile enables full debug information, and the release profile enables link-time optimization, stripping, and a single codegen unit. Those are build choices in this checkout, independent of the options used for an individual search.

Sources: [Cargo.toml:65-98](repo://Cargo.toml#L65-L98), [src/main.rs:38-54](repo://src/main.rs#L38-L54)

## Run a first search

After installation, `fd` with no pattern searches from the current working directory and treats every entry as a name match. Supplying a pattern narrows names; supplying a directory after the pattern changes the search root. For example, `fd . src` selects entries beneath `src`, and `fd -e rs mod` combines an extension constraint with a name pattern. The distinction between a filename pattern and a directory argument is developed in [[Search Patterns and Paths]].

Sources: [src/cli.rs:628-639](repo://src/cli.rs#L628-L639), [src/cli.rs:652-672](repo://src/cli.rs#L652-L672), [src/cli.rs:696-720](repo://src/cli.rs#L696-L720), [README.md:102-109](repo://README.md#L102-L109), [src/main.rs:203-210](repo://src/main.rs#L203-L210)

```bash
fd
fd . src
fd -e rs mod
```

Sources: [src/cli.rs:628-639](repo://src/cli.rs#L628-L639), [src/main.rs:203-210](repo://src/main.rs#L203-L210), [README.md:102-109](repo://README.md#L102-L109)

A normal pattern is a regular expression, so punctuation can carry matching syntax. `--fixed-strings` escapes a pattern for literal substring matching, `--exact` adds full-string anchors around an escaped pattern, and `--glob` translates a glob into a regular expression. To search for a pattern beginning with a dash, put `--` before it. These modes and smart-case behavior are explained together in [[Search Patterns and Paths]].

Sources: [src/main.rs:218-231](repo://src/main.rs#L218-L231), [src/cli.rs:628-637](repo://src/cli.rs#L628-L637)

## Adjust what can appear

Missing results can be a discovery-policy issue. Hidden entries and ignored entries are controlled separately: `-H` includes hidden paths, `-I` disables the normal ignore-file checks, and `-u` combines those changes. Exclusions supplied with `-E` are still built as walker overrides. [[Traversal and Ignore Rules]] explains those settings, including Git-related ignore behavior and the effect of pruning a directory before its children are visited.

Sources: [src/main.rs:310-320](repo://src/main.rs#L310-L320), [src/main.rs:380-381](repo://src/main.rs#L380-L381), [src/cli.rs:33-60](repo://src/cli.rs#L33-L60), [src/cli.rs:122-127](repo://src/cli.rs#L122-L127), [src/walk.rs:330-365](repo://src/walk.rs#L330-L365)

Selection can then narrow accepted entries. `--type file` restricts results to regular files, while repeated ordinary types include more than one kind. Extensions apply to names of all entry types unless a type restriction is also supplied. Size and modification-time constraints add further checks; [[Result Filters]] explains their exact boundaries and how multiple constraints combine.

Sources: [src/cli.rs:333-417](repo://src/cli.rs#L333-L417), [src/cli.rs:419-458](repo://src/cli.rs#L419-L458), [src/walk.rs:557-591](repo://src/walk.rs#L557-L591)

## Choose what to do with results

| Need | Option or command | Behavior |
| --- | --- | --- |
| Detect whether a match exists | `fd -q pattern` | Print no paths; return 0 for a match and 1 otherwise |
| Delimit paths with NUL | `fd -0 pattern` | Use a NUL terminator instead of a newline |
| Format each path | `--format '{/}'` | Render the basename placeholder |
| Run a command for each entry | `fd . src -x echo` | Execute one command per result |
| Pass results to a batch command | `fd -e rs -X wc -l` | Supply result paths as command arguments |

Sources: [src/cli.rs:267-276](repo://src/cli.rs#L267-L276), [src/cli.rs:475-487](repo://src/cli.rs#L475-L487), [src/cli.rs:588-601](repo://src/cli.rs#L588-L601), [src/cli.rs:883-948](repo://src/cli.rs#L883-L948)

Place command execution options last because their following arguments belong to the child command until a semicolon terminator. [[Command Execution]] covers parallel jobs, batch splitting, and child failures. For ordinary printing, [[Output and Formatting]] explains why small searches may appear sorted, how terminal output differs from piped output, and which transformations preserve filename bytes.

Sources: [src/cli.rs:883-908](repo://src/cli.rs#L883-L908), [src/walk.rs:198-245](repo://src/walk.rs#L198-L245), [src/walk.rs:282-292](repo://src/walk.rs#L282-L292), [src/output.rs:167-181](repo://src/output.rs#L167-L181)

## Verify a development change

The integration harness creates a temporary directory tree, a synthetic `.git` directory so Git ignores apply, `.fdignore` and `.gitignore` files, and a symlink. It locates the Cargo-built binary through `CARGO_BIN_EXE_fd`. This lets tests exercise command-line behavior against controlled filesystem fixtures instead of depending on the developer's project tree.

Sources: [tests/testenv/mod.rs:28-79](repo://tests/testenv/mod.rs#L28-L79)

Ordinary output assertions normalize path separators and sort lines before comparison. Tests using that path verify the set of results, not their arrival order; the raw-output assertion compares bytes directly. On Windows, the harness notes that creating symlinks requires the corresponding privilege. These details matter when reproducing a platform-specific failure or adding a test for byte preservation or ordering.

Sources: [tests/testenv/mod.rs:49-55](repo://tests/testenv/mod.rs#L49-L55), [tests/testenv/mod.rs:114-134](repo://tests/testenv/mod.rs#L114-L134), [tests/testenv/mod.rs:234-257](repo://tests/testenv/mod.rs#L234-L257)

The CI workflow checks formatting, runs Clippy with warnings denied, and runs locked tests against the minimum supported Rust version with all features. Its build matrix includes Linux, macOS, and Windows targets, with reduced test selection on ARM-family targets. To match the local formatting and lint checks, use the commands below alongside the development test command.

Sources: [.github/workflows/CICD.yml:3-5](repo://.github/workflows/CICD.yml#L3-L5), [.github/workflows/CICD.yml:42-84](repo://.github/workflows/CICD.yml#L42-L84), [.github/workflows/CICD.yml:98-111](repo://.github/workflows/CICD.yml#L98-L111), [.github/workflows/CICD.yml:182-198](repo://.github/workflows/CICD.yml#L182-L198)

```bash
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -Dwarnings
```

Sources: [.github/workflows/CICD.yml:42-64](repo://.github/workflows/CICD.yml#L42-L64)

## Generate completions and install assets

With the default completion feature, `fd --gen-completions bash` prints completion data and exits before setting up a search. The program name comes from the executable's file stem. The Makefile's `completions` target generates Bash, Fish, and PowerShell files and copies maintained Zsh and `fdfind` variants. Its install target also installs the manual page; the default prefix is `/usr/local` and can be configured through Make variables.

Sources: [Cargo.toml:94-98](repo://Cargo.toml#L94-L98), [src/main.rs:75-83](repo://src/main.rs#L75-L83), [src/main.rs:114-128](repo://src/main.rs#L114-L128), [Makefile:1-52](repo://Makefile#L1-L52)
