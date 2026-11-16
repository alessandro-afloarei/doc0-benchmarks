---
type: concept
title: Traversal scope and ignore rules
description: Search roots, hidden and ignore controls, depth and pruning, symlink handling, and a source-grounded procedure for diagnosing missing fd results.
tags: [traversal, ignore, filesystem, configuration, troubleshooting]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:37:15.780Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "codex", at: "2026-11-16T16:37:15.780Z" }
---

# Traversal scope and ignore rules

`WorkerState::build_walker` configures the `ignore` crate's parallel walker. Hidden paths, ignored directories, maximum depth, symlink traversal, and filesystem boundaries can prevent discovery before fd's own pattern and metadata filters run. These are separate from [matching and filters](matching-and-filters.md).

## Search roots and working directory

`--base-directory` changes the process working directory before roots and search configuration are resolved. It must name an existing directory; changing directory can also fail. With no roots, `Opts::search_paths` validates and uses `./`. Roots can be supplied positionally or through repeated `--search-path` options; the CLI rejects combining those forms. Explicit invalid roots are diagnosed and dropped, so a search can continue with remaining valid directories; startup fails if none remain.

`--absolute-path` normalizes roots into absolute paths before traversal. A root of `.` becomes `./` for walker compatibility; a literal directory named `-` is prefixed with `./`. The root directory entry itself is normally skipped rather than returned as a match.

```bash
fd . src tests
fd --base-directory src -e rs
fd --full-path 'src/.*\.rs$'
```

The pattern is the first positional argument, followed by directory roots. Without `--full-path`, startup rejects `/` in any primary or `--and` pattern. On Windows, native backslashes additionally trigger the path diagnostic only when the supplied pattern names an existing directory, preserving regex escapes such as `\d+`.

## Hidden and ignored are separate controls

| Control | Effect |
| --- | --- |
| Default | Skip hidden entries and honor enabled ignore sources. |
| `--hidden` / `-H` | Include hidden entries while retaining ignore rules. |
| `--no-ignore` / `-I` | Disable standard local, VCS, and fd global ignore sources; hidden filtering remains. |
| `--unrestricted` / `-u` | Combine hidden inclusion with no-ignore. |
| `--no-ignore-vcs` | Disable Git ignore, global Git ignore, and Git exclude rules while retaining fd/local ignore rules. |
| `--no-require-git` | Honor Git-related ignore sources without requiring detection of a Git repository. |
| `--no-ignore-parent` | Stop loading enabled local/VCS ignore rules from parent directories. |
| `--ignore-file PATH` | Add an explicit ignore file to the builder. |
| `--exclude GLOB` / `-E` | Add an exclusion override; prefixing the user glob with `!` reverses it into an inclusion override. |

Opposing flags such as `--ignore`, `--ignore-vcs`, `--ignore-parent`, `--require-git`, and `--no-hidden` restore their paired behavior through CLI overrides. An unrestricted alias is recognized by configuration rather than being an independent traversal engine.

## Ignore sources and precedence

When local ignore reading is enabled, the builder uses its `.ignore` support and registers `.fdignore` as a custom filename. VCS reading independently configures `.gitignore`, global Git ignore, and repository excludes. Git repository detection is required by default. The test `test_respect_ignore_files` removes the fixture's `.git` directory and shows that `--no-require-git` restores `.gitignore` enforcement.

The fd global ignore file is `<etcetera config directory>/fd/ignore`. It is added when global reading is enabled and the file exists. This is distinct from the global Git ignore file. Explicit `--ignore-file` paths are added separately even when automatic ignore sources are disabled. `--exclude` overrides are also constructed separately, relative to the first search root.

Rule interpretation and hierarchy are delegated to `ignore`. A tested boundary is that `.fdignore` can reinclude a filename excluded by a deeper `.gitignore`: `test_custom_ignore_precedence` whitelists `foo` in root `.fdignore` and finds `inner/foo` despite `inner/.gitignore`. Avoid assuming that simply turning on hidden search also bypasses ignore exclusions.

Malformed exclusion overrides fail walker construction. Adding global or custom ignore files can print malformed-pattern diagnostics; partial errors are accepted by the surrounding code. General walk errors become `WorkerResult::Error` and are displayed only with `--show-errors` by the printing consumer. Enabling that flag does not make every filesystem diagnostic fatal.

## Depth, pruning, and marker directories

Maximum depth is enforced by the walker, limiting descent. Minimum depth is checked inside the callback and suppresses results while allowing traversal to continue. `--exact-depth` supplies both bounds. At depth one, immediate children of a root are eligible.

`--prune` returns `WalkState::Skip` only after an entry has passed every name and metadata filter and has been sent as a result. For a matching directory, its descendants are not explored. A nonmatching directory still permits descent; changing a search pattern can therefore change which subtrees are pruned.

`--ignore-contain NAME` checks whether each visited directory contains any configured marker path and skips that directory when it does. This check runs before root suppression and minimum-depth handling. Consequently a marker in the root can suppress the whole search, and a directory below the minimum result depth can still block its descendants. Tests explicitly cover both precedence boundaries.

## Symlinks and filesystem boundaries

`--follow` controls the builder's symlink following; without it, discovered links do not imply recursive traversal of their targets. `--one-file-system` sets the walker's same-filesystem policy on supported platforms. A directory symlink supplied as a search root has dedicated integration coverage and should be checked separately from a link discovered during a walk.

When following produces a not-found error for a path whose symlink metadata still identifies a link, fd recovers it as a broken-symlink entry. That entry can still pass applicable name/type tests, but has no recorded depth. A configured minimum-depth filter rejects entries lacking depth. Required size, time, or owner metadata can further exclude a broken link.

## Diagnosing a missing result

1. Confirm the root and base directory. Use an explicit match-all pattern such as `fd . path/to/root` when the intent is to list a directory.
2. Try `-H` for hidden entries, then `-I` for automatic ignore rules, or `-u` for both. Check explicit exclusions and ignore files separately.
3. Inspect the fd global ignore file, VCS rules, parent rules, and repository detection if toggling ignore flags changes the result.
4. Check depth limits, marker files, `--prune`, symlink following, and filesystem boundaries.
5. Check whether the regex matches a basename or requires `--full-path`, then remove metadata constraints selectively. Use `--show-errors` for traversal diagnostics.

Representative integration tests are `test_hidden`, `test_gitignore_and_fdignore`, `test_custom_ignore_precedence`, `test_no_ignore_parent`, `test_global_ignore`, `test_follow_broken_symlink`, `test_prune`, and the three `test_ignore_contain` cases. See [pipeline architecture](../architecture/search-pipeline.md) for transport and error ownership, or return to the [quickstart](../quickstart.md).
