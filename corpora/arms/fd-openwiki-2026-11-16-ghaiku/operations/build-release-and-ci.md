---
type: operations
title: Build, Release, and CI
description: How fd is built locally and for release, covering Cargo features and profiles, the Makefile targets for the binary, shell completions, and installation, the GitHub Actions workflow with its format, lint, MSRV, and cross-target jobs, the packaging and publishing steps, and the manual release checklist.
tags: [build, cargo, makefile, ci, release, packaging, completions, msrv]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:13:27.224Z
sources:
  - id: openwiki-source-4905fab56ecf9fa5e1ebbf3f
    resource: repo://.cargo/config.toml
  - id: openwiki-source-dddf858b6f600d9339e1373d
    resource: repo://.github/workflows/CICD.yml
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-0bc9c609aef896964e961315
    resource: repo://Cross.toml
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
generated: { by: "claude-code", at: "2026-11-16T10:13:27.224Z" }
---

# Build, Release, and CI

This page describes how the `fd` binary is produced and shipped: local builds through Cargo and
the Makefile, the GitHub Actions pipeline that gates every change, and the steps that turn a
version tag into published artifacts. Day-to-day validation commands are covered in
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Testing Strategy](/openwiki/testing/test-strategy.md).

## Cargo configuration

The crate is `fd-find` (binary `fd`), edition 2024, with a minimum supported Rust version
declared in `Cargo.toml` as `rust-version`. The release profile enables LTO, strips symbols,
and uses a single codegen unit. The development profile keeps line tables only, and the
`debugging` profile inherits dev with full debug info.

Features:

| Feature | Effect |
| --- | --- |
| `completions` (default) | Adds `clap_complete` and the hidden `--gen-completions [shell]` option. |
| `use-jemalloc` | Enables `tikv-jemallocator` as the global allocator on supported targets. |
| `base` | Enables `use-jemalloc`. |

<!-- openwiki: broken internal link [/openwiki/concepts/platform-support.md] link "/openwiki/concepts/platform-support.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The allocator choice is target-dependent; see [Platform-Specific Behavior](/openwiki/concepts/platform-support.md)
for the exclusion list. Static C runtime linking for the MSVC targets and the page-size
setting for aarch64 cross builds are set in `.cargo/config.toml` and `Cross.toml`.

## Makefile targets

The `Makefile` wraps Cargo for packaging workflows:

- **`$(EXE)`** (`target/release/fd`) runs `cargo build --profile release --locked`.
- **`completions`** generates `autocomplete/fd.bash`, `fd.fish`, `_fd.ps1` (PowerShell), and
  copies the static zsh and `fdfind` completion files from `contrib/completion/`. The generated
  scripts come from `fd --gen-completions <shell>`.
- **`install`** installs the binary, the generated completion files, and `doc/fd.1` into
  `$(DESTDIR)$(prefix)`, with `prefix` defaulting to `/usr/local`.

`autocomplete/` is ignored by Git, so these artifacts are generated per build.

## Continuous integration

`.github/workflows/CICD.yml` runs on manual dispatch, on every pull request, and on pushes to
`master` and to tags. Permissions are read-only except for the release jobs.

Jobs that gate changes:

- **Crate metadata.** Reads name, version, maintainer, homepage, and MSRV from `cargo metadata`
  and passes them to later jobs.
- **Formatting.** `cargo fmt -- --check` on stable Rust.
- **Clippy.** `cargo clippy --all-targets --all-features -- -Dwarnings`, so any warning fails.
- **Minimum Rust version.** Installs the MSRV toolchain, runs clippy with `--all-targets
  --all-features`, and runs `cargo test --locked --all-features`.

The `build` matrix covers fourteen targets, including Linux GNU and musl on x86_64, i686,
aarch64, and 32-bit ARM; Windows MSVC and GNU on x86_64, i686, and aarch64; and macOS on
Intel and Apple silicon. Linux targets use `cross` v0.2.5, and the others use the native
toolchain. Each build step runs `build --locked --release` and then the test suite. The arm
and aarch64 targets run only the binary's own unit tests (`--bin=fd`) to avoid running the
integration suite under emulation.

After tests, each job generates completions with `make completions`, packages the binary,
`README.md`, the licenses, `CHANGELOG.md`, the man page, and the completions into a `.tar.gz`
(or `.zip` on Windows), and uploads the archive as an artifact. Ubuntu jobs also build a
Debian package with `scripts/create-deb.sh`.

## Release flow

A tag whose name starts with `v` followed by a digit (`v<major>.<minor>.<patch>`) marks a
release. In that case the workflow:

1. attests the archives and the Debian package;
2. attaches them to a GitHub release with `softprops/action-gh-release`.

A separate `winget` job runs for any tag whose name starts with `v`. It publishes the
Windows zip under the `sharkdp.fd` identifier.

Pushes to branches build and upload artifacts, but do not publish them.

The manual steps live in `doc/release-checklist.md`. They cover the version bump in
`Cargo.toml` and `Cargo.lock`, the MSRV and version in `README.md`, the changelog heading,
regenerating the README help section with `scripts/update-help.awk` and `gawk`, a
`cargo publish --dry-run`, the tag push, the GitHub release notes, and the crates.io publish
from a clean clone. `scripts/version-bump.sh` automates the first group of steps: it creates a
`release-<version>` branch, rewrites the version and the MSRV note in the relevant files, and
renames the changelog heading.

## Operational consequences

- The build, test, and MSRV jobs use `--locked`, so `Cargo.lock` must be committed and current.
- Clippy warnings and format differences fail CI, so run `cargo fmt` and `cargo clippy` before
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  pushing; see [Testing Strategy](/openwiki/testing/test-strategy.md).
- The MSRV job guards language and library features against the declared `rust-version`. Raising
  that value is a release-time decision and is part of the checklist.
- Shell completions are generated from the CLI definition at build time, so option changes
  flow into them automatically. The man page `doc/fd.1` is a checked-in file that is installed
  by `make install`, packaged into release archives, and included in the Debian package, so it
  must be edited by hand. The README help block is regenerated during release.

## Related pages

<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Testing Strategy](/openwiki/testing/test-strategy.md)
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md)
<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Quickstart](/openwiki/quickstart.md)
