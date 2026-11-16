---
type: concept
title: Platform-Specific Behavior
description: Where fd's behavior, features, and dependencies differ between Unix-like systems, Windows, macOS, and other targets, including gated flags such as --owner, file-type detection, the ls command used by --list-details, path separators, hyperlink hosts, and the optional jemalloc allocator.
tags: [platform, unix, windows, macos, cfg, features, portability]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:13:27.224Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-f5ea23b51c582bb354c81514
    resource: repo://src/filesystem.rs
  - id: openwiki-source-8b3eaed746bb796650559c48
    resource: repo://src/filetypes.rs
  - id: openwiki-source-c7455adc83d664149895de1b
    resource: repo://src/filter/owner.rs
  - id: openwiki-source-bdffa7be827daa0dba122070
    resource: repo://src/hyperlink.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-16T10:13:27.224Z" }
---

# Platform-Specific Behavior

`fd` is one codebase that builds for Linux, macOS, BSDs, Windows, and several cross
<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-ci.md] link "/openwiki/operations/build-release-and-ci.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
targets (see [Build, Release, and CI](/openwiki/operations/build-release-and-ci.md)).
Most differences are handled with `cfg` attributes at the function or flag level, so the
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
shared pipeline in [Architecture Overview](/openwiki/architecture/overview.md) does not
change. This page lists the places where a platform decides what happens, so that a change
on one platform is checked against the others.

## Gated options

- **`--owner` (`-o`).** The flag exists only on Unix (`#[cfg(unix)]` in `src/cli.rs`). The
  `OwnerFilter` type in `src/filter/owner.rs` compares numeric uid and gid from
  `MetadataExt`. Windows builds have no owner filter, and `construct_config` only
  references the field on Unix.
- **`--one-file-system` (`--mount`, `--xdev`).** Compiled for Unix and Windows
  (`#[cfg(any(unix, windows))]`); on other targets the flag is absent.
- **`--list-details` (`-l`).** Accepted everywhere, but the command it runs depends on the
  target: GNU `ls` with `-l -h -d` on Linux and other non-BSD Unix; `gls` when installed,
  otherwise BSD `ls` on macOS and the BSDs; GNU `ls` on Windows only when it is found on
  `PATH`. Any other platform gets an explicit "not supported" error. See
  `determine_ls_command` in `src/main.rs`.

## File-type detection

The `--type` values `block-device`, `char-device`, `socket`, and `pipe` exist on every
platform, but the detection functions in `src/filesystem.rs` are split by `cfg`. On Unix
and Redox they query `FileTypeExt`. On Windows they are stubs that return `false`, so a
Windows search for those types finds nothing and reports no error. The `executable` type
is checked in `src/filetypes.rs` through `faccess::PathExt::executable`, whose rules are
platform-specific.

## Byte handling of file names

`filesystem::osstr_to_bytes` is the bridge between `OsStr` and the byte regex engine:

- On Unix and Redox the raw bytes of the name are used directly, so non-UTF-8 names match
  byte patterns exactly.
- On Windows, names are converted with lossy UTF-8. Names that contain unpaired UTF-16
  surrogates are therefore matched in their replacement-character form.

Patterns are always matched against these bytes, so a Windows-only lossy conversion can
affect matches for unusual names.

## Path separators

- The default separator is the native one. The `--path-separator` option overrides it for
  output.
- On Windows, when the `MSYSTEM` environment variable is set (MSYS2 and Git Bash),
  `default_path_separator` returns `/`, so output matches the shell's conventions.
- On Windows, the separator option must be exactly one byte. Longer values are rejected
  when the configuration is built.
- `--full-path` matching uses the absolute path produced by `absolute_path`, which strips
  the `\\?\` verbatim prefix on Windows.

## Hyperlinks

When hyperlinks are enabled, `PathUrl` writes `file://<host>/<path>`. The host is read
through `nix::unistd::gethostname` on Unix and cached; on other platforms the host is the
constant `/`, which yields `file:///` URLs. Windows backslashes are written as `/`. Bytes outside a safe ASCII set are
percent-encoded, which avoids assuming the path is valid UTF-8.

## Allocator

The `tikv-jemallocator` allocator is compiled in only when the `use-jemalloc` feature is
enabled and the target is not Windows, Android, macOS, FreeBSD, OpenBSD, illumos, 32-bit
musl, or riscv64. The `base` feature enables it. The exclusion list appears in both
`Cargo.toml` and `src/main.rs`, and the two must stay in sync; the file notes that jemalloc
is disabled on macOS because of a known allocator bug.

## Dependencies

- `nix` (signals, users, hostname) and `libc` are compiled only for Unix targets.
- `faccess`, `ctrlc`, `lscolors`, and `nu-ansi-term` are used on all targets, without a
  `cfg` gate. On Windows,
  ANSI color support is probed with `nu_ansi_term::enable_ansi_support`, and
  `TERM` is used as a fallback.
- Shell completion generation is a default feature (`completions`) and does not depend on
  the platform.

## Testing across platforms

The test environment in `tests/testenv/mod.rs` has `cfg` branches for creating symbolic
links, and CI builds the full target matrix. When adding a platform-sensitive
branch, add the Windows and Unix counterpart in the same change; the cross-compiled CI
builds catch compile errors but not behavior differences.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md)
<!-- openwiki: broken internal link [/openwiki/workflows/filtering-entries.md] link "/openwiki/workflows/filtering-entries.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Filtering Entries](/openwiki/workflows/filtering-entries.md)
<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-ci.md] link "/openwiki/operations/build-release-and-ci.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Build, Release, and CI](/openwiki/operations/build-release-and-ci.md)
