---
type: operations
title: Build, Release, CI and Packaging
description: How fd is built and packaged - Cargo manifest features and profiles, Makefile targets for release builds, shell completions and man page, the GitHub Actions CICD workflow (format, lint, MSRV, cross-target tests, archives, Debian packages, attestation, release publishing, Winget), and the maintainer release checklist.
tags: [build, cargo, makefile, ci, github-actions, release, packaging, completions, msrv, cross]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:10:54.611Z
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
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-16T18:10:54.611Z" }
---

# Build, Release, CI and Packaging

This page describes how `fd` is turned into artifacts and how those artifacts
reach users. The day-to-day developer loop (build, run the test suite, pick a
<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
focused test) is summarized in the [Quickstart](/openwiki/quickstart.md) and
<!-- openwiki: broken internal link [/openwiki/testing/integration-tests.md] link "/openwiki/testing/integration-tests.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
detailed in [Testing Strategy](/openwiki/testing/integration-tests.md).

## Cargo manifest

`Cargo.toml` defines a single package named `fd-find` with a binary target
`fd` at `src/main.rs`. Key build settings:

- Edition 2024 and `rust-version = "1.90.0"`. CI reads the MSRV from
  `cargo metadata` and uses it for a dedicated job.
- Feature flags:
  - `default = ["completions"]`. The `completions` feature pulls in
    `clap_complete` and enables the hidden `--gen-completions` option.
  - `use-jemalloc` enables `tikv-jemallocator`, which is only compiled on
    targets outside Windows, Android, macOS, FreeBSD, OpenBSD, illumos,
    32-bit musl and riscv64. The allocator is installed in `main.rs` under the
    same condition. Comments in both files ask maintainers to keep them in sync.
  - `base = ["use-jemalloc"]` is a bundle name.
- Release profile: `lto = true`, `strip = true`, `codegen-units = 1`.
- Development profile: `debug = "line-tables-only"` for the crate, with debug
  info disabled for dependencies (`profile.dev.package."*"`). A `debugging`
  profile inherits from dev and enables full debug info.
- Dev dependencies used by tests: `diff`, `tempfile`, `filetime`, `test-case`.
- `[package.metadata.binstall]` describes release archive names so that
  `cargo binstall` can download prebuilt binaries. Windows targets use `.zip`.

Platform-specific dependencies (`nix`, `libc`) are declared under
`target.'cfg(unix)'`.

`.cargo/config.toml` sets `-C target-feature=+crt-static` for the x86_64 and
i686 MSVC Windows targets, so the executable does not depend on the Visual C++
runtime DLL.

`Cross.toml` passes `JEMALLOC_SYS_WITH_LG_PAGE=16` into the `cross` container
builds for the `aarch64` Linux GNU and musl targets (see upstream issue 1085
cited in the file). The passthrough is declared only for those two targets.

## Makefile

The `Makefile` is a convenience layer over Cargo for installing from source:

- `make` (default `$(EXE)` target): `cargo build --profile release --locked`.
  `--locked` is used throughout, so `Cargo.lock` must be up to date.
- `make completions`: produces files in `autocomplete/` by running the binary
  with `--gen-completions` for bash, fish and PowerShell, and copies the
  hand-maintained zsh and fdfind completion scripts from `contrib/completion/`.
- `make install`: installs the binary, completions and the man page
  (`doc/fd.1`) under `$(prefix)` (default `/usr/local`) with `install -Dm755` and
  `install -Dm644`.

## Shell completions and man page

Completions come from two sources:

1. Generated completions, produced from the live clap definition in
   `cli.rs` by `print_completions` in `main.rs`. They are not checked in; the
   Makefile and CI regenerate them at build time, so they reflect the current
   flags.
2. Static files in `contrib/completion/` (`_fd`, `_fdfind`, `fdfind.bash`,
   `fdfind.fish`) for names and behavior that generation does not cover.

The man page `doc/fd.1` is checked in. `scripts/update-help.awk` is a gawk
helper that operates on the command-line options section of a document (see
the script for the exact transformation). The release checklist asks
maintainers to copy the output of `fd -h` into the README's command-line
options section and to review the man page before tagging.

