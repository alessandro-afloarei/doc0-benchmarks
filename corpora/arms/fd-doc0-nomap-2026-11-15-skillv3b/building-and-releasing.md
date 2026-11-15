---
title: "Building and Releasing"
---
## Overview

This page covers how fd is compiled, checked and shipped: the Cargo features and profiles, the `Makefile` used by packagers, the GitHub Actions workflow that builds release archives and Debian packages for fourteen targets, and the manual release checklist with its helper scripts. Running the tests themselves is described on [[Testing]]; installing from source for everyday use is on [[Quickstart]].

Sources: [Cargo.toml:1-33](repo://Cargo.toml#L1-L33), [.github/workflows/CICD.yml:1-18](repo://.github/workflows/CICD.yml#L1-L18)

## Cargo configuration

### Package and toolchain

The crate is `fd-find` at version 10.4.2, edition 2024, with a minimum supported Rust version of 1.90.0 recorded in `rust-version`. It has one `[[bin]]` target named `fd` built from `src/main.rs`. The `exclude` list keeps the benchmark folder out of the published crate.

Sources: [Cargo.toml:1-32](repo://Cargo.toml#L1-L32)

### Features

| Feature | Default | Enables |
| --- | --- | --- |
| `completions` | yes | the `clap_complete` dependency and the hidden `--gen-completions` option |
| `use-jemalloc` | no | the `tikv-jemallocator` global allocator on supported targets |
| `base` | no | `use-jemalloc` |

Sources: [Cargo.toml:94-98](repo://Cargo.toml#L94-L98)

The allocator needs two matching conditions. `tikv-jemallocator` is only a dependency for targets that are not Windows, Android, macOS, FreeBSD, OpenBSD, illumos, 32-bit musl or riscv64, and `src/main.rs` sets `#[global_allocator]` under the same `cfg` list plus `feature = "use-jemalloc"`. Comments in both files say the two lists must be kept in sync; macOS is excluded because of a jemalloc bug on Catalina.

Sources: [Cargo.toml:66-71](repo://Cargo.toml#L66-L71), [src/main.rs:39-54](repo://src/main.rs#L39-L54)

```bash
cargo build --release --features use-jemalloc
cargo build --release --no-default-features   # no completion generator
```

Sources: [Cargo.toml:94-98](repo://Cargo.toml#L94-L98)

### Profiles

The release profile uses fat LTO, one codegen unit and stripped symbols for a small, fast binary. The dev profile keeps only line tables for fd and no debug info for dependencies, to speed up builds. A `debugging` profile inherits dev with full debug info, for use under a debugger.

Sources: [Cargo.toml:79-92](repo://Cargo.toml#L79-L92)

### Platform build settings

`.cargo/config.toml` links the C runtime statically for the Windows MSVC targets, so `fd.exe` does not depend on the vcruntime DLL. `Cross.toml` passes `JEMALLOC_SYS_WITH_LG_PAGE=16` into the `cross` containers for the aarch64 Linux targets, so a jemalloc build works on kernels with 64 KiB pages. `[package.metadata.binstall]` tells `cargo binstall` where release archives live and that Windows archives are zip files.

Sources: [.cargo/config.toml:1-8](repo://.cargo/config.toml#L1-L8), [Cross.toml:1-6](repo://Cross.toml#L1-L6), [Cargo.toml:100-115](repo://Cargo.toml#L100-L115)

## Makefile

The `Makefile` serves distribution packagers. Its default target builds `target/release/fd` with `--locked`. `completions` produces bash, fish and PowerShell completions by running the built binary with `--gen-completions`, and copies the hand-written zsh `_fd` plus the `fdfind` variants from `contrib/completion`. `install` copies the binary, the completions and `doc/fd.1` under `$(DESTDIR)$(prefix)` using the standard `bindir` and `datadir` layout.

Sources: [Makefile:1-52](repo://Makefile#L1-L52)

## Continuous integration

### Jobs

`.github/workflows/CICD.yml` runs on pull requests, pushes to `master` and any tag:

Sources: [.github/workflows/CICD.yml:19-84](repo://.github/workflows/CICD.yml#L19-L84), [.github/workflows/CICD.yml:299-309](repo://.github/workflows/CICD.yml#L299-L309)

| Job | What it does |
| --- | --- |
| `crate_metadata` | reads name, version, maintainer, homepage and MSRV from `cargo metadata` for later jobs |
| `ensure_cargo_fmt` | `cargo fmt -- --check` |
| `lint_check` | `cargo clippy --all-targets --all-features -- -Dwarnings` |
| `min_version` | clippy and `cargo test --locked --all-features` on the MSRV toolchain |
| `build` | build, test and package on each target in the matrix |
| `winget` | on `v*` tags, publishes the MSVC zip archives to winget as `sharkdp.fd` |

Sources: [.github/workflows/CICD.yml:19-84](repo://.github/workflows/CICD.yml#L19-L84), [.github/workflows/CICD.yml:299-309](repo://.github/workflows/CICD.yml#L299-L309)

### Build matrix

The `build` job covers Linux (gnu and musl on x86_64, i686, aarch64 and 32-bit ARM, all built with `cross` 0.2.5), macOS on Intel and Apple silicon, and Windows (MSVC on i686, x86_64 and aarch64, plus x86_64 GNU). For each target it builds with `--release --locked`, runs the tests (only the binary's unit tests on ARM; see [[Testing]]), runs `make completions`, and packs the binary, README, licences, changelog, man page and `autocomplete` folder into `fd-v<version>-<target>.tar.gz`, or `.zip` on Windows.

Sources: [.github/workflows/CICD.yml:86-162](repo://.github/workflows/CICD.yml#L86-L162), [.github/workflows/CICD.yml:200-245](repo://.github/workflows/CICD.yml#L200-L245)

### Publishing

On Ubuntu runners the job also builds a Debian package. Artifacts are uploaded for every run. When the ref is a tag matching `v<digit>...`, the archives and packages are attested with build provenance and attached to the GitHub release.

Sources: [.github/workflows/CICD.yml:247-297](repo://.github/workflows/CICD.yml#L247-L297)

### Debian package

`scripts/create-deb.sh` stages a package tree and builds it with `fakeroot dpkg-deb`. musl targets produce a package named `fd-musl`, others `fd`, each declaring a conflict with the other and with Debian's `fd-find`. The architecture comes from the target triple. The package installs `/usr/bin/fd`, an `fdfind` symlink with its own completions so commands written for Debian's package keep working, the gzipped man page and changelog, the README and licences, and a generated `copyright` file.

Sources: [scripts/create-deb.sh:1-66](repo://scripts/create-deb.sh#L1-L66), [scripts/create-deb.sh:108-135](repo://scripts/create-deb.sh#L108-L135)

## Release process

### Checklist

`doc/release-checklist.md` is the release procedure, meant to be copied into the release pull request:

Sources: [doc/release-checklist.md:1-69](repo://doc/release-checklist.md#L1-L69)

1. Version bump on a new branch: `Cargo.toml` and `Cargo.lock`, the MSRV note in `README.md`, and the "Upcoming release" heading in `CHANGELOG.md`.
2. Pre-release checks: install locally, review `-h`, `--help` and the man page, refresh the help text in the README, wait for CI, and run `cargo publish --dry-run`.
3. Release: merge, push a `vX.Y.Z` tag (which triggers the packaging workflow), create the GitHub release from the changelog section, check the uploaded binaries, and `cargo publish` from a clean clone.
4. Post-release: add a fresh "Upcoming release" section with Features, Bugfixes, Changes and Other.

Sources: [doc/release-checklist.md:1-69](repo://doc/release-checklist.md#L1-L69)

### Helper scripts

`scripts/version-bump.sh VERSION` automates step 1: it creates a `release-VERSION` branch, rewrites the first `version =` line in `Cargo.toml`, updates the README's MSRV note from `rust-version`, and renames the changelog heading. `scripts/update-help.awk`, run with `gawk -i inplace -f scripts/update-help.awk README.md`, replaces the code block after the README's "Command-line options" heading with the current `cargo run --release -- -h` output, starting at the `Usage` line.

Sources: [scripts/version-bump.sh:1-22](repo://scripts/version-bump.sh#L1-L22), [scripts/update-help.awk:1-41](repo://scripts/update-help.awk#L1-L41)

Because `--help` is generated from the doc comments on `Opts`, a change to an option's documentation in `src/cli.rs` is a change to the README and should be followed by running the awk script ([[Command-Line Interface]]).

Sources: [src/cli.rs:33-45](repo://src/cli.rs#L33-L45)

## Contributing

`CONTRIBUTING.md` asks contributors to open an issue before a pull request, to make sure the code compiles and passes tests, and to add a line to the "Upcoming release" section of `CHANGELOG.md` for any change in behaviour, in the form `- Description, see #123 (@user)`. It also asks that any use of AI tools be disclosed, that contributors understand and can answer for AI-assisted code, and that communication with maintainers be written by people.

Sources: [CONTRIBUTING.md:1-46](repo://CONTRIBUTING.md#L1-L46)
