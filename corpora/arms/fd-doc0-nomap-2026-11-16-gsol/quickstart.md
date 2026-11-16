---
title: "Quickstart"
---
## Overview

This walkthrough builds the repository's `fd` executable and uses it to find entries, narrow a search, and pass results to a command. The package is named `fd-find`, while its binary target is `fd`. The [[Overview]] explains the search engine behind these commands; here the focus is a working local installation and a few searches you can adapt.

Sources: [Cargo.toml:1-31](repo://Cargo.toml#L1-L31), [src/walk.rs:408-439](repo://src/walk.rs#L408-L439)

## Build and install

Use Rust 1.90.0 or later, the minimum declared by this checkout. From the repository root, build the application and optionally install it with Cargo. The repository's development instructions provide these commands; installing with `--path .` selects this checkout. If you want to work on the implementation, [[Development and Testing]] explains the test harness, features, and release-oriented build settings.

Sources: [Cargo.toml:19-21](repo://Cargo.toml#L19-L21), [README.md:734-747](repo://README.md#L734-L747)

```bash
cargo build
cargo install --path .
```

Sources: [README.md:738-746](repo://README.md#L738-L746)

For a Cargo installation from the published package rather than this checkout, the README uses `cargo install fd-find`. The package name matters: it differs from the executable name used throughout these docs. The Makefile provides another build and installation route, including completions and the man page, which is covered in [[Development and Testing]].

Sources: [README.md:720-728](repo://README.md#L720-L728), [Cargo.toml:16-31](repo://Cargo.toml#L16-L31), [Makefile:8-52](repo://Makefile#L8-L52)

## Perform a first search

After installation, run `fd -h` for concise help or `fd --help` for the longer option descriptions. The basic interface is an optional pattern followed by optional root directories. With no roots, the application searches the current working directory; with no pattern, it treats every eligible entry as a match. This makes a bare `fd` a recursive listing subject to the default visibility and ignore policies.

Sources: [README.md:34-38](repo://README.md#L34-L38), [src/cli.rs:628-672](repo://src/cli.rs#L628-L672), [src/cli.rs:696-705](repo://src/cli.rs#L696-L705)

```bash
fd
fd netfl
fd passwd /etc
```

Sources: [README.md:40-85](repo://README.md#L40-L85)

The second command searches names containing the regex `netfl`. The third searches under `/etc` for names matching `passwd`. These examples search filenames or directory names rather than file contents. To search a directory without narrowing names, supply a match-all pattern before that directory, such as `fd . fd/tests/`. [[Search Patterns]] covers whole-name glob searches, exact literal matching, and matching the full absolute path.

Sources: [README.md:40-94](repo://README.md#L40-L94), [src/cli.rs:255-264](repo://src/cli.rs#L255-L264)

## Narrow the candidates

An extension filter is a useful next step when you know the kind of source file you want. The README's `fd -e md` example lists Markdown entries, while `fd -e rs mod` combines an extension with a name pattern. Extension filtering can include directories whose names end in that extension, so add `--type file` when you specifically want regular files. [[Metadata Filters]] explains how repeated extensions and file types combine with the other constraints.

Sources: [README.md:96-113](repo://README.md#L96-L113), [src/cli.rs:333-393](repo://src/cli.rs#L333-L393)

```bash
fd -e md
fd -e rs mod
fd -g libc.so /usr
```

Sources: [README.md:96-122](repo://README.md#L96-L122)

The glob example looks for the provided whole name instead of applying the default regex substring search. When the pattern has regex punctuation that should be literal, choose `--fixed-strings` for a substring or `--exact` for the complete filename. These choices affect the pattern, while the search roots remain separate arguments; [[Search Patterns]] follows the conversion and validation that make this distinction explicit.

Sources: [src/cli.rs:153-198](repo://src/cli.rs#L153-L198), [src/main.rs:169-230](repo://src/main.rs#L169-L230)

## Find entries hidden by defaults

If an expected result is missing, check hidden-file handling and ignore rules. `-H` includes hidden entries; `-I` disables ignore-file filtering. They are separate controls, and `-u` combines them as an unrestricted search. A hidden directory can prevent traversal into its contents, so searching for a visible filename inside it still requires hidden-directory traversal. [[Traversal and Ignore Rules]] explains the specific ignore sources and the controls for links and depth.

Sources: [src/cli.rs:33-60](repo://src/cli.rs#L33-L60), [src/cli.rs:122-128](repo://src/cli.rs#L122-L128), [src/walk.rs:352-368](repo://src/walk.rs#L352-L368)

For a deliberately shallow search, use `--max-depth`; for a search rooted elsewhere but displayed relative to that location, use `--base-directory`. The application changes its working directory before resolving the roots, so relative root arguments are interpreted from the supplied base. These options let you change the search scope without putting a directory path into the name-pattern position.

Sources: [src/cli.rs:278-308](repo://src/cli.rs#L278-L308), [src/cli.rs:613-626](repo://src/cli.rs#L613-L626), [src/main.rs:83-89](repo://src/main.rs#L83-L89), [src/main.rs:131-146](repo://src/main.rs#L131-L146)

## Act on the results

To run a command for each result, put `-x` and the command after the search arguments. To pass results together, use capital `-X`. The CLI examples below echo each entry under `src` or count lines across Rust entries. Arguments after either execution option belong to the external command until a semicolon terminator, so placing the execution option last keeps the boundary clear. [[Command Execution]] covers concurrency, batching limits and failures.

Sources: [src/cli.rs:883-948](repo://src/cli.rs#L883-L948)

```bash
fd . src -x echo
fd -e rs -X wc -l
```

Sources: [src/cli.rs:914-915](repo://src/cli.rs#L914-L915), [src/cli.rs:947-948](repo://src/cli.rs#L947-L948)

For an ordinary shell pipeline, `-0` changes the record separator to NUL. The repository demonstrates it with `xargs -0`, so both producer and consumer agree on record boundaries. For a script that only needs to know whether a match exists, use `--quiet`: it prints no paths and returns zero on a match or one otherwise. [[Output and Pipelines]] explains path bytes, terminal formatting and why result ordering can vary between searches.

Sources: [README.md:527-536](repo://README.md#L527-L536), [src/cli.rs:588-601](repo://src/cli.rs#L588-L601), [src/walk.rs:198-244](repo://src/walk.rs#L198-L244), [src/walk.rs:281-291](repo://src/walk.rs#L281-L291)

## Interpret a failed invocation

An invalid root is reported as a directory error; if every supplied root is invalid, startup fails because no valid search paths remain. A slash in a name pattern also produces a diagnostic suggesting either a match-all pattern with a separate root or `--full-path`. If permissions or other filesystem failures need investigation, `--show-errors` enables their display during traversal.

Sources: [src/cli.rs:707-720](repo://src/cli.rs#L707-L720), [src/main.rs:83-89](repo://src/main.rs#L83-L89), [src/main.rs:185-215](repo://src/main.rs#L185-L215), [src/cli.rs:603-611](repo://src/cli.rs#L603-L611)
