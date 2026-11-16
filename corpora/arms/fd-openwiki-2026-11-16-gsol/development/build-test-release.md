---
type: development-workflow
title: Development, testing, and release workflow
description: Build fd from this checkout, select focused regression tests, understand CI platform coverage, and maintain completions and release artifacts.
tags: [development, testing, build, release, completions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:51.346Z
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
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
generated: { by: "codex", at: "2026-11-16T06:05:51.346Z" }
---

# Development, testing, and release workflow

## Local build contract

The Cargo package is `fd-find`; its executable is `fd`, rooted at `src/main.rs`. This checkout declares Rust 1.90.0 as its minimum supported version and uses edition 2024. Start from the Git root:

```sh
cargo build --locked
cargo run --locked -- --help
cargo test --locked
```

`cargo install --locked --path .` installs the executable from the checkout. See [quickstart](../quickstart.md) for search examples and a task-routing map.

The default feature set enables `completions`, which brings in `clap_complete` and the `--gen-completions` path. `use-jemalloc` is optional; `base` enables it, while the default feature set does not. Allocator activation also depends on target-specific conditions in both `Cargo.toml` and `main.rs`. Keep these conditions aligned when changing allocator support. In particular, the current conditions exclude Windows, Android, macOS, several BSD/Unix targets, 32-bit musl, and riscv64.

The `debugging` profile restores full debug information compared with the reduced dev settings. Release builds enable LTO, stripping, and one codegen unit. `.cargo/config.toml` enables static CRT linking for x86_64 and i686 MSVC builds; do not generalize that setting to every Windows target. `Cross.toml` passes `JEMALLOC_SYS_WITH_LG_PAGE=16` through to the two aarch64 Linux cross targets.

## Choosing useful tests

Pure parsers and transformations have unit tests beside their implementations, including regex helpers, size/time/owner filters, formatting, sanitization, hyperlinks, search-string selection, and exit-code merging. CLI behavior is exercised through the real binary in `tests/tests.rs` using `tests/testenv/mod.rs`.

The integration fixture creates a temporary tree, a synthetic `.git` directory, `.fdignore` and `.gitignore` files, and a symlink. It locates the test executable through `CARGO_BIN_EXE_fd`. Unless a test supplies a temporary global configuration directory, the harness adds `--no-global-ignore-file`; it also sets `LS_COLORS` to an empty value. This reduces interference from the developer's environment.

Use Cargo's test-name filtering for focused work:

```sh
cargo test --locked --test tests test_and_
cargo test --locked --test tests test_pattern_with_forward_slash
cargo test --locked --test tests test_ignore_contain
cargo test --locked --test tests test_exec_batch
cargo test --locked --bin fd search_str_
```

| Change area | Useful existing integration tests |
| --- | --- |
| Pattern modes, conjunctions, path diagnostics | `test_and_*`, `test_exact_literal_nonsubstring`, `test_pattern_with_forward_slash_is_rejected`, `test_and_pattern_with_forward_slash_is_rejected` |
| Ignore precedence and traversal | `test_custom_ignore_precedence`, `test_no_ignore_parent`, `test_global_ignore`, `test_prune`, `test_ignore_contain*` |
| Metadata selection | `test_type*`, `test_extension`, `test_size`, `test_modified_relative`, `test_modified_absolute`, `test_owner_*` |
| Execution and presentation | `test_exec*`, `format`, `test_print0`, `test_hyperlink`, `test_strip_cwd_prefix`, `test_invalid_utf8` |
| Search lifecycle | `test_quiet`, `test_max_results`, `test_single_and_multithreaded_execution` |

The default assertion helper normalizes separators, turns NUL terminators into visible comparison markers, and sorts lines. Some batch tests also sort words within each line. These comparisons verify membership, not raw output ordering. For byte preservation or ordering behavior, use the raw-output helpers or inspect `process::Output` directly. Tests that depend on Unix ownership, special files, invalid UTF-8, or Windows hidden attributes are platform-gated; Windows symlink fixtures need the relevant operating-system privilege.

## CI checks and portability

The checked-in `CICD.yml` runs formatting with `cargo fmt -- --check`, strict linting with `cargo clippy --all-targets --all-features -- -Dwarnings`, and locked Clippy/tests on the declared minimum Rust version with all features. Its build matrix covers Linux GNU/musl, macOS, and Windows targets, using either Cargo or `cross` as selected by the matrix.

Matrix builds use `--locked --release --target=...`; tests use the same selected target. The workflow restricts ARM and aarch64 test invocations to `--bin=fd`, so the matrix does not imply full integration-test coverage on those targets. Run relevant integration tests on a suitable native host when modifying platform-specific filesystem behavior.

## Completion and installation surfaces

`make completions` builds the release executable by default and populates `autocomplete/`. Bash, fish, and PowerShell fd scripts are generated with `--gen-completions`; zsh `_fd` and the fdfind compatibility scripts are copied from `contrib/completion/`. A CLI change may therefore require edits to maintained completion sources as well as regeneration of generated ones. The completion runtime derives the command name from the invoked executable name.

`make install` installs the binary, completions, and `doc/fd.1`. Its variables include `PROFILE`, `prefix`, `bindir`, `datadir`, `exe_name`, and `DESTDIR`. The binary destination is explicitly named `fd`; `exe_name` controls several installed documentation/completion names. Cargo installation alone does not run these Makefile installation recipes.

## Release path and packaging

Use `doc/release-checklist.md` as the maintained sequence. It covers the version and lockfile bump, README and changelog updates, review of short/long help and the man page, CI, a publish dry run, tagging, artifact verification, crates.io publication, and restoration of the upcoming-release section. `scripts/version-bump.sh` assists the initial branch/manifest/README/changelog edits; inspect its result and complete the remaining checklist steps, including the lockfile update.

The CI archive contains the target binary, README, both licenses, changelog, man page, and completions. Windows uses ZIP; other targets use tar.gz. Ubuntu jobs also invoke `scripts/create-deb.sh`, which stages the binary and support files, adds an `fdfind` compatibility symlink, selects `fd` or `fd-musl`, and invokes `fakeroot dpkg-deb`. Version and binary path have script fallbacks when not supplied by CI.

Artifact upload happens in the build workflow. Attestation and GitHub release publication are gated on a tag ref matching the workflow's release check; the dependent Winget job has its own `v`-tag gate. These are release operations, not part of a local build or documentation update.

For behavioral changes, the contribution guide requests an entry under the upcoming release in `CHANGELOG.md`. When changing [command execution](../workflows/command-execution.md) or [output formatting](../output/rendering-and-formatting.md), review CLI help, completion sources, the README examples, and `doc/fd.1` alongside the relevant tests.
