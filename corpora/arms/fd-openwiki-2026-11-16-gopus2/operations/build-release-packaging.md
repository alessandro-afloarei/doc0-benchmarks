---
type: operations
title: Build, Release and Packaging
description: How fd is built and shipped - Cargo features and profiles, jemalloc platform gating, Makefile install and shell completions, the man page, the GitHub Actions CICD matrix with cross, tarball and Debian packaging, and the release checklist and helper scripts.
tags: [build, cargo, release, packaging, ci, completions, debian, jemalloc]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:22.809Z
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
  - id: openwiki-source-59011b8e6a79d94579a6db4e
    resource: repo://scripts/update-help.awk
  - id: openwiki-source-80db21c5222b6f29055a9f08
    resource: repo://scripts/version-bump.sh
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-16T16:28:22.809Z" }
---

# Build, Release and Packaging

## Crate and toolchain

- Package `fd-find` (crates.io name), binary `fd` from `src/main.rs`; Rust edition 2024, `rust-version` (MSRV) declared in `Cargo.toml` (currently 1.90.0).
- `Cargo.lock` is committed and every CI/Makefile build uses `--locked`.

### Features

| Feature | Default | Effect |
|---------|---------|--------|
| `completions` | yes | Pulls in `clap_complete` and enables the hidden `--gen-completions[=shell]` flag |
| `use-jemalloc` | no | Uses `tikv-jemallocator` as `#[global_allocator]` |
| `base` | no | Alias for `use-jemalloc` |

jemalloc is restricted twice — by a target `cfg` on the dependency in `Cargo.toml` and by a matching `#[cfg(all(...))]` on the allocator in `src/main.rs`. It is excluded on Windows, Android, macOS (jemalloc/Catalina bug, issue #498), FreeBSD, OpenBSD, illumos, 32-bit musl and riscv64. **Both lists must be kept in sync.** Because neither the Makefile nor the CI build step enables `base`/`use-jemalloc`, the default build uses the system allocator; packagers opt in with `--features use-jemalloc` (or `base`).

### Profiles

- `release`: `lto = true`, `strip = true`, `codegen-units = 1`.
- `dev`: line-tables-only debug info for fd, none for dependencies.
- `debugging`: inherits `dev` with full debug info (`cargo build --profile debugging`).

### Platform build config

- `.cargo/config.toml` statically links the C runtime (`+crt-static`) for `x86_64-` and `i686-pc-windows-msvc`, so `fd.exe` does not need the VC runtime DLL (issue #1874).
- `Cross.toml` passes `JEMALLOC_SYS_WITH_LG_PAGE=16` into `cross` builds for aarch64 Linux targets (issue #1085, 64K-page kernels).

## Makefile

`make` builds `target/release/fd` (`cargo build --profile $(PROFILE) --locked`). Targets:

- `completions` — generates `autocomplete/fd.bash`, `fd.fish`, `_fd.ps1` by running `fd --gen-completions <shell>`, and copies the hand-written zsh `contrib/completion/_fd` plus the `fdfind` wrappers.
- `install` — installs the binary, completions and `doc/fd.1` under `$(DESTDIR)$(prefix)` (default `/usr/local`), with `exe_name` controlling the installed command/man name.

### Shell completions and the `fdfind` name

- bash/fish/PowerShell completions are generated from the clap definition; zsh uses the maintained `contrib/completion/_fd`.
- Debian/Ubuntu distribute the binary as `fdfind`; `contrib/completion/fdfind.{bash,fish}` and `_fdfind` delegate to the `fd` completions. `print_completions` uses the program's own file stem as the command name, so `fdfind --gen-completions` emits completions for `fdfind`.

### Man page and README help

`doc/fd.1` is hand-maintained roff. The README's *Command-line options* block is regenerated with `gawk -i inplace -f scripts/update-help.awk README.md`, which replaces the fenced block with the output of `cargo run --release --quiet -- -h` starting at the `Usage` line.

## CI (`.github/workflows/CICD.yml`)

Runs on pull requests, pushes to `master`, tags and manual dispatch:

| Job | What it checks |
|-----|----------------|
| `crate_metadata` | Extracts name/version/maintainer/homepage/MSRV via `cargo metadata` |
| `ensure_cargo_fmt` | `cargo fmt -- --check` (config in `rustfmt.toml`) |
| `lint_check` | `cargo clippy --all-targets --all-features -- -Dwarnings` |
| `min_version` | On the MSRV toolchain: clippy and `cargo test --locked --all-features` |
| `build` (matrix) | 14 targets across Linux (gnu/musl; x86_64, i686, arm, aarch64), macOS (Intel and ARM), Windows (msvc/gnu, x86_64/i686/aarch64) |
| `winget` | On `v*` tags, publishes the `-pc-windows-msvc.zip` to winget |

Each `build` job: `cargo` or `cross` (`use-cross: true` for Linux targets, cross v0.2.5) `build --locked --release --target`, then `test` (arm/aarch64 targets only run `--bin=fd`, skipping integration tests), `make completions`, and packaging:

- **Tarball/zip** `fd-v<version>-<target>.tar.gz` (`.zip` on Windows) containing the binary, README, licenses, CHANGELOG, `fd.1` and `autocomplete/`. The layout matches `package.metadata.binstall` in `Cargo.toml`, so `cargo binstall fd-find` can fetch it.
- **Debian package** (Ubuntu runners only) via `scripts/create-deb.sh`: package `fd` (or `fd-musl` for musl targets, mutually conflicting and conflicting with Debian's `fd-find`), `Provides: fd`; installs the binary, gzipped man page, bash/fish/zsh completions for both `fd` and `fdfind`, and docs; built with `fakeroot dpkg-deb`.
- Artifacts are uploaded; on `refs/tags/v[0-9]*` they are attested (`actions/attest`) and attached to the GitHub release.

## Release process

`doc/release-checklist.md` is the authoritative checklist. In summary:

1. **Version bump** — `scripts/version-bump.sh <version>` creates branch `release-<version>`, edits `version` in `Cargo.toml`, syncs the MSRV note in `README.md`, and renames `# Upcoming release` in `CHANGELOG.md`. Then `cargo build` to refresh `Cargo.lock`.
2. **Pre-release** — install locally, review `-h`/`--help`/man page, regenerate README help with `update-help.awk`, wait for CI, `cargo publish --dry-run`.
3. **Release** — fast-forward merge, push tag `vX.Y.Z` (triggers the build/publish pipeline), create the GitHub release from the CHANGELOG section, verify artifacts, `cargo publish` from a clean clone.
4. **Post-release** — add a fresh *Upcoming release* section (Features / Bugfixes / Changes / Other) to `CHANGELOG.md`.

Contributors are expected to add a CHANGELOG entry under *Upcoming release* for behavior changes (`CONTRIBUTING.md`).

Related: [Test Suite](../testing/test-suite.md) for what the CI test steps run, and [Quickstart](../quickstart.md).
