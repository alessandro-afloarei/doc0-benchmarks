---
type: testing
title: Testing Strategy
description: How fd is tested. Covers the TestEnv integration harness, which runs the real fd binary against a temporary fixture tree, its output normalization and assertion helpers, how isolation from the user's environment works, the unit tests embedded in source modules, and how to run tests locally and in CI.
tags: [testing, integration-tests, test-harness, ci, unit-tests]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:44:06.029Z
sources:
  - id: openwiki-source-dddf858b6f600d9339e1373d
    resource: repo://.github/workflows/CICD.yml
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-15T08:44:06.029Z" }
---

# Testing Strategy

fd's tests come in two layers:

1. **Unit tests** live in `#[cfg(test)]` modules inside `src/`. They cover pure logic: template parsing, size and time parsing, owner parsing, sanitization, regex HIR helpers, exit-code merging, path helpers.
2. **Integration tests** in `tests/tests.rs` (about 110 `#[test]` functions, some parameterized with `test_case`). Each one runs the **compiled `fd` binary** as a subprocess against a temporary directory tree, using the harness in `tests/testenv/mod.rs`.

Run everything with `cargo test`. CI uses `cargo test --locked` (see below).

## The TestEnv harness

`TestEnv::new(dirs, files)` builds the fixture:

- Creates a temp dir with prefix `fd-tests` (via `tempfile`). It is deleted when the `TestEnv` is dropped.
- Creates an empty **`.git` directory** at the root. fd only applies `.gitignore` inside a git repository, so this makes `.gitignore` rules take effect.
- Creates the requested directories and empty files.
- Creates a `symlink` → `one/two` directory symlink. On Windows this needs the symlink privilege.
- Writes `.fdignore` containing `fdignored.foo` and `.gitignore` containing `gitignored.foo`.

The default fixture in `tests/tests.rs` (`DEFAULT_DIRS` / `DEFAULT_FILES`) adds nested `.foo` files at several depths, a mixed-case `C.Foo2` for smart-case tests, a hidden `.hidden.foo`, the two ignored files, and a file with a space (`e1 e2`).

Builder-style modifiers:

- `.normalize_line(true)`: sorts the whitespace-separated words within each line. Useful for `--exec-batch` output, where argument order is not deterministic.
- `.global_ignore_file(content)`: creates a temporary config dir containing `fd/ignore`.
- `create_broken_symlink(path)`: points a link at a file inside a temp dir that is then deleted.

### Isolation from the developer's environment

`run_command` launches `CARGO_BIN_EXE_fd` with:

- its working directory set to the fixture root (or a subdirectory of it);
- `LS_COLORS=""`, so color output is consistent;
- either `XDG_CONFIG_HOME=<temp config dir>` when a global ignore file was requested, or the hidden `--no-global-ignore-file` flag otherwise. The developer's own `~/.config/fd/ignore` therefore never affects tests.

### Assertions and normalization

| Helper | Checks |
| --- | --- |
| `assert_output(args, expected)` | Exit status 0 and normalized stdout equals normalized `expected` |
| `assert_output_subdirectory(dir, args, expected)` | Same, run from a subdirectory |
| `assert_output_raw(args, bytes)` | Exact stdout bytes. Unix except macOS, used for invalid UTF-8 filenames |
| `assert_success_and_get_output` / `..._normalized_output` | Returns the output for custom checks |
| `assert_failure(args)` | Non-zero exit |
| `assert_failure_with_error(args, msg)` | Non-zero exit and stderr starts with `msg` |
| `assert_error(args, msg)` | stderr starts with `msg`, returns the status |

`normalize_output` turns `\0` into `NULL\n`, optionally trims leading whitespace, replaces `/` with the platform separator, and **sorts the lines**. Expected outputs can therefore be written as indented multi-line strings with `/`, and tests don't depend on fd's nondeterministic streaming order. Failures print a line diff (from the `diff` crate) between expected and actual output.

## Suite organization

The tests in `tests/tests.rs` are grouped loosely by feature. Topic pages list the relevant test names:

- patterns, smart case, glob, fixed and exact, `--and`, full path → [Pattern Matching](../concepts/pattern-matching.md)
- hidden and ignore handling, depth, prune, follow, symlinks, `--ignore-contain` → [Ignore Rules](../concepts/ignore-rules-and-traversal.md)
- type, extension, size, time, owner → [Entry Filters](../concepts/entry-filters.md)
- exec, exec-batch, batch size, placeholders, multi-exec, thread modes → [Command Execution](../workflows/command-execution.md)
- print0, path separator, strip-cwd-prefix, hyperlink, invalid UTF-8 → [Output Formatting](../concepts/output-formatting.md)
- quiet and error messages → [Exit Codes](../operations/exit-codes-and-errors.md)

Time-based tests set file mtimes with the `filetime` crate. Owner tests read the current uid and gid through `nix`.

## CI

The GitHub Actions `CICD` workflow runs:

- `cargo fmt -- --check`;
- `cargo clippy --all-targets --all-features -- -Dwarnings`;
- clippy and tests on the MSRV toolchain with `--all-features`;
- `cargo test --locked --target=<triple>` on each of the 14 build targets. For `arm-*` and `aarch64-*` targets only `--bin=fd`, meaning just the unit tests.

Details are in [Build, Release and Packaging](../operations/build-release-and-packaging.md).

## Contributor expectations

`CONTRIBUTING.md` asks that PRs compile and pass tests, that behavior changes add a CHANGELOG entry under "Upcoming release", and that any AI assistance be disclosed.
