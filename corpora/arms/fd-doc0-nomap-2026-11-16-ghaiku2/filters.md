---
title: "Filters"
---
## Overview

A filter drops an entry that has already matched the name. The walk applies five of them, in this order: extension, file type, owner, size and modification time. Each one is a plain test on the `DirEntry` and returns `WalkState::Continue` on failure, so a filter never reports an error for a single entry. The parsing of each option happens earlier, when the command line is read, so a bad value stops the run before the walk starts.

Sources: [src/walk.rs:525-590](repo://src/walk.rs#L525-L590), [src/cli.rs:412-417](repo://src/cli.rs#L412-L417)

## Extensions

`--extension` values are turned into one `RegexSet` in `construct_config`. A leading dot is stripped from each value, and the set matches `\.ext$` case-insensitively on the file name. Because it is a set, an entry matches if it has any one of the given extensions.

Sources: [src/main.rs:361-372](repo://src/main.rs#L361-L372), [src/walk.rs:526-531](repo://src/walk.rs#L526-L531)

## File types

`--type` values become the `FileTypes` struct. `construct_config` maps each value to one flag: `file` and `directory` set their own flags, `symlink` sets `symlinks`, and `socket`, `pipe`, `char-device` and `block-device` set their device flags. `executable` sets `executables_only` and also `files`, so only regular files can be executable. `empty` sets `empty_only`, and when it is the only value it turns on files and directories both.

Sources: [src/main.rs:333-360](repo://src/main.rs#L333-L360), [src/cli.rs:803-825](repo://src/cli.rs#L803-L825)

`should_ignore` answers true when the entry type is not one of the requested kinds. A flag such as `files` is checked against the entry's type, and the `executable` check tests the path's permission bits. The `empty` check reads the directory or the file length. An entry whose type is none of the known kinds is always dropped, and so is an entry whose type is unknown.

Sources: [src/filetypes.rs:20-42](repo://src/filetypes.rs#L20-L42), [src/filetypes.rs:31](repo://src/filetypes.rs#L31)

## Owner

`--owner` takes `user:group`. `OwnerFilter::from_string` splits the value at the colon, and each side is either a number or a name looked up in the system user or group database. An empty side means no check, and a leading `!` negates the check for that side. A value with more than one colon is rejected.

Sources: [src/filter/owner.rs:5-16](repo://src/filter/owner.rs#L5-L16), [src/filter/owner.rs:27-57](repo://src/filter/owner.rs#L27-L57), [src/filter/owner.rs:85-102](repo://src/filter/owner.rs#L85-L102), [src/cli.rs:469-473](repo://src/cli.rs#L469-L473)

A filter that checks neither side is dropped, so `construct_config` stores `None` and the walk does not test owners at all. Otherwise `matches` compares the entry's uid and gid from its metadata, and an entry without metadata is dropped. The filter exists only on Unix.

Sources: [src/filter/owner.rs:18-22](repo://src/filter/owner.rs#L18-L22), [src/filter/owner.rs:61-74](repo://src/filter/owner.rs#L61-L74), [src/main.rs:268-269](repo://src/main.rs#L268-L269), [src/walk.rs:545-556](repo://src/walk.rs#L545-L556)

## Size

`--size` (`-S`) takes a number with an optional sign and unit. The sign selects `Min` (`+`, the default), `Max` (`-`) or `Equals` (no sign). The unit is a decimal prefix (`k`, `m`, `g`, `t`) or a binary one (`ki`, `mi`, `gi`, `ti`), with an optional `b`. `parse_opt` returns `None` for anything else, and `from_string` turns that into the error "is not a valid size constraint".

Sources: [src/filter/size.rs:8-13](repo://src/filter/size.rs#L8-L13), [src/filter/size.rs:15-66](repo://src/filter/size.rs#L15-L66), [src/cli.rs:412-417](repo://src/cli.rs#L412-L417)

The walk applies size constraints to regular files only. A directory, a link to a missing target, or an entry without metadata is dropped as soon as one size constraint is given, because the test begins with `is_file`. When several `--size` values are given, each must hold: `is_within` is checked for every constraint and one failure drops the entry.

Sources: [src/walk.rs:557-576](repo://src/walk.rs#L557-L576), [src/filter/size.rs:68-74](repo://src/filter/size.rs#L68-L74)

## Modification time

`--changed-within` and `--changed-before` each accept either a span such as `2 weeks` (measured back from now), an RFC 3339 timestamp, a civil date-time in the system time zone, or `@` followed by Unix seconds. `TimeFilter::from_str` tries these in that order, and the first that parses wins. `--changed-within` builds an `After` filter and `--changed-before` builds a `Before` filter.

Sources: [src/filter/time.rs:29-47](repo://src/filter/time.rs#L29-L47), [src/filter/time.rs:49-55](repo://src/filter/time.rs#L49-L55), [src/main.rs:496-519](repo://src/main.rs#L496-L519)

`applies_to` compares the entry's modification time with the limit, strictly. An entry whose metadata or modification time cannot be read is dropped. When both options are given, every time filter must hold, so the entry must be both newer than the first limit and older than the second.

Sources: [src/filter/time.rs:6-10](repo://src/filter/time.rs#L6-L10), [src/filter/time.rs:57-62](repo://src/filter/time.rs#L57-L62), [src/walk.rs:577-592](repo://src/walk.rs#L577-L592)
