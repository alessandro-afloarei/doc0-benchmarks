---
title: "Ignore Rules and Traversal"
---
## Overview

The walker decides which parts of the filesystem can produce candidates, tests those candidates, and sends accepted entries to a consumer. `WorkerState` owns the compiled patterns, `Config`, and shared quit and interrupt flags. [[Search Patterns and Roots]] describes how startup produces those inputs; this page follows them into `WalkBuilder` and the parallel callback. Metadata predicates belong to [[File Filters]], while [[Result Output]] and [[Command Execution]] describe the consumers.

Sources: [src/walk.rs:305-327](repo://src/walk.rs#L305-L327), [src/walk.rs:347-403](repo://src/walk.rs#L347-L403), [src/walk.rs:408-440](repo://src/walk.rs#L408-L440)

## Visibility controls

Hidden visibility and ignore-file reading are separate settings. Configuration excludes hidden entries unless `--hidden` or `--unrestricted` is selected. `--no-ignore` and `--unrestricted` disable the ordinary ignore-file settings; `--no-ignore-vcs` disables just VCS ignore handling. Including hidden entries therefore does not automatically include an entry excluded by an ignore file.

Sources: [src/main.rs:310-320](repo://src/main.rs#L310-L320), [src/cli.rs:33-60](repo://src/cli.rs#L33-L60), [src/cli.rs:66-97](repo://src/cli.rs#L66-L97), [src/cli.rs:122-128](repo://src/cli.rs#L122-L128)

| Control | Effect in the walker |
| --- | --- |
| Hidden setting | Passed to `WalkBuilder::hidden` |
| Ordinary ignore setting | Enables `.ignore` handling and registers `.fdignore` |
| VCS ignore setting | Controls Git ignore, global Git ignore, and Git exclude handling |
| Parent ignore setting | Reads parents only when ordinary or VCS ignore reading is also active |
| `--no-require-git` | Relaxes the Git repository requirement for Git ignore rules |
| `--no-global-ignore-file` | Disables loading fd's own global ignore file |

Sources: [src/main.rs:313-320](repo://src/main.rs#L313-L320), [src/walk.rs:352-385](repo://src/walk.rs#L352-L385), [src/cli.rs:81-120](repo://src/cli.rs#L81-L120)

For fd's global ignore file, `build_walker` asks `etcetera` for a base strategy and appends `fd/ignore` to its configuration directory. It adds that file only when global ignore reading is enabled and the file exists. Each explicit `--ignore-file` is added separately, so these custom files are still processed by the builder even when automatic ignore loading is disabled. The CLI describes their syntax as Git ignore format and their precedence as low.

Sources: [src/walk.rs:371-396](repo://src/walk.rs#L371-L396), [src/cli.rs:510-518](repo://src/cli.rs#L510-L518)

## Excludes and ignore-file failures

`--exclude` accepts repeatable glob patterns and is documented to override other ignore logic. Configuration prepends `!` to each user pattern before `build_overrides` adds it to an `OverrideBuilder` rooted at the first search path. Malformed patterns return a startup error, and failure to build the combined override returns a mismatch error. This path differs from candidate-level errors: an invalid override prevents creation of the walker.

Sources: [src/cli.rs:310-324](repo://src/cli.rs#L310-L324), [src/main.rs:378-381](repo://src/main.rs#L378-L381), [src/walk.rs:330-350](repo://src/walk.rs#L330-L350)

Global and custom ignore-file additions handle errors locally. `ignore::Error::Partial` is accepted without a diagnostic in these branches; other returned errors print a malformed-pattern message and construction continues. The builder then adds every root after the first and creates its parallel walker with the configured number of threads.

Sources: [src/walk.rs:371-403](repo://src/walk.rs#L371-L403)

## Traversal boundaries

Maximum depth is supplied to `WalkBuilder`; minimum depth is checked in the callback and suppresses reporting without stopping traversal. `--exact-depth` feeds the same value into both limits. Root directory entries have depth zero and are skipped before matching, so selecting a root does not itself emit that root. The configuration describes depth one as entries immediately beneath the root.

Sources: [src/walk.rs:352-365](repo://src/walk.rs#L352-L365), [src/walk.rs:480-512](repo://src/walk.rs#L480-L512), [src/cli.rs:747-753](repo://src/cli.rs#L747-L753), [src/config.rs:49-56](repo://src/config.rs#L49-L56)

`--follow` enables descending into symlinked directories; without it, the CLI says they are not descended into. `--one-file-system` passes the same-filesystem restriction to the walker. `--ignore-contain` is checked earlier in the callback: if a directory contains any named entry, the callback returns `Skip`, including when that directory is a root. It tests directory type first to avoid unnecessary filesystem calls.

Sources: [src/cli.rs:240-249](repo://src/cli.rs#L240-L249), [src/walk.rs:362-365](repo://src/walk.rs#L362-L365), [src/walk.rs:464-483](repo://src/walk.rs#L464-L483)

`--prune` takes effect only after an entry passes every predicate and is sent as a result. Returning `Skip` at that point prevents descending into a matching directory. A directory rejected by its name or metadata predicate returns `Continue`, so it can still contain matching descendants. The CLI rejects prune with size and exact-depth constraints and directs explicit directory exclusion toward `--exclude`.

Sources: [src/walk.rs:519-542](repo://src/walk.rs#L519-L542), [src/walk.rs:600-611](repo://src/walk.rs#L600-L611), [src/cli.rs:326-331](repo://src/cli.rs#L326-L331)

## Entries and worker errors

Successful walker entries become `DirEntry::normal`. A missing-path error becomes a broken-symlink entry when symlink metadata confirms the path is a symlink. Other errors are sent as `WorkerResult::Error`, allowing the walk to continue while a consumer decides whether to display them. Broken symlink entries keep their own path and use `symlink_metadata`; they have no recorded depth, so a configured minimum depth rejects them.

Sources: [src/walk.rs:485-512](repo://src/walk.rs#L485-L512), [src/dir_entry.rs:34-46](repo://src/dir_entry.rs#L34-L46), [src/dir_entry.rs:82-103](repo://src/dir_entry.rs#L82-L103)

## Parallel delivery and shutdown

The default thread count uses available parallelism, falls back to one, and caps the result at 64 to limit startup overhead. An explicit `--threads` accepts a nonzero value. Each sender normally groups up to 256 items; per-entry command mode with more than one thread reduces that limit to one for even work distribution. The bounded channel holds twice the configured thread count in batches, providing backpressure between discovery and consumption.

Sources: [src/cli.rs:554-557](repo://src/cli.rs#L554-L557), [src/cli.rs:755-757](repo://src/cli.rs#L755-L757), [src/cli.rs:788-800](repo://src/cli.rs#L788-L800), [src/walk.rs:90-121](repo://src/walk.rs#L90-L121), [src/walk.rs:449-457](repo://src/walk.rs#L449-L457), [src/walk.rs:636-645](repo://src/walk.rs#L636-L645)

`scan` starts the receiver in a scoped thread, runs walker senders, and joins the receiver. Workers stop when the quit flag is observed or channel sending fails. Colored printing installs a Ctrl-C handler that sets quit and interrupt flags; a second signal exits immediately. The scan returns the interrupt status if that flag was set, otherwise the receiver's status. [[Result Output]] explains how normal completion, quiet mode, and output failures cause the printing receiver to stop.

Sources: [src/walk.rs:459-462](repo://src/walk.rs#L459-L462), [src/walk.rs:600-604](repo://src/walk.rs#L600-L604), [src/walk.rs:617-652](repo://src/walk.rs#L617-L652), [src/walk.rs:173-180](repo://src/walk.rs#L173-L180)
