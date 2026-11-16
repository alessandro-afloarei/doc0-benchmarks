---
title: "Testing and CI"
---
## Overview

fd is tested at two levels. Unit tests sit in `#[cfg(test)]` modules next to the code they check: pattern helpers, size, time and owner parsing, templates, sanitization, exit-code merging. Integration tests in `tests/tests.rs` run the built `fd` binary as a child process against a temporary directory tree, through the `TestEnv` harness in `tests/testenv/mod.rs`. `cargo test` runs both, and the GitHub Actions workflow runs them on every pull request and on fourteen targets.

Sources: [tests/tests.rs:1-29](repo://tests/tests.rs#L1-L29), [tests/testenv/mod.rs:13-26](repo://tests/testenv/mod.rs#L13-L26), [.github/workflows/CICD.yml:1-19](repo://.github/workflows/CICD.yml#L1-L19)

Building fd and the `make` targets are covered on [[Quickstart]].

Sources: [Makefile:1-12](repo://Makefile#L1-L12)

## The TestEnv harness

### The test tree

`TestEnv::new(dirs, files)` creates a temporary directory prefixed `fd-tests` and fills it so every test starts from the same known tree:

Sources: [tests/testenv/mod.rs:28-63](repo://tests/testenv/mod.rs#L28-L63), [tests/testenv/mod.rs:147-158](repo://tests/testenv/mod.rs#L147-L158)

- an empty `.git` directory, so the tree counts as a Git repository and `.gitignore` rules apply (see [[Hidden Files, Ignore Rules and Exclusions]]);
- the requested directories and empty files;
- a `symlink` entry pointing to `one/two`, made with `symlink_dir` on Windows, where it needs a privilege only administrators hold by default;
- a `.fdignore` containing `fdignored.foo` and a `.gitignore` containing `gitignored.foo`.

Sources: [tests/testenv/mod.rs:35-60](repo://tests/testenv/mod.rs#L35-L60)

Most tests use `DEFAULT_DIRS` and `DEFAULT_FILES`, which include a hidden file, the two ignored files, files whose names differ only in case (`c.foo` and `C.Foo2`), and a name with a space (`e1 e2`).

Sources: [tests/tests.rs:17-29](repo://tests/tests.rs#L17-L29)

### Running fd

`run_command` starts the executable from `CARGO_BIN_EXE_fd` in the test root, or in a subdirectory of it. It sets `LS_COLORS` to an empty string for consistent colour output. Unless the test asked for a global ignore file, it passes `--no-global-ignore-file`, so the developer's own `~/.config/fd/ignore` cannot change the results. `global_ignore_file(content)` instead writes `fd/ignore` into a temporary config directory and points `XDG_CONFIG_HOME` at it.

Sources: [tests/testenv/mod.rs:75-79](repo://tests/testenv/mod.rs#L75-L79), [tests/testenv/mod.rs:300-316](repo://tests/testenv/mod.rs#L300-L316), [tests/testenv/mod.rs:65-73](repo://tests/testenv/mod.rs#L65-L73), [tests/testenv/mod.rs:169-176](repo://tests/testenv/mod.rs#L169-L176)

### Comparing output

fd's output order is not fixed (see [[Parallel Directory Walk]]), so `assert_output` normalizes both the expected and the actual text before comparing. `normalize_output` turns each `\0` into `NULL` plus a newline, trims leading whitespace from the expected lines (so expectations can be indented in the source), turns `/` into the platform separator, and sorts the lines. With `normalize_line(true)` the words inside each line are sorted too, for output such as `ls -l` or batch commands whose argument order varies. On a mismatch, the panic message shows a line diff.

Sources: [tests/testenv/mod.rs:114-134](repo://tests/testenv/mod.rs#L114-L134), [tests/testenv/mod.rs:160-167](repo://tests/testenv/mod.rs#L160-L167), [tests/testenv/mod.rs:247-276](repo://tests/testenv/mod.rs#L247-L276), [tests/testenv/mod.rs:91-112](repo://tests/testenv/mod.rs#L91-L112)

```rust
#[test]
fn test_simple() {
    let te = TestEnv::new(DEFAULT_DIRS, DEFAULT_FILES);

    te.assert_output(&["a.foo"], "a.foo");
    te.assert_output(&["b.foo"], "one/b.foo");
    te.assert_output(&["d.foo"], "one/two/three/d.foo");

    te.assert_output(
        &["foo"],
        "a.foo
        one/b.foo
        one/two/c.foo
        one/two/C.Foo2
        one/two/three/d.foo
        one/two/three/directory_foo/",
    );
}
```

Sources: [tests/tests.rs:62-80](repo://tests/tests.rs#L62-L80)

### Other assertions

| Method | Checks |
| --- | --- |
| `assert_output_subdirectory(path, args, expected)` | output when fd runs in a subdirectory of the tree |
| `assert_output_raw(args, bytes)` | exact stdout bytes, for non-UTF-8 names (Unix except macOS) |
| `assert_success_and_get_output` | exit success, returning the raw `Output` |
| `assert_failure_with_error(args, msg)` | non-zero exit and stderr starting with `msg` |
| `assert_failure(args)` | non-zero exit |
| `assert_error(args, msg)` | stderr starting with `msg`, returning the status |
| `create_broken_symlink(path)` | creates a link whose target is deleted |

Sources: [tests/testenv/mod.rs:178-198](repo://tests/testenv/mod.rs#L178-L198), [tests/testenv/mod.rs:216-298](repo://tests/testenv/mod.rs#L216-L298), [tests/testenv/mod.rs:318-343](repo://tests/testenv/mod.rs#L318-L343)

`test_root` and `system_root` give the tree's path and the filesystem root for tests that check absolute output. `get_absolute_root_path` in `tests.rs` normalizes the root and strips Windows' `\\?\` prefix for that purpose.

Sources: [tests/testenv/mod.rs:199-214](repo://tests/testenv/mod.rs#L199-L214), [tests/tests.rs:31-53](repo://tests/tests.rs#L31-L53)

## The CI workflow

`.github/workflows/CICD.yml` runs on pull requests, on pushes to `master`, on every tag, and on manual dispatch.

Sources: [.github/workflows/CICD.yml:7-17](repo://.github/workflows/CICD.yml#L7-L17)

| Job | What it does |
| --- | --- |
| `crate_metadata` | reads the name, version, maintainer, homepage and `rust-version` (MSRV) from `cargo metadata` for the other jobs |
| `ensure_cargo_fmt` | `cargo fmt -- --check` |
| `lint_check` | `cargo clippy --all-targets --all-features -- -Dwarnings` on stable |
| `min_version` | clippy and `cargo test --locked --all-features` on the MSRV toolchain |
| `build` | builds, tests and packages each target in the matrix |
| `winget` | on `v*` tags, publishes the Windows MSVC zips to winget as `sharkdp.fd` |

Sources: [.github/workflows/CICD.yml:19-85](repo://.github/workflows/CICD.yml#L19-L85), [.github/workflows/CICD.yml:299-309](repo://.github/workflows/CICD.yml#L299-L309)

The `build` matrix covers Linux (gnu and musl on x86_64, i686, aarch64 and armhf, built with `cross`), macOS on Intel and Apple silicon, and Windows MSVC (x86_64, i686, aarch64) and GNU. Each job builds `--release --locked` and runs the tests. On ARM targets it runs only the binary's unit tests (`--bin=fd`), not the integration tests. It then generates completions with `make completions`.

Sources: [.github/workflows/CICD.yml:86-113](repo://.github/workflows/CICD.yml#L86-L113), [.github/workflows/CICD.yml:160-203](repo://.github/workflows/CICD.yml#L160-L203)

Packaging puts the binary, `README.md`, both licence files, `CHANGELOG.md`, the man page `doc/fd.1` and the `autocomplete` directory into `fd-v<version>-<target>.tar.gz` (`.zip` on Windows). On Ubuntu runners it also builds a Debian package with `scripts/create-deb.sh`. Both are uploaded as artifacts. When the ref is a tag matching `v[0-9]…`, they are attested and attached to the GitHub release.

Sources: [.github/workflows/CICD.yml:205-297](repo://.github/workflows/CICD.yml#L205-L297)

## Releasing

`doc/release-checklist.md` lists the release steps: bump the version in `Cargo.toml` and `Cargo.lock` (automated by `scripts/version-bump.sh`), update the README version and MSRV, rename the changelog's "Upcoming release" heading, refresh the README's help section with `scripts/update-help.awk`, wait for CI, then push a `vX.Y.Z` tag, which triggers the release jobs above.

Sources: [doc/release-checklist.md:1-40](repo://doc/release-checklist.md#L1-L40)

## Contributing

`CONTRIBUTING.md` asks contributors to open an issue before a pull request, to make sure the code compiles and the tests pass, and to add an entry for any change in behaviour under the "Upcoming release" section of `CHANGELOG.md`, in the form `- Short description, see #123 (@user)`. Contributors must disclose any use of AI tools and to what extent. Pull requests and comments must be written by people, though AI help with grammar or translation is accepted.

Sources: [CONTRIBUTING.md:1-46](repo://CONTRIBUTING.md#L1-L46)
