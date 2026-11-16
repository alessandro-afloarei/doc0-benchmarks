---
type: operations
title: Build, Packaging, CI and Release
description: How fd is built and packaged - Cargo features and profiles, jemalloc and completions, Makefile install layout, shell completions and man page, the CICD workflow matrix, cross-compilation settings, and the release checklist scripts.
tags: [build, cargo, ci, release, packaging, completions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:38:21.850Z
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
  - id: openwiki-source-59011b8e6a79d94579a6db4e
    resource: repo://scripts/update-help.awk
  - id: openwiki-source-80db21c5222b6f29055a9f08
    resource: repo://scripts/version-bump.sh
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-16T17:38:21.850Z" }
---

# Build, Packaging, CI and Release

## Cargo configuration (`Cargo.toml`)

- Crate `fd-find`, binary `fd` from `src/main.rs`, edition 2024, MSRV `rust-version = 1.90.0`, dual licensed MIT/Apache-2.0.
- **Features**: `completions` (pulls in `clap_complete`; **on by default**) enables the hidden `--gen-completions` flag; `use-jemalloc` (pulls `tikv-jemallocator`) switches the global allocator on eligible targets; `base` is an alias for `use-jemalloc`. The `cfg` guard in `main.rs` and the target-specific dependency in `Cargo.toml` must be kept in sync (excluded: Windows, Android, macOS, FreeBSD, OpenBSD, illumos, 32-bit musl, riscv64). jemalloc on macOS is disabled due to an upstream bug.
- **Platform dependencies**: `nix` (signal/user/hostname) on Unix for SIGINT re-raise, owner lookup and hyperlink hostname; `libc` on Unix except Redox.
- **Profiles**: `release` uses `lto = true`, `strip = true`, `codegen-units = 1`; `dev` keeps only line tables and strips debug info of dependencies; a `debugging` profile inherits `dev` with full debug info.
- `package.metadata.binstall` describes release artifact names for `cargo binstall` (tgz, zip on Windows targets).
- `.cargo/config.toml` statically links the MSVC C runtime for Windows MSVC targets so the exe does not depend on the vcruntime DLL.
- `Cross.toml` passes `JEMALLOC_SYS_WITH_LG_PAGE=16` for aarch64 Linux targets (64 KiB-page compatibility).

## Makefile and installation

`make` builds `target/release/fd` with `cargo build --profile release --locked`. `make completions` generates `autocomplete/fd.bash`, `fd.fish`, `_fd.ps1` using `fd --gen-completions <shell>`, and copies the hand-maintained `contrib/completion/_fd`, `_fdfind` (zsh), `fdfind.bash` and `fdfind.fish`. `make install` installs the binary into `$(prefix)/bin` and completions plus `doc/fd.1` (the man page) under `$(prefix)/share`; `DESTDIR`, `prefix`, `PROFILE` and `exe_name` are overridable for distro packagers. The `fdfind` completions exist for Debian-style packaging, where the binary is renamed `fdfind`; `fdfind.bash` sources the regular `fd` bash completion and re-registers it for the new name.

## CI (`.github/workflows/CICD.yml`)

Triggered by pull requests, pushes to `master`, tags and manual dispatch, with read-only default permissions. Jobs:

- `crate_metadata`: extracts name, version, maintainer, homepage and MSRV from `cargo metadata`.
- `ensure_cargo_fmt`: `cargo fmt -- --check`.
- `lint_check`: `cargo clippy --all-targets --all-features -- -Dwarnings` on stable.
- `min_version`: clippy and `cargo test --locked --all-features` with the MSRV toolchain.
- `build`: a matrix of 14 targets (Linux gnu/musl for x86_64, i686, aarch64, arm; macOS x86_64 and aarch64; Windows msvc/gnu for several architectures). Linux targets use `cross` (pinned v0.2.5), others use `cargo`. Each job builds with `--locked --release`, runs tests (for arm and aarch64 targets only the binary's own unit tests via `--bin=fd`, skipping the integration tests), generates completions with `make completions`, creates a tarball (zip on Windows) and a Debian package via `scripts/create-deb.sh`, uploads artifacts, and on tag builds attests and publishes release assets. A separate job publishes to Winget.
- `openwiki-update.yml` is a scheduled workflow (managed by OpenWiki) that refreshes the generated wiki.

See [[operations/testing]] for what the test step runs.

## Release process

`doc/release-checklist.md` is the canonical checklist. `scripts/version-bump.sh <version>` automates the version section: it switches to a `release-<version>` branch, rewrites the `version` in `Cargo.toml`, updates the minimum Rust version note in `README.md`, and renames the "Upcoming release" heading in `CHANGELOG.md`. `scripts/update-help.awk` regenerates the "Command-line options" block of `README.md` from `cargo run --release -- -h` (run through `gawk -i inplace`). Remaining steps: review `-h`/`--help` and the man page, wait for CI, `cargo publish --dry-run`, tag `vX.Y.Z` (which triggers deployment), then publish the crate. `CONTRIBUTING.md` asks contributors to add a changelog entry and to open an issue before large PRs.

## Practical notes

- Always use `--locked` in CI-like builds; `Cargo.lock` is committed.
- Changing CLI flags requires updating the long help in `src/cli.rs`, `doc/fd.1`, the README options block and shell completions (the zsh file in `contrib/completion` is not generated). See [[architecture/cli-and-config]].
- Platform-specific code is gated with `cfg(unix)`/`cfg(windows)`; changes should be checked against both.