## GitHub Actions: CICD workflow

`.github/workflows/CICD.yml` runs on `workflow_dispatch`, pull requests, pushes
to `master`, and tags. Permissions are read-only by default; the build job
requests extra scopes for attestation and releasing. Checkout is pinned to a
tag (`actions/checkout@v7.0.1`), while some third-party actions are pinned to
a commit SHA.

Jobs:

| Job | Purpose |
| --- | --- |
| `crate_metadata` | Reads name, version, maintainer, homepage and MSRV via `cargo metadata` and exposes them as outputs. |
| `ensure_cargo_fmt` | `cargo fmt -- --check` on stable Rust. |
| `lint_check` | `cargo clippy --all-targets --all-features -- -Dwarnings`. Any warning fails the job. |
| `min_version` | Clippy and `cargo test --locked --all-features` on the MSRV toolchain. |
| `build` | Matrix over 14 target triples (Linux GNU and musl on x86_64, aarch64, i686 and armv7 hard-float; Windows MSVC and GNU; macOS Intel and Apple Silicon). Linux and cross targets use `cross` v0.2.5 installed from its release. |
| `winget` | Runs only on `v*` tags, after `build`, and publishes the Windows MSVC zip to Winget. |

Within `build`, each matrix entry:

1. Installs cross-compilers for ARM targets when needed.
2. Builds with `--locked --release --target`.
3. Runs tests. On ARM and AArch64 targets only the binary's own unit tests
   run (`--bin=fd`), because emulated runs of the full suite are not used
   there.
4. Runs `make completions` and assembles a package containing the binary,
   README, both license files, CHANGELOG, man page and completion files.
   Windows uses `.zip`, other targets `.tar.gz`.
5. On Ubuntu runners, runs `scripts/create-deb.sh` to build a Debian package.
   The script derives a copyright range and maintainer from constants and
   stages the package under `${CICD_INTERMEDIATES_DIR}` (defaulting to the
   current directory when unset).
6. Uploads the archive and, where created, the Debian package as artifacts.

On a tag matching `v[0-9]*`, the job also attests the artifacts with
`actions/attest` and publishes the archives and packages to a GitHub release.
Non-tag runs stop after uploading artifacts.

## Release procedure

Releases are cut by a maintainer following `doc/release-checklist.md`. The
checklist has three phases:

1. **Version bump.** `scripts/version-bump.sh <version>` creates a
   `release-<version>` branch, rewrites the version in `Cargo.toml`, and
   refreshes `Cargo.lock`. The checklist then asks for the MSRV to be updated
   in `README.md`, for `CHANGELOG.md` to get the release heading, and for the
   help text to be refreshed.
2. **Pre-release checks.** Install the candidate with
   `cargo install --locked -f --path .`, review help and the man page, push,
   and wait for CI to pass. Optionally test new features manually, then run
   `cargo publish --dry-run`.
3. **Release.** Fast-forward merge to `master`, create and push the `vX.Y.Z`
   tag, confirm the GitHub release contains the expected archives and
   packages, publish to crates.io with `cargo publish` from a clean checkout,
   and open a new "Upcoming release" section in `CHANGELOG.md`.

## Failure modes to watch

- A `Cargo.lock` that is out of date makes every `--locked` build fail, both
  in the Makefile and in CI.
- Clippy warnings are errors in CI, including on the MSRV toolchain, so
  lint-only changes can fail CI even when tests pass.
- Changes to the jemalloc `cfg` gates must be mirrored in `Cargo.toml` and
  `main.rs`; otherwise a target can link an allocator it does not support.
- The Debian and archive steps depend on file names (`doc/fd.1`, `autocomplete`)
  as well as on `CHANGELOG.md`. Renaming those files breaks packaging.

## Related pages

<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Quickstart](/openwiki/quickstart.md)
<!-- openwiki: broken internal link [/openwiki/testing/integration-tests.md] link "/openwiki/testing/integration-tests.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Testing Strategy](/openwiki/testing/integration-tests.md)
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md)
