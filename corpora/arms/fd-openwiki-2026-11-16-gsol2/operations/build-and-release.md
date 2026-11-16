---
type: operations
title: Build, installation, and release maintenance
description: Repository build features, platform configuration, completion and man-page installation, CI packaging, and the maintained fd release procedure.
tags: [build, installation, release, packaging, completions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:27.513Z
sources:
  - id: openwiki-source-4905fab56ecf9fa5e1ebbf3f
    resource: repo://.cargo/config.toml
  - id: openwiki-source-dddf858b6f600d9339e1373d
    resource: repo://.github/workflows/CICD.yml
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
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
generated: { by: "codex", at: "2026-11-16T16:28:27.513Z" }
---

# Build, installation, and release maintenance

The Cargo package is `fd-find`, and its binary is `fd` at `src/main.rs`. The checked-in manifest declares Rust 1.90.0 and edition 2024. Cargo builds the executable; the Makefile additionally assembles completion files and installs documentation assets. See [development and testing](../workflows/development-and-testing.md) for checks before changing behavior.

## Local builds and installation

```bash
cargo build --locked
cargo build --locked --release
cargo install --locked --path .
```

The first build produces `target/debug/fd`; the release build produces `target/release/fd` on Unix-like hosts. Cargo installation installs the executable. To stage the binary, man page, and shell assets together on a system with the required Make/install utilities:

```bash
make completions
make install DESTDIR=/tmp/fd-package prefix=/usr
```

The Makefile defaults to `PROFILE=release`, `prefix=/usr/local`, and `EXE=target/$(PROFILE)/fd`. Its build rule uses `cargo build --profile $(PROFILE) --locked`. `DESTDIR` supports staging without directly installing into system paths. `exe_name` controls asset names, while the installed executable path remains `$(bindir)/fd`.

## Feature and platform choices

| Setting | Repository behavior |
| --- | --- |
| Default features | Enable `completions`, pulling in optional `clap_complete`. |
| `--no-default-features` | Build without the default completion-generation feature. |
| `use-jemalloc` | Enable the optional allocator on its supported target configurations. |
| `base` | Feature alias enabling `use-jemalloc`; it does not disable other default features. |
| Release profile | Enable LTO, strip symbols, and use one codegen unit. |
| `debugging` profile | Inherit development settings but enable full debug information. |

The allocator dependency predicate in `Cargo.toml` and allocator declaration in `main.rs` must stay synchronized. The current predicate excludes Windows, Android, macOS, FreeBSD, OpenBSD, illumos, 32-bit musl, and riscv64. Adding the feature does not bypass those platform gates.

`.cargo/config.toml` requests static C runtime linkage for x86_64 and i686 Windows MSVC targets. `Cross.toml` passes `JEMALLOC_SYS_WITH_LG_PAGE=16` through to aarch64 GNU and musl cross environments; it does not itself assign a value. Platform support also affects owner filters, special file types, terminal color setup, and `--list-details`.

## Completion and help assets

`make completions` creates `autocomplete/`. Bash, fish, and PowerShell `fd` completions come from the built executable's `--gen-completions` path. Zsh `_fd` and the `fdfind` completion files are copied from `contrib/completion`. This means a build without `completions` cannot serve the Makefile's generation commands without changing the build configuration.

Completion generation can also be requested directly, for example `target/debug/fd --gen-completions bash`. The runtime takes its program name from the invoked executable stem and returns before search setup. The Makefile installs Bash, fish, and Zsh assets and `doc/fd.1`; although it generates a PowerShell completion file, the install target does not install that file.

CLI help comes from `src/cli.rs`. The man page and README's command-options excerpt are checked-in documentation surfaces. The release checklist calls for reviewing `-h`, `--help`, and the man page together, and suggests `gawk -i inplace -f scripts/update-help.awk README.md` to refresh the excerpt from short help.

## CI build and artifact flow

The `CICD` workflow responds to manual dispatch, pull requests, master pushes, and tag pushes. It extracts package metadata, runs formatting and lint jobs, checks the minimum supported compiler, and builds a matrix of Linux, macOS, and Windows targets. Selected Linux targets use `cross`; others use Cargo. Target builds use `--locked --release --target=...`.

The matrix runs target tests, with ARM/aarch64 restricted to the binary's tests via `--bin=fd`. It then invokes host `make completions` and packages the target executable with README, changelog, both licenses, the man page, and `autocomplete/`. Archives use an `fd-v<version>-<target>` directory and basename; Windows uses zip, and other targets use tar.gz.

Ubuntu matrix jobs call `scripts/create-deb.sh`. The script derives target and version when they are not supplied, distinguishes `fd-musl` and `fd` package names, chooses a Debian architecture string, and stages the binary, compressed man page/changelog, completion assets, and license material. It also creates an `fdfind` symlink and its completions. Assembly ends with `fakeroot dpkg-deb --build`. These are script mappings; validate a new target's mapping rather than assuming every Rust target is recognized.

Artifacts upload as workflow artifacts. Tag refs matching the workflow's version-tag check additionally trigger artifact attestation and GitHub release uploads. A downstream Winget job depends on the build and runs on `v` tag refs, selecting MSVC zip installers. Crates.io publishing is a separate step in the human release checklist, not a step in this workflow.

## Maintained release procedure

Use `doc/release-checklist.md` as the operational source of truth:

1. Prepare a release branch, update the manifest version and lockfile, refresh README toolchain/version text, and move the upcoming changelog section to the release version.
2. Install the candidate, confirm `fd --version`, review help and man-page text, wait for CI, and run `cargo publish --dry-run`.
3. Merge the release branch and push the version tag; create/publish the release notes and check uploaded archives and Debian packages.
4. Publish to crates.io from a clean repository and restore an upcoming-release changelog section.

`scripts/version-bump.sh VERSION` automates portions of the first step: it switches/creates `release-VERSION`, edits the manifest, attempts the README MSRV replacement, and renames the changelog heading. It does not run the checklist's build to update `Cargo.lock`, execute validation, or publish anything. Review its actual diff, especially if surrounding text or manifest formatting changes.

For a CLI change, coordinate help, man page, tests, README examples, and relevant completions. For a new platform, inspect dependency predicates, CI matrix/test scope, archive naming, Debian target mappings, and completion generation together. Return to [quickstart](../quickstart.md) for usage or [output and paths](../concepts/output-and-paths.md) for platform-visible rendering differences.
