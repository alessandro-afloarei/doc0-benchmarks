---
title: "Entry Filters"
---
## Overview

A name that matches the patterns is not yet a result. The sender closure in the walk then applies the filters the options configured: extension, file type, owner, size and modification time. Each filter reads its value from `Config` and rejects the entry by returning `WalkState::Continue`, so a rejected directory is still descended into. Name matching is covered by [[Pattern Matching]]; the walk that supplies the entries is covered by [[Directory Walk]].

Sources: [src/walk.rs:517-592](repo://src/walk.rs#L517-L592)

## Order of checks

The checks run in one fixed order, and the first failure rejects the entry. Extension comes before file type, file type before owner, and owner before size and time. The order matters only for cost: the name-based extension test needs no metadata, while owner, size and time read it.

Sources: [src/walk.rs:526-592](repo://src/walk.rs#L526-L592)

## Extension and file type

`--extension` is compiled into a `RegexSet` in `construct_config`. Each value has its leading dot removed, is escaped, and becomes the pattern `\.<ext>$` matched case-insensitively against the file name, so `-e .rs` and `-e rs` are the same. The set is tested against the name only, so a directory named `foo.rs` passes too.

Sources: [src/main.rs:361-373](repo://src/main.rs#L361-L373), [src/walk.rs:526-535](repo://src/walk.rs#L526-L535)

File types are a `FileTypes` struct of boolean flags, one per kind that `-t` can name. `should_ignore` rejects an entry whose kind has no flag set. Executable is special: it sets `executables_only` and also `files`, and the check asks `faccess` whether the path is executable. Empty is also special: on its own it turns on both `files` and `directories`, and the check treats an empty directory as one with no children and an empty file as one of length zero. An entry whose type cannot be read, or that is none of the recognised kinds, is always rejected.

Sources: [src/filetypes.rs:7-42](repo://src/filetypes.rs#L7-L42), [src/filesystem.rs:44-61](repo://src/filesystem.rs#L44-L61), [src/main.rs:333-359](repo://src/main.rs#L333-L359)

## Owner

`--owner user:group` is parsed by `OwnerFilter::from_string`. Each side is a numeric id or a name looked up in the system user or group database, and an empty side means "any". A leading `!` on a side negates it. The string may contain only one colon, and a name that does not exist is an error before the walk starts. `filter_ignore` drops a filter where both sides are empty, so no metadata is read for it. The check runs only on Unix, and an entry with no metadata is rejected when an owner filter is set.

Sources: [src/filter/owner.rs:27-59](repo://src/filter/owner.rs#L27-L59), [src/filter/owner.rs:61-74](repo://src/filter/owner.rs#L61-L74), [src/filter/owner.rs:84-100](repo://src/filter/owner.rs#L84-L100), [src/walk.rs:546-556](repo://src/walk.rs#L546-L556)

## Size

`--size` accepts a sign, a number and a unit. A leading `+` means at least the size, `-` means at most it, and no sign means exactly that size. The units are byte, kilo, mega, giga and tera, each with its binary `i` form, so `1k` is 1000 bytes and `1ki` is 1024. An invalid value is an error before the walk.

Sources: [src/filter/size.rs:16-23](repo://src/filter/size.rs#L16-L23), [src/filter/size.rs:27-66](repo://src/filter/size.rs#L27-L66), [src/filter/size.rs:68-74](repo://src/filter/size.rs#L68-L74)

Size is checked for regular files only. When any size constraint is set, a directory, a symbolic link to a directory, or any other non-file is rejected before its size is read, so `--size` never returns directories. Every constraint given must hold, because each one is checked in turn.

Sources: [src/walk.rs:557-576](repo://src/walk.rs#L557-L576)

## Modification time

`--changed-within` and `--changed-before` become `TimeFilter` values in `extract_time_constraints`. `TimeFilter::After` holds for times strictly later than its limit and `Before` for strictly earlier. The limit can be a duration counted back from now, a timestamp, a civil date and time in the system zone, or an `@` epoch-seconds value.

Sources: [src/filter/time.rs:28-47](repo://src/filter/time.rs#L28-L47), [src/filter/time.rs:57-63](repo://src/filter/time.rs#L57-L63)

The sender reads the modification time once per entry and requires every constraint to hold for it. An entry whose metadata or modification time cannot be read is rejected whenever a time constraint is present, so `--changed-within 1d --changed-before 1h` selects an entry only when its modification time falls between one day ago and one hour ago.

Sources: [src/walk.rs:578-592](repo://src/walk.rs#L578-L592)
