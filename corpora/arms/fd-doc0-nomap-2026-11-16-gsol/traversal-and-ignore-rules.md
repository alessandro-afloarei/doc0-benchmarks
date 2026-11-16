---
title: "Traversal and Ignore Rules"
---
## Overview

Traversal determines which entries reach the matching pipeline and which directories are descended into. `WorkerState::build_walker` configures an `ignore::WalkBuilder`, and parallel callbacks apply fd's remaining entry checks. The name-matching stage described in [[Search Patterns]] only sees entries supplied by this walker; an entry inside a skipped directory cannot become a result merely because its name matches.

Sources: [src/walk.rs:347-403](repo://src/walk.rs#L347-L403), [src/walk.rs:442-484](repo://src/walk.rs#L442-L484), [src/walk.rs:514-524](repo://src/walk.rs#L514-L524)

## Resolve the roots

Startup applies `--base-directory` before resolving roots. It verifies the base is an existing directory, changes the process working directory, and reports a contextual error if that change fails. Roots then come from positional path arguments or repeated `--search-path` options, which conflict with positional paths. With neither form present, `search_paths` verifies and uses `./`.

Sources: [src/main.rs:83-89](repo://src/main.rs#L83-L89), [src/main.rs:131-146](repo://src/main.rs#L131-L146), [src/cli.rs:652-672](repo://src/cli.rs#L652-L672), [src/cli.rs:696-705](repo://src/cli.rs#L696-L705)

Each explicit root must be an existing directory. Invalid roots produce diagnostics and are removed; startup only fails for this reason when no valid roots remain. Absolute-output mode normalizes valid roots and converts them to absolute paths. A literal `.` becomes `./` for an underlying-walker workaround, and a root named `-` is prefixed with `./` so the walker treats it as a path.

Sources: [src/cli.rs:707-735](repo://src/cli.rs#L707-L735), [src/main.rs:84-87](repo://src/main.rs#L84-L87)

The first valid root initializes both the walker and exclude-override builder; subsequent roots are added to the same walker. The callback omits every depth-zero root entry from results. Thus a root supplies the place to search, while its descendants supply the candidate entries. The directory-containing-marker check runs even before this root omission, allowing a marker to skip an entire search root.

Sources: [src/walk.rs:330-365](repo://src/walk.rs#L330-L365), [src/walk.rs:398-403](repo://src/walk.rs#L398-L403), [src/walk.rs:464-484](repo://src/walk.rs#L464-L484)

## Configure ignore sources

| Control | Effect in fd configuration |
| --- | --- |
| Default | Skips hidden entries and enables ordinary, VCS, parent and global ignore reading |
| `-H`, `--hidden` | Includes hidden entries without disabling ignore files |
| `-I`, `--no-ignore` | Disables ordinary, VCS and fd global ignore reading |
| `-u`, `--unrestricted` | Includes hidden entries and disables those ignore sources |
| `--no-ignore-vcs` | Disables VCS ignore reading while keeping ordinary ignore handling |
| `--no-ignore-parent` | Disables loading ignore rules from parent directories |
| `--no-require-git` | Allows VCS ignore rules without requiring a Git repository |
| `--ignore-file` | Adds an explicit custom ignore file in gitignore format |

Sources: [src/cli.rs:33-128](repo://src/cli.rs#L33-L128), [src/cli.rs:510-518](repo://src/cli.rs#L510-L518), [src/main.rs:310-320](repo://src/main.rs#L310-L320), [src/walk.rs:352-395](repo://src/walk.rs#L352-L395)

The builder maps ordinary ignore reading to its `.ignore` support and adds `.fdignore` as a custom filename when that setting is enabled. VCS configuration controls repository `.gitignore`, global Git ignores and Git exclude rules together. Parent-rule reading is enabled only when the parent setting and at least one ordinary or VCS ignore setting are enabled. The corresponding hidden inverse flags allow several CLI choices to be overridden later in the invocation.

Sources: [src/walk.rs:352-368](repo://src/walk.rs#L352-L368), [src/cli.rs:47-115](repo://src/cli.rs#L47-L115)

The fd global ignore file is the `fd/ignore` path below the configuration directory returned by `etcetera::choose_base_strategy`. It is added when global-ignore reading is enabled and the file exists. Explicit `--ignore-file` paths are added afterward and remain a separate list even when ordinary ignore handling is disabled. The CLI describes these custom files as having low precedence. For both global and custom files, the code ignores `Partial` errors and prints other returned errors as malformed-pattern diagnostics.

Sources: [src/walk.rs:371-395](repo://src/walk.rs#L371-L395), [src/main.rs:318-320](repo://src/main.rs#L318-L320), [src/main.rs:380-381](repo://src/main.rs#L380-L381), [src/cli.rs:510-518](repo://src/cli.rs#L510-L518)

## Exclude and stop descent

`--exclude` accepts repeatable glob patterns that override other ignore logic. Configuration prefixes each supplied pattern with `!` before adding it to `OverrideBuilder`; malformed patterns fail walker construction with a specific exclude-pattern error. This mechanism is independent of the name expression, so it can remove a directory from traversal without requiring that directory to match the search pattern.

Sources: [src/cli.rs:310-324](repo://src/cli.rs#L310-L324), [src/main.rs:380-381](repo://src/main.rs#L380-L381), [src/walk.rs:330-350](repo://src/walk.rs#L330-L350)

`--ignore-contain` skips directories containing any named entry: the callback first checks that the entry is a directory, then checks whether a joined marker path exists. `--prune` works later, after an entry satisfies all search criteria and is sent to the consumer. It returns `WalkState::Skip` for that match, stopping further descent into matching directories. A rejected name or metadata predicate returns `Continue`, so it does not trigger pruning. Clap disallows pruning with size or exact-depth constraints.

Sources: [src/cli.rs:326-331](repo://src/cli.rs#L326-L331), [src/cli.rs:550-552](repo://src/cli.rs#L550-L552), [src/walk.rs:464-478](repo://src/walk.rs#L464-L478), [src/walk.rs:519-542](repo://src/walk.rs#L519-L542), [src/walk.rs:600-611](repo://src/walk.rs#L600-L611)

## Bound depth and filesystem access

Maximum depth is a walker setting and limits descent. Minimum depth is a callback filter that suppresses shallow results while allowing traversal to continue. `--exact-depth` supplies both limits and conflicts with specifying either separately. Depth one includes immediate children of a root. `--one-file-system` asks the walker to remain on the filesystem where it started, and `-L` or `--follow` enables traversal through symlinked directories.

Sources: [src/cli.rs:240-253](repo://src/cli.rs#L240-L253), [src/cli.rs:278-308](repo://src/cli.rs#L278-L308), [src/cli.rs:682-688](repo://src/cli.rs#L682-L688), [src/cli.rs:747-753](repo://src/cli.rs#L747-L753), [src/config.rs:49-56](repo://src/config.rs#L49-L56), [src/walk.rs:362-365](repo://src/walk.rs#L362-L365), [src/walk.rs:508-512](repo://src/walk.rs#L508-L512)

## Coordinate workers and errors

`scan` builds the parallel walker and a bounded channel, then runs the consumer on a scoped thread while the walker produces results. Callback instances share compiled patterns, configuration and a quit flag, but each gets a batch sender. The default sender limit is 256; parallel per-entry execution uses one to spread entries among command consumers. [[Output and Pipelines]] and [[Command Execution]] describe the two consumer families, while [[Metadata Filters]] follows the predicates before sending.

Sources: [src/walk.rs:442-462](repo://src/walk.rs#L442-L462), [src/walk.rs:600-611](repo://src/walk.rs#L600-L611), [src/walk.rs:616-645](repo://src/walk.rs#L616-L645)

An error with a path whose target is missing is recovered as a broken-symlink entry when `symlink_metadata` still identifies a symlink. That representation has no depth, so a configured minimum depth excludes it. Other traversal errors become `WorkerResult::Error` records; consumers print them when `--show-errors` is enabled and continue. A closed consumer channel causes sending to fail and tells the walker to quit.

Sources: [src/walk.rs:485-512](repo://src/walk.rs#L485-L512), [src/dir_entry.rs:89-102](repo://src/dir_entry.rs#L89-L102), [src/walk.rs:227-231](repo://src/walk.rs#L227-L231), [src/exec/job.rs:23-30](repo://src/exec/job.rs#L23-L30), [src/walk.rs:600-604](repo://src/walk.rs#L600-L604)
