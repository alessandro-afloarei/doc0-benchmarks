---
title: "Quickstart"
---
## Overview

Start with a source build, search inside the checkout, and then try a command that prints each match. The executable is `fd`, although the Cargo package is named `fd-find`. The [[Overview]] describes how the same search feeds both ordinary output and command execution; this page provides the first commands to exercise that interface.

Sources: [Cargo.toml:15-32](repo://Cargo.toml#L15-L32), [src/walk.rs:408-440](repo://src/walk.rs#L408-L440)

## Build and install this checkout

The manifest requires Rust 1.90.0 and uses the 2024 edition. The README also lists `make` as a build prerequisite. From the repository root, build and install the local package with the commands below. Installing with `--path .` selects this checkout, whereas the README's separate `cargo install fd-find` command selects the package by its registry name.

Sources: [Cargo.toml:15-21](repo://Cargo.toml#L15-L21), [README.md:720-746](repo://README.md#L720-L746)

```bash
cargo build
cargo install --path .
```

Sources: [README.md:734-746](repo://README.md#L734-L746)

These are the project's ordinary development and installation commands. When changing the implementation, the same README workflow adds `cargo test` between building and installing. [[Development and Testing]] explains the feature configuration and integration harness behind that check, so the first-use procedure does not need to reproduce the contributor workflow.

Sources: [README.md:734-746](repo://README.md#L734-L746), [Cargo.toml:94-98](repo://Cargo.toml#L94-L98), [tests/testenv/mod.rs:13-26](repo://tests/testenv/mod.rs#L13-L26)

## Read help and search a directory

Use `fd -h` for concise help and `fd --help` for the detailed descriptions. With no pattern or roots, `fd` searches the current directory recursively. Supplying one positional argument makes it the search pattern; directory roots come after that pattern. For a named directory with no restrictive name condition, supply a match-all pattern such as `.` before the directory.

Sources: [README.md:34-38](repo://README.md#L34-L38), [README.md:75-94](repo://README.md#L75-L94), [src/cli.rs:695-721](repo://src/cli.rs#L695-L721)

The following example is the CLI's documented way to search `src` and echo each result. Remove `-x echo` to use fd's ordinary path output. Keeping the root after the pattern avoids treating `src` as the filename search expression.

Sources: [src/cli.rs:894-915](repo://src/cli.rs#L894-L915), [src/walk.rs:408-440](repo://src/walk.rs#L408-L440)

```bash
fd . src -x echo
```

Sources: [src/cli.rs:914-915](repo://src/cli.rs#L914-L915)

Ordinary searches match the basename, even though the displayed result contains a path. A pattern containing `/` is rejected unless full-path matching is enabled. [[Search Patterns]] explains why `--full-path` changes the string being matched, while `--absolute-path` controls how roots are normalized for output. This distinction helps when a visible directory component does not match an otherwise plausible pattern.

Sources: [src/main.rs:169-215](repo://src/main.rs#L169-L215), [src/walk.rs:656-677](repo://src/walk.rs#L656-L677), [src/cli.rs:723-735](repo://src/cli.rs#L723-L735)

## Narrow the results

An extension filter can stand alone or accompany a name pattern. The README's `fd -e md` example selects Markdown extensions, while `fd -e rs mod` combines an extension with a basename pattern. Extensions do not imply regular files: add `--type file` when directories with matching suffixes should be excluded. [[File Filters]] details how repeated extension and type options combine.

Sources: [README.md:96-113](repo://README.md#L96-L113), [src/cli.rs:333-378](repo://src/cli.rs#L333-L378), [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/walk.rs:526-542](repo://src/walk.rs#L526-L542)

```bash
fd -e md
fd -e rs mod
```

Sources: [README.md:96-113](repo://README.md#L96-L113)

Choose `--glob` for a glob expression, `--fixed-strings` for a literal substring, or `--exact` for an entire literal filename. Exact matching escapes special regular-expression characters and anchors both ends; it still uses the configured case behavior. The pattern modes and smart-case rules are developed in [[Search Patterns]], including how additional `--and` patterns constrain the same entry.

Sources: [src/cli.rs:153-211](repo://src/cli.rs#L153-L211), [src/main.rs:218-255](repo://src/main.rs#L218-L255)

## Find entries hidden by defaults

Use `--hidden` or `-H` to include hidden names, and `--no-ignore` or `-I` to disable the normal ignore-file rules. These controls are separate: enabling hidden entries alone does not disable ignore patterns. `--unrestricted` or `-u` combines them. Explicit exclusions, depth limits and other filters can still narrow the search, so unrestricted visibility is not a promise that every filesystem entry will be returned.

Sources: [src/cli.rs:33-60](repo://src/cli.rs#L33-L60), [src/cli.rs:122-128](repo://src/cli.rs#L122-L128), [src/walk.rs:352-365](repo://src/walk.rs#L352-L365), [src/walk.rs:508-542](repo://src/walk.rs#L508-L542)

When a result is missing, first check that the root is an existing directory, then consider visibility and the match target. Invalid explicit roots produce diagnostics and are removed from the root list; if none remain, setup fails. [[Traversal and Ignore Rules]] describes parent, global and repository-specific ignore sources and the `--show-errors` option for traversal diagnostics.

Sources: [src/cli.rs:695-721](repo://src/cli.rs#L695-L721), [src/main.rs:83-87](repo://src/main.rs#L83-L87), [src/walk.rs:347-396](repo://src/walk.rs#L347-L396), [src/main.rs:386-386](repo://src/main.rs#L386-L386)

## Use the matches

The earlier `-x echo` example runs a command per result. Place `-x` after fd's pattern, roots and options, because subsequent arguments belong to the external command until a literal semicolon terminates the template. `-X` selects batch execution. [[Command Execution]] explains placeholder substitution, concurrency, argument limits and child-process failures before applying this interface to commands that change files.

Sources: [src/cli.rs:882-915](repo://src/cli.rs#L882-L915), [src/exec/mod.rs:90-120](repo://src/exec/mod.rs#L90-L120), [src/exec/mod.rs:173-203](repo://src/exec/mod.rs#L173-L203)

For pipeline input, `-0` uses a NUL separator. The README demonstrates pairing it with `xargs -0`; [[Output and Formatting]] explains the related path-prefix policy, raw Unix path output, and why fast searches may appear sorted while longer searches stream. A normal search can succeed with no matches; quiet mode is the interface that turns match presence into a status result.

Sources: [README.md:528-537](repo://README.md#L528-L537), [src/output.rs:167-182](repo://src/output.rs#L167-L182), [src/cli.rs:674-680](repo://src/cli.rs#L674-L680), [src/walk.rs:198-245](repo://src/walk.rs#L198-L245), [src/walk.rs:282-292](repo://src/walk.rs#L282-L292), [src/exit_codes.rs:14-21](repo://src/exit_codes.rs#L14-L21)
