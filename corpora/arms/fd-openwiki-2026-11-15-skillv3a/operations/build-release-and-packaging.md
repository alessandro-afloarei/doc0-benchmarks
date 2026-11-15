---
type: operations
title: Build, Release, and Packaging
description: How fd is built, checked, packaged and released — Cargo features (completions, jemalloc), MSRV and build profiles, the GitHub Actions CI/CD matrix with cross, tarballs and Debian packages, shell completions and man page, Makefile install, and the release checklist and scripts.
tags: [build, ci, release, packaging, cargo, completions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:39:25.366Z
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
generated: { by: "claude-code", at: "2026-11-15T17:39:25.366Z" }
---

# Build, Release, and Packaging

## Crate basics (`Cargo.toml`)

- Package name `fd-find`, binary `fd` (`src/main.rs`), edition 2024, dual-licensed MIT OR Apache-2.0.
- `rust-version` declares the MSRV (currently `1.90.0`); CI tests that exact toolchain.
- There is no library target; all code is internal modules of the binary.

### Features

| Feature | Default | Effect |
|---------|---------|--------|
| `completions` | yes | pulls in `clap_complete` and enables the hidden `--gen-completions [shell]` option |
| `use-jemalloc` | no | enables `tikv-jemallocator` as the global allocator on supported targets |
| `base` | no | convenience alias for `use-jemalloc` |

jemalloc is only a dependency for targets that are not Windows, Android, macOS, FreeBSD, OpenBSD, illumos, 32-bit musl or riscv64. The same `cfg` expression gates the `#[global_allocator]` in `src/main.rs`, and the two **must be kept in sync** (a comment in both files says so). macOS is excluded because of a jemalloc bug on Catalina (issue #498). `Cross.toml` passes `JEMALLOC_SYS_WITH_LG_PAGE=16` into cross builds for aarch64 Linux targets to support 64 KiB-page kernels.

### Profiles

- `dev`: line-table debug info only for fd, none for dependencies (faster builds).
- `debugging`: inherits `dev` with full debug info.
- `release`: `lto = true`, `strip = true`, `codegen-units = 1`.

`.cargo/config.toml` statically links the C runtime (`+crt-static`) for the x86_64 and i686 Windows MSVC targets, so the `.exe` doesn't depend on the vcruntime DLL.

Platform-specific dependencies: `nix` (signals, user/group lookup, hostname) and `libc` on Unix.

## Local development

```sh
cargo build            # debug build
cargo test             # unit + integration tests
cargo fmt -- --check   # formatting (rustfmt.toml)
cargo clippy --all-targets --all-features -- -Dwarnings
```

`make` (Makefile) builds `target/release/fd` with `cargo build --profile release --locked`. `make completions` generates `autocomplete/fd.bash`, `fd.fish` and `_fd.ps1` by running the built binary with `--gen-completions`, and copies the hand-maintained zsh completion `_fd` and the `fdfind` variants from `contrib/completion/`. `make install` (honoring `prefix`/`DESTDIR`) installs the binary, completions and the man page `doc/fd.1`.

## CI/CD (`.github/workflows/CICD.yml`)

Runs on pull requests, pushes to `master`, tags, and manual dispatch. Jobs:

1. **crate_metadata** – extracts name, version, maintainer, homepage and MSRV via `cargo metadata`.
2. **ensure_cargo_fmt** – `cargo fmt -- --check`.
3. **lint_check** – `cargo clippy --all-targets --all-features -- -Dwarnings`.
4. **min_version** – installs the MSRV toolchain and runs clippy and `cargo test --locked --all-features`.
5. **build** – a matrix of 14 targets: Linux gnu/musl for x86_64, i686, aarch64 and armhf (built and tested with `cross` v0.2.5), Windows MSVC (x86_64, i686, aarch64) and GNU, and macOS x86_64/aarch64. Each job:
   - builds `--release --locked` and runs tests (arm/aarch64 targets run only `--bin=fd` tests);
   - runs `make completions`;
   - packages `fd-v<version>-<target>.tar.gz` (`.zip` on Windows) containing the binary, README, licenses, CHANGELOG, man page and `autocomplete/`;
   - on Ubuntu runners, builds a Debian package with `scripts/create-deb.sh`;
   - uploads artifacts; for `v*` tags it attests the artifacts and publishes them to the GitHub release.
6. **winget** – on `v*` tags, publishes the Windows MSVC zips to winget as `sharkdp.fd`.

Note that release binaries are built with default features, so jemalloc is only used when packagers opt in with `--features use-jemalloc`.

Dependabot updates Cargo dependencies monthly and GitHub Actions daily (with a 7-day cooldown).

## Debian package (`scripts/create-deb.sh`)

Produces `fd_<version>_<arch>.deb`, or `fd-musl_...` for musl targets (each conflicting with the other and with `fd-find`). It installs `/usr/bin/fd`, a `/usr/bin/fdfind` symlink (the name Debian/Ubuntu use for their own `fd-find` package), bash/fish/zsh completions for both names, the gzipped man page and changelog, a Debian `copyright` file, and a `DEBIAN/control` that `Provides: fd`. It is built with `fakeroot dpkg-deb`.

## Documentation artifacts to keep in sync

- `doc/fd.1` – the hand-written man page.
- `contrib/completion/_fd` – hand-written zsh completion (bash/fish/PowerShell are generated).
- `README.md` "Command-line options" block – regenerated by `gawk -i inplace -f scripts/update-help.awk README.md`, which runs `cargo run --release -- -h`.
- `CHANGELOG.md` – contributors add entries under "Upcoming release" (see `CONTRIBUTING.md`).

## Release process (`doc/release-checklist.md`)

1. **Version bump** – `scripts/version-bump.sh <version>` creates a `release-<version>` branch, updates `version` in `Cargo.toml`, refreshes the MSRV note in `README.md`, and renames the "Upcoming release" heading in `CHANGELOG.md`. Then `cargo build` to update `Cargo.lock`.
2. **Pre-release** – install locally, review `-h`/`--help`/man page, update the README help block, wait for CI, `cargo publish --dry-run`.
3. **Release** – merge, push tag `vX.Y.Z` (triggers the deployment jobs above), create the GitHub release with CHANGELOG notes, verify artifacts, `cargo publish` from a clean clone.
4. **Post-release** – add a fresh "Upcoming release" section to `CHANGELOG.md`.

See also [Testing](../testing/integration-tests.md) for what `cargo test` runs.
