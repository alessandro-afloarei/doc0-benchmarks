---
type: workflow
title: Development and testing
description: Building and validating fd changes, choosing focused tests, understanding the temporary-filesystem integration harness, and following repository contribution and CI requirements.
tags: [development, testing, ci, contribution]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:27.513Z
sources:
  - id: openwiki-source-dddf858b6f600d9339e1373d
    resource: repo://.github/workflows/CICD.yml
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-0d5ea0012fa8783c7eda55f2
    resource: repo://src/filter/time.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "codex", at: "2026-11-16T16:28:27.513Z" }
---

# Development and testing

The project builds one binary from `src/main.rs`; unit tests live beside internal modules and CLI integration tests live in `tests/tests.rs`. The manifest declares Rust 1.90.0, edition 2024. Default builds include completion generation, while allocator features and target-specific dependencies create additional configurations to consider.

## Build and choose validation

From the repository root:

```bash
cargo build --locked
cargo test --locked
```

Use a focused test when investigating a concrete subsystem, then expand checks when the change crosses boundaries:

| Change | Focused command | What it establishes |
| --- | --- | --- |
| Pattern syntax or smart case | `cargo test --locked --bin fd regex_helper` | Syntax-tree helpers and leading-dot detection. |
| Size/time/owner parsing | `cargo test --locked --bin fd filter::` | Filter parser and comparison unit tests available on the host. |
| Shared placeholders | `cargo test --locked --bin fd fmt::` | Format parsing and path transforms. |
| Ignore precedence | `cargo test --locked --test tests test_custom_ignore_precedence` | Cross-directory `.fdignore`/`.gitignore` behavior. |
| Multiple name constraints | `cargo test --locked --test tests test_and_` | AND behavior with mode and filter combinations. |
| Child execution | `cargo test --locked --test tests test_exec` | Matching execution-related integration test names, including batch cases. |
| Terminal sanitation | `cargo test --locked --bin fd sanitize::` | Visible escaping and safe Unicode preservation. |

Cargo's final filter argument is a substring, so each command can select multiple tests. Use `-- --nocapture` when direct test diagnostics are useful. These are documented validation commands, not a record of checks run during wiki generation.

CI also runs `cargo fmt -- --check` and `cargo clippy --all-targets --all-features -- -Dwarnings`. The minimum-version job takes the compiler version from Cargo metadata and runs locked tests with all features, plus Clippy. Target matrix builds use stable Rust; selected Linux jobs use `cross`. ARM/aarch64 matrix tests select only `--bin=fd`, so that matrix path does not run the separate integration test target.

## Integration harness contracts

`TestEnv` creates an isolated temporary directory, requested directories/files, a `.git` directory, a symlink fixture, and `.fdignore`/`.gitignore` files. The `.git` directory is intentional: production code normally requires Git repository detection before applying Git ignore rules. Removing it in a test changes that precondition.

The executable path comes from `CARGO_BIN_EXE_fd`, falling back to Cargo's compile-time value. Each child runs in a directory under the temporary root. By default the harness adds `--no-global-ignore-file`; tests opting into a custom fd global ignore file get a temporary config directory via `XDG_CONFIG_HOME`. It sets `LS_COLORS` to an empty string for consistent styling. These controls are specific and do not make the full inherited environment hermetic.

Ordinary `assert_output` comparisons normalize both sides:

- Convert NUL bytes to visible `NULL` line markers.
- Normalize slash spelling to the host path separator.
- Trim leading whitespace in expected fixture text.
- Sort lines; optionally sort whitespace-delimited words within each line.

Consequently normal output assertions prove normalized result content, not discovery order or exact raw record layout. Batch tests can opt into word normalization because argument ordering is unspecified. Use `assert_success_and_get_output` and inspect bytes for formatting, status, or ordering contracts. The dedicated `assert_output_raw` helper is available on Unix excluding macOS and compares stdout bytes directly.

Error helpers trim line indentation and check that stderr starts with the expected error text. `assert_failure_with_error` additionally requires a failed status; `assert_error` returns the status for a caller to inspect. Success helpers include stdout and stderr in failure diagnostics.

## Platform and clock boundaries

Windows symlink creation requires the OS privilege or developer configuration that permits it; the fixture does create a directory symlink. Unix-only owner tests rely on Unix user/group APIs. Several external-command cases skip Windows, and raw-byte filename cases have narrower platform gates. A passing host test does not substitute for examining those conditional branches when changing platform behavior.

Modification-time integration tests create files and set ages with `filetime`. Time-filter unit tests use a thread-local test clock so relative-time and timezone comparisons can be evaluated against a controlled reference. Symlink helpers create both ordinary and broken targets. Test both filter acceptance and metadata failures when modifying a metadata-dependent feature.

`test_single_and_multithreaded_execution` checks normal search output with one and sixteen threads; despite its name, that particular case does not launch child commands. Execution-specific tests separately cover command templates, multi-command sets, NUL output, batch limits, custom separators, and invalid UTF-8.

## Where to change behavior

| Responsibility | Primary edit boundary | Neighbor to verify |
| --- | --- | --- |
| Public flags, conflicts, help | `src/cli.rs` | `main.rs` conversion to `Config`; man page and completion assets. |
| Pattern compilation and smart case | `main.rs`, `regex_helper.rs` | Worker candidate text and AND tests. |
| Ignore/depth/prune policy | `walk.rs` builder/callback | Root normalization and ignore integration fixtures. |
| Metadata constraint | `filter`, `filetypes.rs`, `Config` | Worker filter ordering and missing metadata. |
| Display text and path bytes | `output.rs`, `sanitize.rs`, `hyperlink.rs` | Terminal status, Unix raw output, prefixes and separators. |
| Placeholder semantics | `fmt` | Both formatted search output and command arguments. |
| Process batching/output/status | `exec` | CLI mode validation and receiver scheduling. |

For context follow [search architecture](../architecture/search-pipeline.md), [matching](../concepts/matching-and-filters.md), or [command execution](command-execution.md). Build assets and release steps are covered in [build and release](../operations/build-and-release.md).

## Contribution requirements

`CONTRIBUTING.md` asks contributors to discuss proposed changes in a ticket before opening a PR, compile and test contributions, and add an upcoming-release changelog entry for behavior changes. AI-assisted contributions require human review and understanding, appropriate disclosure, and attention to licensing. It also asks that maintainer communication and PR descriptions come from humans, allowing assistance for proofreading or translation. Follow that document when preparing a contribution; wiki generation does not publish a PR or contact maintainers.
