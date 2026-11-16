---
type: operations
title: Build, Features, CI, Release and Packaging
description: How fd is built and shipped - Cargo features (jemalloc, completions), platform-specific dependencies, MSRV, the CICD workflow matrix, Makefile install and completion targets, Debian packaging and the release checklist scripts.
tags: [build, cargo, ci, release, packaging, completions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:03:56.385Z
sources:
  - id: openwiki-source-4905fab56ecf9fa5e1ebbf3f
    resource: repo://.cargo/config.toml
  - id: openwiki-source-dddf858b6f600d9339e1373d
    resource: repo://.github/workflows/CICD.yml
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-0bc9c609aef896964e961315
    resource: repo://Cross.toml
  - id: openwiki-source-2f39ca94e091acb887cee50c
    resource: repo://doc/release-checklist.md
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-d6336c90c78fa30d4d37ec3b
    resource: repo://scripts/create-deb.sh
  - id: openwiki-source-80db21c5222b6f29055a9f08
    resource: repo://scripts/version-bump.sh
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-16T09:03:56.385Z" }
---

# Build, Features, CI, Release and Packaging

## Crate layout and features

`Cargo.toml` defines the package `fd-find` (version 10.4.2, edition 2024, MSRV `rust-version = "1.90.0"`) with one binary target, `fd`, at `src/main.rs`. Features:

| Feature | Effect |
| --- | --- |
| `completions` (default) | pulls in `clap_complete` and enables `--gen-completions` in `src/main.rs`/`src/cli.rs` |
| `use-jemalloc` | enables `tikv-jemallocator` as the `#[global_allocator]` |
| `base` | alias for `use-jemalloc` (intended for packagers) |

jemalloc is *optional* and also gated by a long `cfg(...)` predicate that must be kept in sync between `Cargo.toml` and `src/main.rs`: it is excluded on Windows, Android, macOS (a known jemalloc/Catalina bug, tracked with a FIXME), FreeBSD, OpenBSD, illumos, 32-bit musl and riscv64. `Cross.toml` passes `JEMALLOC_SYS_WITH_LG_PAGE=16` through for aarch64 Linux cross builds (64 KiB page support).

Platform dependencies: `nix` (signals, user/group lookup, hostname) on Unix, `libc` on Unix except Redox; Windows gets its behavior from `std` plus `nu-ansi-term`'s ANSI enablement. Core crates: `ignore` (walker), `regex`/`regex-syntax`, `clap` (derive), `lscolors`, `crossbeam-channel`, `ctrlc`, `argmax` (command-line length-aware batching), `jiff` (time parsing), `etcetera` (config dir), `globset`, `faccess`, `normpath`, `aho-corasick` (placeholder scanning). Dev dependencies for the integration suite: `tempfile`, `diff`, `filetime`, `test-case`.

Profiles: `dev` strips debug info for dependencies and keeps line tables only; `debugging` inherits `dev` with full debug info; `release` enables LTO. `.cargo/config.toml` statically links the C runtime on Windows MSVC targets so the exe doesn't need the vcruntime DLL.

## Makefile

`make` builds `target/$(PROFILE)/fd` with `cargo build --profile $(PROFILE) --locked` (default `release`). `make completions` generates `autocomplete/fd.bash`, `fd.fish` and `_fd.ps1` by running `fd --gen-completions <shell>` and copies hand-maintained `_fd`, `_fdfind`, `fdfind.bash`, `fdfind.fish` from `contrib/completion/`. `make install` installs the binary, completions and the man page `doc/fd.1` under `$(prefix)` (default `/usr/local`), honoring `DESTDIR`. The `fdfind` variants exist for Debian-style packaging, where the binary is renamed.

## Continuous integration (`.github/workflows/CICD.yml`)

Triggered on pull requests, pushes to `master`, tags and manual dispatch with read-only `contents` permission. Jobs:

1. **crate_metadata** extracts name, version, maintainer, homepage and MSRV via `cargo metadata`.
2. **ensure_cargo_fmt** (`cargo fmt -- --check`) and **lint_check** (`cargo clippy --all-targets --all-features -- -Dwarnings`).
3. **min_version** builds clippy and tests on the MSRV toolchain with `--all-features` and `--locked`.
4. **build** is a matrix of targets (Linux gnu/musl for x86_64, i686, aarch64 and arm via `cross`; macOS Intel and Apple Silicon; Windows MSVC for x86_64, i686 and aarch64, plus Windows GNU). Each runs a locked release build, then `cargo test` (restricted to unit tests/binary for the arm-style targets that can't run integration tests), `make completions`, packages a tarball, builds a Debian package via `scripts/create-deb.sh`, uploads artifacts, attests them, and on tag pushes publishes the release assets.
5. A **Winget** publication job follows releases.

## Debian packaging

`scripts/create-deb.sh` derives package name and conflicts from the target (`fd-musl` for musl targets, `fd` otherwise, each conflicting with the others and with `fd-find`), maps the Rust target triple to a Debian architecture, and assembles a `dpkg` tree containing the binary, man page and completions (copyright years computed at build time).

## Release process

`doc/release-checklist.md` is the authoritative checklist, with three sections: version bump, pre-release checks, release.

- `scripts/version-bump.sh <version>` automates the bump: creates a `release-<version>` branch, rewrites the version in `Cargo.toml`, syncs the MSRV note in `README.md`, and renames the `# Upcoming release` heading in `CHANGELOG.md`.
- `scripts/update-help.awk` (run through `gawk -i inplace -f scripts/update-help.awk README.md`) refreshes the "Command-line options" block in the README from `fd -h`.
- After merging, pushing a `vX.Y.Z` tag triggers CI's deploy path; `cargo publish` is done manually afterwards.

<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/testing/integration-test-harness.md] link "/openwiki/testing/integration-test-harness.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
When changing CLI options, remember the documentation touchpoints: the help text in `src/cli.rs`, `doc/fd.1`, the README options block, and shell completion files under `contrib/completion/` (see [CLI and configuration](/openwiki/architecture/cli-and-configuration.md)). Tests that run in CI are described in [the test harness](/openwiki/testing/integration-test-harness.md); the [quickstart](/openwiki/quickstart.md) has the local commands.
