---
title: "Development and Testing"
---
## Overview

The repository builds one Rust binary from `src/main.rs` and tests it through both module-level tests and filesystem integration fixtures. [[Quickstart]] supplies the first build and installation commands. This page follows the contributor workflow from build settings through validation, completion generation and packaging, with runtime behavior organized by the systems in the [[Overview]].

Sources: [Cargo.toml:29-31](repo://Cargo.toml#L29-L31), [README.md:734-747](repo://README.md#L734-L747), [src/exit_codes.rs:53-94](repo://src/exit_codes.rs#L53-L94), [tests/testenv/mod.rs:28-78](repo://tests/testenv/mod.rs#L28-L78)

## Choose build settings

The manifest declares Rust edition 2024 and minimum Rust version 1.90.0. The development profile keeps line-table debug information for the package while disabling dependency debug information. A `debugging` profile inherits development settings and enables full debug information. Release builds enable LTO, strip the binary and use one codegen unit. These are repository-defined profiles rather than additional runtime configuration.

Sources: [Cargo.toml:19-21](repo://Cargo.toml#L19-L21), [Cargo.toml:79-92](repo://Cargo.toml#L79-L92)

| Feature | Dependency or feature enabled | Default status |
| --- | --- | --- |
| `completions` | Optional `clap_complete` | Enabled by default |
| `use-jemalloc` | Optional `tikv-jemallocator` | Not in the default feature list |
| `base` | `use-jemalloc` | Not in the default feature list |

Sources: [Cargo.toml:46-47](repo://Cargo.toml#L46-L47), [Cargo.toml:70-71](repo://Cargo.toml#L70-L71), [Cargo.toml:94-98](repo://Cargo.toml#L94-L98)

The allocator dependency and global allocator are both target-gated. Comments identify performance as the reason for jemalloc and a macOS bug as the reason it remains disabled there; the dependency and allocator conditions must remain synchronized. Separately, the Cargo configuration statically links the C runtime for x86_64 and i686 MSVC targets so the executable does not depend on the vcruntime DLL.

Sources: [Cargo.toml:65-71](repo://Cargo.toml#L65-L71), [src/main.rs:38-54](repo://src/main.rs#L38-L54), [.cargo/config.toml:1-9](repo://.cargo/config.toml#L1-L9)

## Match the validation workflow

The README's development workflow runs `cargo test` for unit and integration tests. CI separately checks formatting and runs Clippy with all targets, all features and warnings denied. The following commands reproduce those declared checks locally. The minimum-version job additionally reads the Rust version from Cargo metadata and runs locked Clippy and tests with the configured all-features setting.

Sources: [README.md:738-746](repo://README.md#L738-L746), [.github/workflows/CICD.yml:27-40](repo://.github/workflows/CICD.yml#L27-L40), [.github/workflows/CICD.yml:42-84](repo://.github/workflows/CICD.yml#L42-L84), [.github/workflows/CICD.yml:3-5](repo://.github/workflows/CICD.yml#L3-L5)

```bash
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -Dwarnings
cargo test
```

Sources: [.github/workflows/CICD.yml:42-64](repo://.github/workflows/CICD.yml#L42-L64), [README.md:742-743](repo://README.md#L742-L743)

The build matrix covers the listed Linux, macOS and Windows architectures and uses `cross` for its marked Linux targets. It performs locked release builds and target-specific tests. For `arm-*` and `aarch64-*` targets, the workflow selects the binary test target rather than the full integration suite. This difference matters when interpreting matrix coverage: a successful binary test job does not mean every filesystem integration fixture ran on that target.

Sources: [.github/workflows/CICD.yml:94-114](repo://.github/workflows/CICD.yml#L94-L114), [.github/workflows/CICD.yml:160-198](repo://.github/workflows/CICD.yml#L160-L198)

## Build filesystem test fixtures

`TestEnv::new` creates a temporary directory, populates the requested directory and file lists, and locates the executable from `CARGO_BIN_EXE_fd`. Fixture creation also adds a `.git` directory so Git ignore rules apply, writes `.fdignore` and `.gitignore` entries, and creates a symlink to a nested directory. The Windows fixture uses a directory symlink and notes that the corresponding system privilege is required.

Sources: [tests/testenv/mod.rs:28-78](repo://tests/testenv/mod.rs#L28-L78), [tests/testenv/mod.rs:147-157](repo://tests/testenv/mod.rs#L147-L157)

A test invocation sets its working directory under the temporary root and captures the process output. Unless the fixture has a custom configuration directory, the harness adds `--no-global-ignore-file`; with a custom directory it sets `XDG_CONFIG_HOME`. It also sets `LS_COLORS` to an empty string for consistent color behavior. These controls keep the ordinary fixture path independent of a developer's global fd ignore file and color configuration.

Sources: [tests/testenv/mod.rs:65-72](repo://tests/testenv/mod.rs#L65-L72), [tests/testenv/mod.rs:169-175](repo://tests/testenv/mod.rs#L169-L175), [tests/testenv/mod.rs:300-315](repo://tests/testenv/mod.rs#L300-L315)

Output assertions normally normalize NULs into visible markers, normalize separators, optionally sort whitespace-separated words inside each line, and sort the lines before comparison. Therefore these assertions test result membership rather than emission order. Raw-byte assertions bypass that normalization on their supported Unix configuration. Error assertions compare a normalized stderr prefix, and failure helpers separately check the process status.

Sources: [tests/testenv/mod.rs:114-133](repo://tests/testenv/mod.rs#L114-L133), [tests/testenv/mod.rs:234-293](repo://tests/testenv/mod.rs#L234-L293), [tests/testenv/mod.rs:318-342](repo://tests/testenv/mod.rs#L318-L342)

The simple search test demonstrates the fixture interface by checking several nested results and a directory match. Batch execution tests additionally cover empty-result behavior and invalid placeholder layouts. When assessing a change to sorting or byte preservation, use the distinction between normalized and raw assertions deliberately; [[Output and Pipelines]] explains the runtime behavior those assertion styles observe.

Sources: [tests/tests.rs:62-79](repo://tests/tests.rs#L62-L79), [tests/tests.rs:1949-1961](repo://tests/tests.rs#L1949-L1961), [tests/testenv/mod.rs:252-274](repo://tests/testenv/mod.rs#L252-L274)

## Generate completions from the CLI

With the default completions feature enabled, startup handles `--gen-completions` before setting a search directory or building the search. `print_completions` derives the program name from the executable's file stem, builds the Clap command and writes generated completions to stdout. If the shell value is omitted, `Opts::gen_completions` attempts to infer it from the environment and reports an error if that fails.

Sources: [Cargo.toml:94-98](repo://Cargo.toml#L94-L98), [src/main.rs:75-84](repo://src/main.rs#L75-L84), [src/main.rs:114-128](repo://src/main.rs#L114-L128), [src/cli.rs:775-784](repo://src/cli.rs#L775-L784)

`make completions` generates Bash, Fish and PowerShell files by invoking the built executable. It copies the maintained Zsh `_fd` completion and the `fdfind` variants from the contribution directory. The target builds `target/release/fd` by default using a locked Cargo profile build. This means generated completion artifacts are downstream of the CLI definition, while the copied files have their own maintained sources.

Sources: [Makefile:1-42](repo://Makefile#L1-L42)

## Assemble installation artifacts

The Makefile's `install` target depends on the executable and completions, then installs the binary, completion files and `doc/fd.1`. Its variables define a default `/usr/local` prefix, binary and share directories, an executable-name setting for installed support files, and `DESTDIR` staging. The Cargo installation route in [[Quickstart]] installs the application, while this Makefile target explicitly includes those additional artifacts.

Sources: [Makefile:1-6](repo://Makefile#L1-L6), [Makefile:44-52](repo://Makefile#L44-L52), [README.md:745-746](repo://README.md#L745-L746)

CI generates completions before assembling an archive. It stages the target binary, README, both license files, changelog, man page and autocomplete directory together. Windows artifacts use ZIP and the other listed targets use gzip-compressed tar archives; the package basename includes the executable name, version and target triple. The workflow derives version and other package metadata from Cargo rather than duplicating those values in each matrix entry.

Sources: [.github/workflows/CICD.yml:27-40](repo://.github/workflows/CICD.yml#L27-L40), [.github/workflows/CICD.yml:200-240](repo://.github/workflows/CICD.yml#L200-L240)

## Prepare a contribution

The contribution guide asks contributors to discuss changes in an issue before opening a pull request and to compile and test their changes before publishing it. It also requires disclosure of AI assistance and human review and understanding of generated work. For a behavior change, add an entry to the appropriate subsection of the changelog's upcoming release section, using the documented issue-number and author format; documentation typo fixes do not require such an entry.

Sources: [CONTRIBUTING.md:5-46](repo://CONTRIBUTING.md#L5-L46)
