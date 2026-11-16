---
title: "Traversal and Ignore Rules"
---
## Overview

Traversal determines which entries can reach the matcher. `WorkerState::build_walker` configures the `ignore` crate's parallel walker with roots, visibility rules, exclusions, link handling, filesystem boundaries and depth. The callback then handles marker directories, filters and pruning. Root invocation syntax is in [[Quickstart]], and candidate-string matching is in [[Search Patterns]]; a missing result can be excluded before that matching stage runs.

Sources: [src/walk.rs:347-403](repo://src/walk.rs#L347-L403), [src/walk.rs:459-483](repo://src/walk.rs#L459-L483), [src/walk.rs:508-541](repo://src/walk.rs#L508-L541), [src/walk.rs:600-611](repo://src/walk.rs#L600-L611)

## Roots and walker construction

Startup changes to `--base-directory` first, then `Opts::search_paths` chooses positional roots, alternate `--search-path` values, or `./`. Explicit roots must be existing directories; invalid ones produce a diagnostic and are removed. If none survive, `run` fails. Absolute-output mode normalizes roots to absolute paths, while a root spelled `-` gains a dot prefix so the underlying walker treats it as a path.

Sources: [src/main.rs:83-87](repo://src/main.rs#L83-L87), [src/main.rs:131-147](repo://src/main.rs#L131-L147), [src/cli.rs:695-736](repo://src/cli.rs#L695-L736)

`build_walker` starts with the first root, adds remaining roots, and calls `threads(config.threads).build_parallel()`. The callback ignores depth-zero root entries, so roots are starting points rather than normal results. Marker-directory handling runs even before this root check, allowing a marker in the root to suppress its entire subtree.

Sources: [src/walk.rs:347-365](repo://src/walk.rs#L347-L365), [src/walk.rs:398-403](repo://src/walk.rs#L398-L403), [src/walk.rs:464-483](repo://src/walk.rs#L464-L483), [tests/tests.rs:2873-2878](repo://tests/tests.rs#L2873-L2878)

## Hidden entries and ignore controls

Hidden filtering, fd ignore files and VCS ignore files have separate configuration booleans. `--hidden` changes hidden filtering alone. `--no-ignore` disables fd, VCS and global fd ignore reading, while `--unrestricted` also disables hidden filtering. The builder's `ignore` setting covers ordinary ignore handling, and `.fdignore` is registered as a custom ignore filename when fd ignore reading is enabled.

Sources: [src/main.rs:310-320](repo://src/main.rs#L310-L320), [src/cli.rs:33-60](repo://src/cli.rs#L33-L60), [src/cli.rs:122-128](repo://src/cli.rs#L122-L128), [src/walk.rs:352-368](repo://src/walk.rs#L352-L368)

| Control | Effect in configuration or walker setup |
| --- | --- |
| `--no-ignore-vcs` | Disable Git ignore, global Git ignore and Git exclude handling; retain fd ignore handling |
| `--no-require-git` | Read Git-related ignore rules without requiring a detected Git repository |
| `--no-ignore-parent` | Disable parent ignore lookup; it also requires either fd or VCS ignore reading to be enabled |
| `--no-global-ignore-file` | Disable the separately loaded global fd ignore file |
| `--ignore-file path` | Add an explicit ignore file independently of the automatic-file booleans |
| `--exclude glob`, `-E glob` | Add an override pattern, documented to override other ignore logic |

Sources: [src/main.rs:313-320](repo://src/main.rs#L313-L320), [src/main.rs:380-381](repo://src/main.rs#L380-L381), [src/walk.rs:330-395](repo://src/walk.rs#L330-L395), [src/cli.rs:310-324](repo://src/cli.rs#L310-L324)

The global fd file is located by the platform base-directory strategy at `config_dir()/fd/ignore`. It is loaded only if global reading is enabled and the file exists. Explicit `--ignore-file` entries are subsequently added even if automatic ignores were disabled; CLI help calls these low-precedence files. Malformed global or custom files can print diagnostics during construction, while partial errors are ignored by these branches.

Sources: [src/walk.rs:371-395](repo://src/walk.rs#L371-L395), [src/cli.rs:510-518](repo://src/cli.rs#L510-L518)

Configuration prepends `!` to each exclusion before adding it to `OverrideBuilder` rooted at the first search path. A malformed exclusion returns an error and prevents the scan from starting. Ignore-file precedence is delegated to the walker; one integration test specifically verifies that `!foo` in a root `.fdignore` admits `inner/foo` despite `foo` in the inner `.gitignore`.

Sources: [src/main.rs:380-381](repo://src/main.rs#L380-L381), [src/walk.rs:330-350](repo://src/walk.rs#L330-L350), [tests/tests.rs:862-884](repo://tests/tests.rs#L862-L884)

## Depth, markers and pruning

Maximum depth constrains traversal in `WalkBuilder`, while minimum depth filters reported entries in the callback. A depth of one includes direct children. `--exact-depth` supplies both limits and conflicts with independently supplied minimum or maximum limits. The callback skips roots regardless, so exact depth zero does not make the root a result. An entry lacking a known depth is rejected when a minimum depth is active.

Sources: [src/config.rs:49-56](repo://src/config.rs#L49-L56), [src/cli.rs:278-308](repo://src/cli.rs#L278-L308), [src/cli.rs:747-753](repo://src/cli.rs#L747-L753), [src/walk.rs:363-365](repo://src/walk.rs#L363-L365), [src/walk.rs:480-483](repo://src/walk.rs#L480-L483), [src/walk.rs:508-512](repo://src/walk.rs#L508-L512)

`--ignore-contain name` checks whether a directory contains any named marker entry. The callback checks the entry type first to avoid unnecessary syscalls, then tests `entry_path.join(name).exists()`. A hit returns `WalkState::Skip` immediately, suppressing the directory and its descendants. The marker test precedes minimum-depth filtering, so a marker directory above the minimum depth still blocks the subtree.

Sources: [src/cli.rs:550-552](repo://src/cli.rs#L550-L552), [src/walk.rs:464-483](repo://src/walk.rs#L464-L483), [src/walk.rs:508-512](repo://src/walk.rs#L508-L512), [tests/tests.rs:2855-2870](repo://tests/tests.rs#L2855-L2870)

`--prune` operates later: an entry must first match the patterns and pass [[Entry Filters]], then be sent to the receiver. Only then does the callback return `Skip`. A directory that fails the search criteria therefore remains traversable. The CLI conflicts prune with size constraints and exact-depth searches; exclusions are the documented way to omit specific directories without requiring them to match the search.

Sources: [src/cli.rs:326-331](repo://src/cli.rs#L326-L331), [src/walk.rs:514-591](repo://src/walk.rs#L514-L591), [src/walk.rs:600-611](repo://src/walk.rs#L600-L611)

## Symlinks and filesystem boundaries

The default does not descend into symlinked directories. `--follow` enables that behavior by setting the walker's `follow_links` option; `--no-follow` overrides it. On Unix and Windows, `--one-file-system`, also available as `--mount` or `--xdev`, sets `same_file_system` so traversal stays on each starting filesystem.

Sources: [src/cli.rs:240-253](repo://src/cli.rs#L240-L253), [src/cli.rs:682-688](repo://src/cli.rs#L682-L688), [src/walk.rs:362-365](repo://src/walk.rs#L362-L365)

A walker error carrying a path whose I/O error is `NotFound` can become a broken-symlink entry if `symlink_metadata` confirms it is a link. `DirEntry` then uses the path's symlink metadata and reports no known traversal depth. Other errors become `WorkerResult::Error`; the receiver prints them only when `--show-errors` is active, then continues processing.

Sources: [src/walk.rs:485-505](repo://src/walk.rs#L485-L505), [src/dir_entry.rs:82-102](repo://src/dir_entry.rs#L82-L102), [src/walk.rs:227-231](repo://src/walk.rs#L227-L231), [src/exec/job.rs:23-30](repo://src/exec/job.rs#L23-L30), [src/exec/job.rs:51-60](repo://src/exec/job.rs#L51-L60)

## Parallel delivery and stopping

`scan` creates a bounded channel sized to twice the configured thread count, starts the receiver in a scoped thread, and runs the parallel senders. Sender batches normally have a 256-entry limit; concurrent per-entry commands switch that limit to one for work distribution. Every callback checks a shared quit flag, and a failed channel send also stops traversal. [[Result Output]] describes how receiver limits and output failures request that shutdown; [[Command Execution]] describes command consumers.

Sources: [src/walk.rs:449-462](repo://src/walk.rs#L449-L462), [src/walk.rs:600-604](repo://src/walk.rs#L600-L604), [src/walk.rs:636-645](repo://src/walk.rs#L636-L645), [src/walk.rs:173-179](repo://src/walk.rs#L173-L179)
