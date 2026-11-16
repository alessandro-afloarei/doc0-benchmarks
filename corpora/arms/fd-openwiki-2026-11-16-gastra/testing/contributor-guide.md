---
type: testing
title: Testing and extending search behavior
description: How fd integration fixtures isolate filesystem searches, how assertions normalize results, and how to select regression tests for changes across CLI and runtime layers.
tags: [testing, development, regression, fixtures]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:26:52.841Z
sources:
  - id: openwiki-source-dddf858b6f600d9339e1373d
    resource: repo://.github/workflows/CICD.yml
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-0d5ea0012fa8783c7eda55f2
    resource: repo://src/filter/time.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "codex", at: "2026-11-16T07:26:52.841Z" }
---

# Testing and extending search behavior

The repository combines module-local unit tests with an integration target in `tests/tests.rs` that launches the compiled `fd` binary against temporary filesystem fixtures. Use unit tests for parsing and transformation invariants, and integration tests for behavior crossing CLI parsing, configuration, traversal, and output.

## Useful commands

Run these from the repository root with the toolchain described in [build and release](../operations/build-and-release.md):

```sh
cargo test --locked
cargo test --locked --test tests test_and
cargo test --locked --test tests test_ignore_contain
cargo test --locked --test tests test_exec_batch
cargo test --locked --bin fd sanitize::tests
cargo test --locked --bin fd filter::time
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -Dwarnings
```

Test-name arguments are substring filters, so `test_and` selects multiple integration cases. `--bin fd` selects binary-local unit tests and does not exercise the integration target. The CI workflow also runs all-feature Clippy and tests on the manifest's minimum Rust version. ARM/aarch64 matrix jobs explicitly use `--bin=fd`; their coverage therefore differs from the full suite. [CI checks](../../.github/workflows/CICD.yml#L42-L84), [target selection](../../.github/workflows/CICD.yml#L182-L198).

## Fixture ownership and isolation

`TestEnv` owns temporary working and optional configuration directories. Fixture construction creates requested files/directories, a `.git` directory so Git ignore rules apply, a standard symlink, and `.fdignore`/`.gitignore` fixtures. The symlink is present even in a fixture built with empty caller-provided lists. Tests for non-Git behavior must deliberately remove the synthetic repository marker. [Fixture construction](../../tests/testenv/mod.rs#L13-L62).

The binary comes from a runtime `CARGO_BIN_EXE_fd` override or Cargo's compile-time binary location. Child commands run in the fixture directory. Unless a test creates a dedicated global-ignore configuration, the harness adds `--no-global-ignore-file`; otherwise it supplies `XDG_CONFIG_HOME`. It also sets `LS_COLORS` to an empty string. The harness does not clear the entire inherited environment. [Binary lookup](../../tests/testenv/mod.rs#L75-L79), [child environment](../../tests/testenv/mod.rs#L300-L316).

## Choose assertions that preserve the property

`assert_output` compares normalized text: it rewrites NUL to a visible marker plus newline, normalizes separators, and sorts lines. With `normalize_line(true)`, it also sorts whitespace-separated words within each line. This is useful for nondeterministic discovery and batch argument ordering, but cannot establish a stable output order, exact byte encoding, or precise whitespace preservation. [Normalization](../../tests/testenv/mod.rs#L114-L134), [comparison](../../tests/testenv/mod.rs#L234-L275).

Use `assert_success_and_get_output` to inspect `process::Output` directly for ordering, bytes, stdout/stderr separation, or batching. The Unix non-macOS `assert_output_raw` helper compares raw stdout bytes. `assert_failure_with_error` checks both status and an expected stderr prefix; `assert_error` alone returns the status for the caller to interpret. Error matching trims leading line whitespace and uses a prefix comparison, not exact stderr equality. [Output/status helpers](../../tests/testenv/mod.rs#L216-L297), [error comparison](../../tests/testenv/mod.rs#L318-L343).

Ordinary captured child output is piped, so these integration calls do not automatically exercise terminal-only behavior. Sanitizer unit tests separately verify terminal transformations. The Linux `test_invalid_utf8` uses normalized lossy output, so it demonstrates matching invalid-byte filenames but is not itself a raw-byte preservation assertion. [Invalid filename test](../../tests/tests.rs#L2266-L2289), [sanitizer tests](../../src/sanitize.rs#L61-L139).

## Regression map

| Changed behavior | Representative coverage |
| --- | --- |
| Pattern composition, case, glob, literal/exact matching | `test_and_*`, `test_smart_case`, `test_glob_searches`, `test_fixed_strings`, `test_exact_literal_nonsubstring` |
| Root and full-path handling | `test_pattern_with_forward_slash_is_rejected`, `test_and_pattern_with_forward_slash_is_rejected`, `test_full_path`; `walk.rs` candidate-string unit tests |
| Ignore hierarchy and traversal | `test_gitignore_and_fdignore`, `test_no_ignore_parent`, `test_ignore_contain*`, `test_prune`, `test_follow_broken_symlink` |
| Metadata filtering | `test_size`, `test_modified_relative`, `test_modified_absolute`, Unix `test_owner_*`; filter-module unit tests |
| Templates and child processes | `format`, `test_exec*`, `test_exec_batch_with_limit`; `fmt` and `exec` template unit tests |
| Status and presentation | `test_quiet`, `test_print0`, `test_max_results`, `test_strip_cwd_prefix`, `test_hyperlink`; sanitizer/URL encoding unit tests |

The time-filter unit tests can replace the current time through a thread-local test clock and restore it with a drop guard. This permits deterministic duration/date boundary cases without altering production time handling. [Clock seam](../../src/filter/time.rs#L12-L25), [test guard](../../src/filter/time.rs#L70-L93).

## Platform and external-command constraints

Fixture symlink creation on Windows requires appropriate symlink privileges. Several command execution tests return early on Windows and rely on available Unix commands elsewhere; the batch-limit test is one example. The filesystem-boundary test is Unix-only, inspects `/dev/null` and `/`, and can return early when its assumptions do not hold. A passing suite on one environment does not prove every platform branch ran. [Symlinks](../../tests/testenv/mod.rs#L49-L55), [batch test](../../tests/tests.rs#L2064-L2099), [filesystem test](../../tests/tests.rs#L1072-L1109).

## Extending a behavior

For a new option, trace `Opts` in `cli.rs` through `construct_config` in `main.rs` and the owning runtime subsystem. Search filtering belongs in the walker; printed presentation belongs in `output.rs`; command argument generation belongs in the shared formatter and execution modules. Preserve the [pipeline's](../architecture/search-pipeline.md) filter order and cancellation behavior, and distinguish matching semantics from rendering paths.

Add a regression that fails for the user-observable bug and checks the relevant boundary: combine new pattern behavior with `--and`, ignore behavior with nested roots, or a placeholder change with both formatted output and command execution. The [search guide](../concepts/search-semantics.md) and [execution guide](../workflows/command-execution.md) describe these connections.

The repository's [contribution guide](../../CONTRIBUTING.md) asks contributors to discuss changes in a ticket first, compile and test before publishing a PR, disclose AI assistance, and record behavior changes in the Upcoming release changelog. Consult that guide for its full review and communication expectations. These commands and coverage notes describe the testing workflow; they are not a report that the suite was executed during documentation generation.
