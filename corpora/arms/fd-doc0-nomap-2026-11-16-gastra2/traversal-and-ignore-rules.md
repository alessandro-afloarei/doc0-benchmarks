---
title: "Traversal and Ignore Rules"
---
## Overview

Traversal determines which filesystem entries can reach the matcher. `WorkerState` builds an `ignore::WalkParallel`, applies the predicates described in [[Search Patterns]] and [[File Filters]], and sends accepted entries or traversal errors to a result consumer. [[Output and Formatting]] and [[Command Execution]] describe what those consumers do after discovery.

Sources: [src/walk.rs:347-403](repo://src/walk.rs#L347-L403), [src/walk.rs:408-440](repo://src/walk.rs#L408-L440), [src/walk.rs:485-600](repo://src/walk.rs#L485-L600)

## Roots and depth

`Opts::search_paths` uses positional roots, alternative `--search-path` roots, or `./` when neither is supplied. Explicit roots must be directories; invalid ones are diagnosed and removed, while valid roots remain searchable. An empty resulting list fails setup. `build_walker` initializes from the first root and adds the others to the same builder, so a multi-root invocation shares one configuration and consumer.

Sources: [src/cli.rs:695-721](repo://src/cli.rs#L695-L721), [src/main.rs:83-87](repo://src/main.rs#L83-L87), [src/walk.rs:347-365](repo://src/walk.rs#L347-L365), [src/walk.rs:398-403](repo://src/walk.rs#L398-L403)

The root entry itself is skipped when its walker depth is zero. `--max-depth` constrains the walker; `--min-depth` suppresses reporting before the minimum without stopping descent. `--exact-depth` supplies both bounds. Depth one denotes entries directly under the root, and depth two adds their children. Because the root is excluded independently, requesting depth zero does not make it a result.

Sources: [src/config.rs:49-56](repo://src/config.rs#L49-L56), [src/cli.rs:747-753](repo://src/cli.rs#L747-L753), [src/walk.rs:362-365](repo://src/walk.rs#L362-L365), [src/walk.rs:480-483](repo://src/walk.rs#L480-L483), [src/walk.rs:508-512](repo://src/walk.rs#L508-L512)

## Visibility controls

| Control | Effect on the configured walk |
| --- | --- |
| Default | Skip hidden entries and enable ordinary, fd-specific and VCS ignore sources |
| `--hidden`, `-H` | Disable the hidden-entry filter |
| `--no-ignore`, `-I` | Disable ordinary/fd, VCS and fd global ignore loading |
| `--unrestricted`, `-u` | Combine hidden inclusion with no-ignore behavior |
| `--no-ignore-vcs` | Disable the Git ignore sources while retaining ordinary ignore sources |
| `--no-ignore-parent` | Disable inherited parent ignore-file lookup |
| `--no-require-git` | Permit Git ignore rules without detecting a repository |

Sources: [src/main.rs:310-320](repo://src/main.rs#L310-L320), [src/cli.rs:81-97](repo://src/cli.rs#L81-L97), [src/cli.rs:122-128](repo://src/cli.rs#L122-L128), [src/walk.rs:352-369](repo://src/walk.rs#L352-L369)

The builder enables `.ignore` handling through its ordinary ignore switch and registers `.fdignore` as a custom ignore filename. Git handling separately controls `.gitignore`, global Git ignore rules and Git exclude files. Parent lookup is enabled only when parent handling is allowed and at least one ordinary or VCS ignore family remains enabled. This is why changing only VCS visibility can still leave entries hidden by another ignore source.

Sources: [src/cli.rs:51-60](repo://src/cli.rs#L51-L60), [src/main.rs:313-320](repo://src/main.rs#L313-L320), [src/walk.rs:352-369](repo://src/walk.rs#L352-L369)

The fd global ignore file is resolved with `etcetera` as the platform configuration directory followed by `fd/ignore`; it is loaded only when enabled and present as a file. Explicit `--ignore-file` paths are added in a separate loop even when normal ignore loading is disabled. Both loops suppress partial parse errors, print other reported errors and continue building the walker. Failure to choose a base-directory strategy skips global-file loading.

Sources: [src/walk.rs:371-396](repo://src/walk.rs#L371-L396), [src/main.rs:380-381](repo://src/main.rs#L380-L381), [src/cli.rs:507-518](repo://src/cli.rs#L507-L518)

## Exclusion and subtree decisions

`--exclude` patterns become negative override patterns by prefixing `!`, then pass through an `OverrideBuilder` rooted at the first search directory. The CLI describes these exclusions as overriding other ignore logic. Malformed override patterns propagate as setup errors. Explicit exclusions remain a separate configuration field, so `--unrestricted` does not remove them.

Sources: [src/cli.rs:310-324](repo://src/cli.rs#L310-L324), [src/main.rs:313-320](repo://src/main.rs#L313-L320), [src/main.rs:380-381](repo://src/main.rs#L380-L381), [src/walk.rs:330-365](repo://src/walk.rs#L330-L365)

`--ignore-contain` checks each directory for any configured child name with `exists()`. A match returns `WalkState::Skip` before the root-depth and pattern checks, so it excludes that directory's subtree independently of whether the directory name matches. The implementation checks the entry type before attempting these child lookups to avoid unnecessary filesystem calls.

Sources: [src/walk.rs:464-484](repo://src/walk.rs#L464-L484)

`--prune` operates later: an entry must first pass all search criteria and be sent successfully to the consumer, then the callback returns `Skip`. For a matching directory, this prevents descending into it while retaining the directory as a result. The CLI distinguishes this from excluding named directories and rejects combining pruning with size or exact-depth options.

Sources: [src/cli.rs:326-331](repo://src/cli.rs#L326-L331), [src/walk.rs:600-611](repo://src/walk.rs#L600-L611)

## Links and filesystem boundaries

By default fd does not descend into symlinked directories; `--follow` enables following them and `--no-follow` can override it. `--one-file-system` asks the walker to remain within each starting filesystem. These are builder settings, not later name filters, so they affect which descendants can be discovered before matching begins.

Sources: [src/cli.rs:240-253](repo://src/cli.rs#L240-L253), [src/cli.rs:682-688](repo://src/cli.rs#L682-L688), [src/walk.rs:362-365](repo://src/walk.rs#L362-L365)

A path-associated not-found traversal error receives special handling when `symlink_metadata` confirms that the path is a symlink. The worker wraps it as a broken-link entry instead of reporting it only as an error. That entry obtains metadata from `symlink_metadata` and has no walker depth; a configured minimum depth rejects entries without a depth. Other traversal errors are sent as `WorkerResult::Error`.

Sources: [src/walk.rs:485-512](repo://src/walk.rs#L485-L512), [src/dir_entry.rs:82-103](repo://src/dir_entry.rs#L82-L103)

## Parallel delivery and termination

Each walker callback owns a `BatchSender`. A batch holds its vector behind an `Arc<Mutex<Option<...>>>`; the receiver takes ownership of the vector once, and the sender creates a replacement after the vector is taken or its limit is reached. Publishing the batch when its first item arrives lets a receiver obtain work without waiting for the batch to fill. The size limit provides backpressure alongside the bounded channel.

Sources: [src/walk.rs:47-120](repo://src/walk.rs#L47-L120), [src/walk.rs:636-646](repo://src/walk.rs#L636-L646)

The ordinary sender limit is 256 entries, reduced to one for multithreaded per-entry command execution to distribute jobs evenly. The channel holds twice the configured thread count. `scan` starts the receiver in a scoped thread, runs the walker senders, and joins the receiver for its exit status. This connects the bounded discovery pipeline from [[Overview]] to either printing or process execution without storing the complete search result set in the traversal layer.

Sources: [src/walk.rs:449-457](repo://src/walk.rs#L449-L457), [src/walk.rs:616-652](repo://src/walk.rs#L616-L652)

Workers stop when the shared quit flag is set or delivery fails because the consumer has closed. In ordinary output mode, the receiver sets the flag when it exits, including after a result limit or quiet-mode match. Traversal errors do not automatically abort the walk: consumers print them only when `--show-errors` enables filesystem-error reporting, then continue processing subsequent entries.

Sources: [src/walk.rs:173-180](repo://src/walk.rs#L173-L180), [src/walk.rs:198-231](repo://src/walk.rs#L198-L231), [src/walk.rs:459-462](repo://src/walk.rs#L459-L462), [src/walk.rs:600-604](repo://src/walk.rs#L600-L604), [src/exec/job.rs:23-30](repo://src/exec/job.rs#L23-L30), [src/main.rs:386-386](repo://src/main.rs#L386-L386)
