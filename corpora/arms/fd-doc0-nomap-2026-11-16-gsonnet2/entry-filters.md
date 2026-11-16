---
title: "Entry Filters"
---
## Overview

After the walker yields an entry, fd applies a fixed sequence of filters inside the closure created by `spawn_senders` in `src/walk.rs`. An entry that fails any filter is dropped with `WalkState::Continue` and never reaches the receiver. The filters run on the walker threads, in parallel, and are ordered so that checks needing no metadata run first. Directory-level decisions such as ignore files and pruning are in [[Directory Traversal and Ignore Rules]].

Sources: [src/walk.rs:459-465](repo://src/walk.rs#L459-L465), [src/walk.rs:508-524](repo://src/walk.rs#L508-L524), [src/walk.rs:600-604](repo://src/walk.rs#L600-L604)

## Order of the checks

| Step | Filter | Needs metadata |
| --- | --- | --- |
| 1 | minimum depth | no |
| 2 | pattern(s), see [[Pattern Matching]] | no |
| 3 | extension | no |
| 4 | file type | file type, sometimes more |
| 5 | owner (Unix only) | yes |
| 6 | size | yes |
| 7 | modification time | yes |

Sources: [src/walk.rs:508-591](repo://src/walk.rs#L508-L591)

The source comment says why the pattern comes first: "Check the name first, since it doesn't require metadata". `DirEntry::metadata` caches its result in a `OnceCell`, so the owner, size and time filters share one `stat` call per entry, and entries rejected earlier never trigger one.

Sources: [src/walk.rs:514-517](repo://src/walk.rs#L514-L517), [src/dir_entry.rs:17-22](repo://src/dir_entry.rs#L17-L22), [src/dir_entry.rs:89-96](repo://src/dir_entry.rs#L89-L96)

## Depth and extension

`--min-depth` drops entries shallower than the minimum. `--exact-depth` sets both limits to the same value in `Config`. The root entry is already skipped earlier.

Sources: [src/walk.rs:508-512](repo://src/walk.rs#L508-L512), [src/cli.rs:747-753](repo://src/cli.rs#L747-L753)

The extension filter is a `RegexSet` built at startup (see [[Startup and Configuration]]) and tested against the file name only. An entry without a file name fails the filter.

Sources: [src/walk.rs:526-535](repo://src/walk.rs#L526-L535)

## File types

`FileTypes::should_ignore` returns true when an entry must be dropped. It reads the entry's file type; if that is unavailable the entry is dropped. Otherwise it is dropped when any of these holds:

Sources: [src/filetypes.rs:20-43](repo://src/filetypes.rs#L20-L43)

- its kind (file, directory, symlink, block device, character device, socket, pipe) was not requested;
- `executables_only` is set and the path is not executable for the current user;
- `empty_only` is set and `filesystem::is_empty` says no: a directory is empty when `read_dir` yields nothing, a file when its length is 0, anything else never;
- it is none of the known kinds.

Sources: [src/filetypes.rs:20-43](repo://src/filetypes.rs#L20-L43), [src/filesystem.rs:42-58](repo://src/filesystem.rs#L42-L58)

The device, socket and pipe checks are real only on Unix-like targets; on Windows they return false, so those types are never found there.

Sources: [src/filesystem.rs:60-100](repo://src/filesystem.rs#L60-L100)

## Owner

`--owner` takes `user`, `user:group`, `:group` or numeric ids, and a leading `!` negates a side. `OwnerFilter::from_string` splits on `:` (a second `:` is an error), and each side is parsed by `Check::parse`: an empty side is `Ignore`, a leading `!` gives `NotEq`, otherwise `Equal`. A side that is not a number is looked up by name with `nix`, and an unknown name is an error. `matches` compares the entry's uid and gid. `filter_ignore` turns an all-ignore filter into `None`, so a value like `:` costs nothing during the walk.

Sources: [src/filter/owner.rs:5-74](repo://src/filter/owner.rs#L5-L74), [src/filter/owner.rs:85-102](repo://src/filter/owner.rs#L85-L102)

In the walker, an entry whose metadata cannot be read is dropped. The module is compiled only on Unix (`#[cfg(unix)]`).

Sources: [src/walk.rs:544-555](repo://src/walk.rs#L544-L555), [src/filter/mod.rs:1-11](repo://src/filter/mod.rs#L1-L11)

## Size

`SizeFilter::parse_opt` matches `^([+-]?)(\d+)(b|[kmgt]i?b?)$` case-insensitively. The sign picks the variant: `+` means at least that size (`Min`), `-` means at most (`Max`), and no sign means exactly that size (`Equals`). The sign group `([+-]?)` always takes part in a match, possibly as an empty string, so the `"+"` default in the `map_or` is never used and the `""` arm is what a bare `10k` reaches. Units starting with `k`, `m`, `g`, `t` are powers of 1000; adding `i` (`ki`, `mib`) makes them powers of 1024; `b` is bytes.

Sources: [src/filter/size.rs:6-66](repo://src/filter/size.rs#L6-L66)

`is_within` compares inclusively. In the walker, if any size constraint exists, a non-file (directory, symlink target not a file) is dropped, a file without readable metadata is dropped, and a file must satisfy every constraint.

Sources: [src/filter/size.rs:68-74](repo://src/filter/size.rs#L68-L74), [src/walk.rs:557-575](repo://src/walk.rs#L557-L575)

## Time

`TimeFilter::from_str` tries four formats in order and returns the first that parses:

Sources: [src/filter/time.rs:29-47](repo://src/filter/time.rs#L29-L47)

1. a duration (`jiff::Span`) such as `10h` or `2weeks`, taken as that long before now;
2. an RFC 3339 timestamp;
3. a civil date-time in the system time zone, resolved to the later instant if ambiguous;
4. `@` followed by Unix seconds.

Sources: [src/filter/time.rs:30-46](repo://src/filter/time.rs#L30-L46)

`--changed-within` builds `After` and `--changed-before` builds `Before`. `applies_to` uses strict comparisons. In the walker, every constraint must match the entry's modification time; an entry with no readable time is dropped.

Sources: [src/filter/time.rs:5-63](repo://src/filter/time.rs#L5-L63), [src/walk.rs:577-591](repo://src/walk.rs#L577-L591)

## After the filters

An entry that survives all checks gets its colour style computed in the walker thread when output is being printed and colour is on, so styling is parallel too. It is then sent to the receiver; see [[Result Pipeline and Output]].

Sources: [src/walk.rs:593-604](repo://src/walk.rs#L593-L604)
