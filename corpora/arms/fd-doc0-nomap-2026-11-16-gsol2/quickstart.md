---
title: "Quickstart"
---
## Overview

Build the repository's `fd` executable, search a name, then narrow the search with a root and filters. The binary accepts an optional pattern followed by optional directory roots. With neither supplied, it searches the current working directory recursively. [[fd Overview]] describes where this invocation enters the search and output pipeline.

Sources: [Cargo.toml:29-31](repo://Cargo.toml#L29-L31), [src/cli.rs:628-639](repo://src/cli.rs#L628-L639), [src/cli.rs:652-659](repo://src/cli.rs#L652-L659), [src/cli.rs:695-721](repo://src/cli.rs#L695-L721), [README.md:75-94](repo://README.md#L75-L94)

## Build and install the checkout

This checkout declares Rust 1.90.0 as its minimum version and uses edition 2024. From the repository root, build it with Cargo, then install the local package if you want to invoke it as `fd` from your shell. The executable name differs from the package name, `fd-find`; the commands below install this working tree.

Sources: [Cargo.toml:16-31](repo://Cargo.toml#L16-L31), [README.md:734-747](repo://README.md#L734-L747)

```bash
cargo build
cargo install --path .
```

Sources: [README.md:738-746](repo://README.md#L738-L746)

The project also documents `cargo install fd-find` for installing the published package from source. For work on this repository, [[Development]] covers tests, feature flags, CI checks and completion generation after the initial build. The default Cargo feature enables completions, so the ordinary build includes that command-line facility.

Sources: [README.md:720-726](repo://README.md#L720-L726), [README.md:742-778](repo://README.md#L742-L778), [Cargo.toml:94-98](repo://Cargo.toml#L94-L98)

## Run a filename search

Use a short name fragment for the first search. A pattern is a regular expression by default, and an unanchored expression can match part of a filename. The documented example searches for a script whose name contains `netfl`. Run concise help with `fd -h` or detailed help with `fd --help` to inspect the available options.

Sources: [README.md:34-63](repo://README.md#L34-L63), [src/main.rs:218-231](repo://src/main.rs#L218-L231)

```bash
fd netfl
fd -h
fd --help
```

Sources: [README.md:36-50](repo://README.md#L36-L50)

With no pattern, every entry is considered a match before visibility and other filters apply. Supplying a pattern makes it the first positional argument; a directory after it becomes the root. To list entries in a specific directory, use a catch-all pattern such as `.`. The root itself is skipped by the walker, while descendants are considered for results.

Sources: [src/cli.rs:628-639](repo://src/cli.rs#L628-L639), [src/cli.rs:652-659](repo://src/cli.rs#L652-L659), [README.md:87-94](repo://README.md#L87-L94), [src/walk.rs:480-483](repo://src/walk.rs#L480-L483)

## Choose the search roots

To search inside this checkout's source tree, provide `src` after the pattern. Several positional paths supply several roots. Alternatively, repeat `--search-path`; that form lets you specify roots without filling the pattern position. These two ways of supplying roots conflict, so choose one form for an invocation.

Sources: [src/cli.rs:652-672](repo://src/cli.rs#L652-L672), [src/walk.rs:398-403](repo://src/walk.rs#L398-L403)

```bash
fd . src
fd mod src tests
fd --search-path src --search-path tests
```

Sources: [src/cli.rs:628-639](repo://src/cli.rs#L628-L639), [src/cli.rs:652-672](repo://src/cli.rs#L652-L672), [src/cli.rs:695-721](repo://src/cli.rs#L695-L721)

`--base-directory` changes the process working directory before roots are resolved. Relative roots then refer to that base, and results are presented relative to it unless other path options intervene. Invalid explicit roots produce diagnostics and are discarded; if no valid roots remain, startup returns an error. [[Traversal and Ignore Rules]] follows root selection into the directory walker.

Sources: [src/main.rs:83-87](repo://src/main.rs#L83-L87), [src/main.rs:131-147](repo://src/main.rs#L131-L147), [src/cli.rs:613-626](repo://src/cli.rs#L613-L626), [src/cli.rs:707-720](repo://src/cli.rs#L707-L720)

## Narrow the results

An extension option and a search pattern work together: the name must match the pattern and its extension must match one of the requested suffixes. For a first source-code search, use the documented `fd -e rs mod`. Add `--type file` when only regular files should be accepted, since an extension alone can also match a directory name. [[Entry Filters]] explains how repeated extensions and other constraints combine.

Sources: [README.md:96-113](repo://README.md#L96-L113), [src/cli.rs:333-349](repo://src/cli.rs#L333-L349), [src/cli.rs:380-393](repo://src/cli.rs#L380-L393), [src/walk.rs:519-541](repo://src/walk.rs#L519-L541)

Choose `--fixed-strings` for a literal substring, `--exact` for a whole literal filename, or `--glob` for wildcard matching. Default smart case makes a pattern containing uppercase characters case-sensitive; `--ignore-case` forces the insensitive form. Use [[Search Patterns]] when punctuation, anchors or multiple required patterns change the result you expect.

Sources: [src/cli.rs:130-198](repo://src/cli.rs#L130-L198), [src/main.rs:218-231](repo://src/main.rs#L218-L231), [src/main.rs:248-255](repo://src/main.rs#L248-L255)

## Find entries hidden by the defaults

When a file is missing, first check whether it is hidden or ignored. `--hidden` includes hidden entries while keeping ignore rules active. `--no-ignore` disables the usual ignore files while retaining the hidden-entry filter. `--unrestricted` combines those controls. These switches alter which entries reach the pattern matcher; they do not change the pattern itself.

Sources: [src/cli.rs:33-60](repo://src/cli.rs#L33-L60), [src/cli.rs:122-128](repo://src/cli.rs#L122-L128), [src/main.rs:310-320](repo://src/main.rs#L310-L320), [src/walk.rs:352-368](repo://src/walk.rs#L352-L368)

A slash in a filename pattern causes an early diagnostic. To search *inside* a directory, put it in a root argument; to match directory components, enable `--full-path`. On Unix, a pattern that can only match a leading dot can also trigger a diagnostic suggesting `--hidden`. [[Search Patterns]] explains both checks, and [[Traversal and Ignore Rules]] covers the ignore controls in detail.

Sources: [src/main.rs:169-215](repo://src/main.rs#L169-L215), [src/main.rs:521-538](repo://src/main.rs#L521-L538)

## Consume the matches

Ordinary searches print paths. For a read-only command example, count lines in Rust matches with the project's documented batch command below. Put `-X` last: arguments that follow it belong to the external command. [[Command Execution]] covers argument substitution, automatic batching and failure status, while [[Result Output]] explains NUL delimiters, templates and output ordering.

Sources: [src/walk.rs:408-439](repo://src/walk.rs#L408-L439), [src/cli.rs:895-908](repo://src/cli.rs#L895-L908), [src/cli.rs:922-949](repo://src/cli.rs#L922-L949), [src/cli.rs:266-276](repo://src/cli.rs#L266-L276), [src/cli.rs:475-487](repo://src/cli.rs#L475-L487)

```bash
fd -e rs -X wc -l
```

Sources: [src/cli.rs:947-948](repo://src/cli.rs#L947-L948)

For scripts that only need to know whether a match exists, use `--quiet`: it prints no results and exits with status 0 for a match or 1 without one. A normal search can succeed with no matches, so quiet mode expresses a different status contract from ordinary listing.

Sources: [src/cli.rs:588-601](repo://src/cli.rs#L588-L601), [src/walk.rs:203-206](repo://src/walk.rs#L203-L206), [src/walk.rs:281-292](repo://src/walk.rs#L281-L292)
