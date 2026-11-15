---
type: operations
title: Build, Release and Packaging
description: How fd is built, tested in CI, packaged and released. Covers Cargo features (completions, use-jemalloc, base) and allocator gating, the release profile and MSRV, the Makefile install and completion targets, cross-compilation settings, the GitHub Actions CICD matrix, Debian packaging, and the release checklist.
tags: [build, cargo, ci, release, packaging, completions, jemalloc]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:44:06.029Z
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
  - id: openwiki-source-d6336c90c78fa30d4d37ec3b
    resource: repo://scripts/create-deb.sh
  - id: openwiki-source-80db21c5222b6f29055a9f08
    resource: repo://scripts/version-bump.sh
generated: { by: "claude-code", at: "2026-11-15T08:44:06.029Z" }
---

# Build, Release and Packaging

## Crate basics

- Package `fd-find`, binary `fd` (`src/main.rs`). Rust **edition 2024**, MSRV **1.90.0** (`rust-version` in `Cargo.toml`).
- Plain `cargo build` / `cargo install --path .` is enough for local development. `cargo install fd-find` installs the published crate.
- `Cargo.lock` is committed, and CI always builds with `--locked`.

### Features

| Feature | Effect |
| --- | --- |
| `completions` (**default**) | Pulls in `clap_complete` and enables the hidden `--gen-completions [shell]` flag. If no shell is given, the shell is detected from the environment. |
| `use-jemalloc` | Enables the optional `tikv-jemallocator` dependency and installs it as `#[global_allocator]`. |
| `base` | Alias for `use-jemalloc`. |

jemalloc is **not** part of the default feature set, so it has to be requested explicitly, for example with `--features base`. Even then it only applies on targets that are not Windows, Android, macOS, FreeBSD, OpenBSD, illumos, 32-bit musl, or riscv64. That target list appears twice, once in `Cargo.toml` (the target-specific dependency table) and once in the `#[cfg]` on the allocator static in `src/main.rs`, and **the two must be kept in sync**. macOS is excluded because of a historical jemalloc bug (issue #498).

### Profiles

- `release`: `lto = true`, `strip = true`, `codegen-units = 1`.
- `dev`: line-table debug info for the fd crate only, none for dependencies.
- `debugging`: inherits from `dev` with full debug info.

### Platform build settings

- `.cargo/config.toml`: Windows MSVC targets (x86_64 and i686) link the C runtime statically (`+crt-static`), so the `.exe` does not depend on the vcruntime DLL (issue #1874).
- `Cross.toml`: aarch64 Linux targets pass `JEMALLOC_SYS_WITH_LG_PAGE=16` into the `cross` container, so jemalloc works on 64 KiB page kernels (issue #1085).
- Unix-only dependencies: `nix` (signals, user/group lookup, hostname) and `libc` (all Unix except Redox).

## Makefile and installation

`make` builds `target/release/fd` with `cargo build --profile release --locked`. `make completions` populates `autocomplete/`:

- `fd.bash`, `fd.fish`, `_fd.ps1` are **generated** by running the built binary with `--gen-completions <shell>`.
- `_fd` (zsh) is a **hand-written** completion script in `contrib/completion/_fd` and is copied over as-is.
- `_fdfind`, `fdfind.bash`, `fdfind.fish` are thin wrappers that reuse the `fd` completions under the `fdfind` name. Debian ships the binary under that name.

`make install` installs the binary, completions, and the man page `doc/fd.1` under `$(DESTDIR)$(prefix)`, where `prefix` defaults to `/usr/local`.

## CI (`.github/workflows/CICD.yml`)

The workflow runs on pull requests, on pushes to `master`, on any tag, and on manual dispatch. Jobs:

1. `crate_metadata`: reads name, version, maintainer, homepage, and MSRV with `cargo metadata`.
2. `ensure_cargo_fmt`: `cargo fmt -- --check`. Formatting settings are in `rustfmt.toml`.
3. `lint_check`: `cargo clippy --all-targets --all-features -- -Dwarnings` on stable.
4. `min_version`: clippy and `cargo test --locked --all-features` on the MSRV toolchain.
5. `build`: a matrix of 14 targets covering Linux gnu/musl for x86_64, i686, aarch64, and armhf; macOS Intel and ARM; and Windows MSVC (x86_64, i686, aarch64) and GNU. Linux targets are built with `cross` v0.2.5. Each matrix job:
   - builds with `--release --locked`;
   - runs tests (ARM/aarch64 targets only run `--bin=fd` unit tests);
   - runs `make completions`;
   - packages a `.tar.gz` (or `.zip` on Windows) containing the binary, README, licenses, CHANGELOG, man page, and `autocomplete/`;
   - on Ubuntu runners, also builds a `.deb`.
6. On `v*` tags, artifacts get build-provenance attestations and are published to the GitHub release. A `winget` job then publishes the Windows MSVC zip as `sharkdp.fd`.

Dependabot updates cargo dependencies monthly and GitHub Actions daily, each with a 7-day cooldown. `Cargo.toml` also carries `cargo-binstall` metadata that points at the release archive naming scheme `fd-v{version}-{target}`.

## Debian package (`scripts/create-deb.sh`)

Inputs are `TARGET`, `DPKG_VERSION`, and `BIN_PATH`. musl targets produce a package named `fd-musl`, which conflicts with `fd` and `fd-find`. Other targets produce `fd`. The package contains:

- `/usr/bin/fd`, plus an `fdfind` symlink with its own completions;
- the gzipped man page;
- bash, fish, and zsh completions;
- docs, a changelog, and a DEP-5 copyright file.

The architecture is mapped from the target triple (arm64, armhf, i686, amd64).

## Release process

Follow `doc/release-checklist.md`:

1. Run `scripts/version-bump.sh X.Y.Z`. It creates a `release-X.Y.Z` branch, sets the version in `Cargo.toml`, updates the MSRV note in the README, and renames the CHANGELOG heading "Upcoming release" to the new version. Then run `cargo build` to refresh `Cargo.lock`.
2. Refresh the README "Command-line options" block with `gawk -i inplace -f scripts/update-help.awk README.md`, which embeds the output of `cargo run --release -- -h`. Review `-h`, `--help`, and the man page.
3. Wait for CI to pass, then run `cargo publish --dry-run`.
4. Merge the branch and push tag `vX.Y.Z`. CI builds and publishes the artifacts. Create the GitHub release from the CHANGELOG section, then run `cargo publish` from a clean clone.
5. Add a new "Upcoming release" section to the CHANGELOG.

Related: [Testing Strategy](../testing/integration-tests.md), [Quickstart](../quickstart.md).
