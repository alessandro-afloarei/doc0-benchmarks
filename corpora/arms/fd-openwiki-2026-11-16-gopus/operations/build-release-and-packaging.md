---
type: operations
title: Build, CI, Release, and Packaging
description: How fd is built and shipped — Cargo features and the jemalloc allocator gate, build profiles and MSRV, the GitHub Actions CICD workflow and cross-compilation matrix, Windows static CRT, Makefile install and completions, Debian packaging, and the release checklist and version-bump script.
tags: [build, ci, release, packaging, cargo, jemalloc]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
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
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# Build, CI, Release, and Packaging

## Crate and toolchain

- Package `fd-find`, binary `fd` (`src/main.rs`), edition 2024, MSRV
  `rust-version = "1.90.0"`, dual-licensed MIT/Apache-2.0.
- `Cargo.lock` is committed and CI builds with `--locked`.

## Cargo features

| Feature | Default | Effect |
| --- | --- | --- |
| `completions` | yes | Pulls in `clap_complete` and enables the hidden `--gen-completions [shell]` flag. |
| `use-jemalloc` | no | Pulls in `tikv-jemallocator` and installs it as `#[global_allocator]`. |
| `base` | no | Alias for `use-jemalloc`. |

jemalloc is gated twice and the two conditions must be kept in sync (both
`Cargo.toml` and `src/main.rs` say so): the dependency is declared only for
targets that are not Windows, Android, macOS, FreeBSD, OpenBSD, illumos, 32-bit
musl, or riscv64; and the global allocator in `main.rs` uses the same `cfg` plus
`feature = "use-jemalloc"`. macOS is excluded because of a historical jemalloc
bug (issue #498). For aarch64 Linux cross builds, `Cross.toml` passes
`JEMALLOC_SYS_WITH_LG_PAGE=16` through so jemalloc works on 64 KiB-page kernels.

## Profiles and platform settings

- `release`: `lto = true`, `strip = true`, `codegen-units = 1`.
- `dev`: line-tables-only debug info for fd, none for dependencies; a `debugging`
  profile inherits `dev` with full debug info.
- `.cargo/config.toml` adds `-C target-feature=+crt-static` for
  `x86_64-pc-windows-msvc` and `i686-pc-windows-msvc`, so the EXE does not depend
  on the vcruntime DLL.
- Unix builds depend on `nix` (signals, users/groups, hostname) and, except Redox,
  `libc`.

## CI: `.github/workflows/CICD.yml`

Triggered on pull requests, pushes to `master`, tags, and manual dispatch.
Jobs:

1. `crate_metadata` — extracts name, version, maintainer, homepage and MSRV via
   `cargo metadata`.
2. `ensure_cargo_fmt` — `cargo fmt -- --check` (settings in `rustfmt.toml`).
3. `lint_check` — `cargo clippy --all-targets --all-features -- -Dwarnings`.
4. `min_version` — clippy and `cargo test --locked --all-features` on the MSRV
   toolchain.
5. `build` — matrix over 14 targets (Linux gnu/musl for x86_64, i686, aarch64 and
   armhf via `cross`; macOS Intel and Apple Silicon; Windows MSVC x86_64/i686/
   aarch64 and GNU x86_64). Each job builds `--release --locked`, runs tests
   (only `--bin=fd` unit tests on ARM targets), runs `make completions`, and
   packages a `.tar.gz` (`.zip` on Windows) containing the binary, README,
   licenses, CHANGELOG, `doc/fd.1`, and the `autocomplete/` directory. On Ubuntu
   runners it also builds a `.deb` with `scripts/create-deb.sh`.
6. On tags matching `v[0-9]*`, artifacts are attested and published to the
   GitHub release; a `winget` job then publishes the Windows MSVC zip as
   `sharkdp.fd`.

## Makefile and installation

`make` builds `target/release/fd` with `cargo build --profile release --locked`.
`make completions` generates bash, fish, and PowerShell completions from the
binary (`fd --gen-completions <shell>`) and copies the hand-maintained zsh and
`fdfind` completions from `contrib/completion/`. `make install` installs the
binary, completions, and the man page `doc/fd.1` under `$(DESTDIR)$(prefix)`
(default `/usr/local`).

## Debian packages

`scripts/create-deb.sh` stages a `dpkg` tree: `fd` binary, gzipped man page,
completions, docs and changelog, and an `fdfind` symlink with matching
completions. musl targets produce package `fd-musl` (conflicting with `fd` and
`fd-find`); others produce `fd` (conflicting with `fd-musl` and `fd-find`).
Architecture maps from the target triple (amd64, arm64, armhf, i686).

## Release process

`doc/release-checklist.md` is the authoritative procedure:

1. **Version bump** — automated by `scripts/version-bump.sh <version>`: creates a
   `release-<version>` branch, updates the version in `Cargo.toml`, syncs the MSRV
   note in `README.md`, and renames the `# Upcoming release` heading in
   `CHANGELOG.md`.
2. **Pre-release** — install locally, review `-h`/`--help`/man page, refresh the
   README help section with `gawk -i inplace -f scripts/update-help.awk README.md`,
   wait for CI, `cargo publish --dry-run`.
3. **Release** — merge, push tag `vX.Y.Z` (this triggers deployment), create the
   GitHub release with CHANGELOG notes, verify artifacts, `cargo publish` from a
   clean clone.
4. **Post-release** — add a new "Upcoming release" section to `CHANGELOG.md`.

Contributors adding behavior changes should add a CHANGELOG entry under
"Upcoming release" (see `CONTRIBUTING.md`).

Related: [Test Suite](../testing/test-suite.md), [Quickstart](../quickstart.md).
