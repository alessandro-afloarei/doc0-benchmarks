---
title: "Directory Entries"
---
## Overview

A `DirEntry` is the one value that moves from the walk to the printer and the runner. It wraps either a normal entry from the `ignore` walker or the path of a broken symbolic link, and it fetches metadata and colour styles only when a stage asks for them. The helpers in `filesystem.rs` that the walk, the filters and the printer call sit beside it.

Sources: [src/dir_entry.rs:12-24](repo://src/dir_entry.rs#L12-L24), [src/filesystem.rs:1-12](repo://src/filesystem.rs#L1-L12)

## Two kinds of entry

`DirEntryInner` has two variants. `Normal` holds the walker's own entry, and `BrokenSymlink` holds only a path. The walk builds the second variant when the walker reports a `NotFound` error on a link that is still present, so a dangling link is listed rather than dropped.

Sources: [src/dir_entry.rs:12-16](repo://src/dir_entry.rs#L12-L16), [src/dir_entry.rs:26-40](repo://src/dir_entry.rs#L26-L40), [src/walk.rs:483-493](repo://src/walk.rs#L483-L493)

Both variants answer `path` the same way, and `into_path` gives the owned path. Equality and ordering also use only the path, so the receiver can sort its buffer of entries with the plain `Ord` implementation.

Sources: [src/dir_entry.rs:42-56](repo://src/dir_entry.rs#L42-L56), [src/dir_entry.rs:116-137](repo://src/dir_entry.rs#L116-L137)

## Presented paths

`stripped_path` returns the path as the user sees it. When `strip_cwd_prefix` is set, it removes a leading `./`, which `strip_current_dir` does. The one exception is a result that would start with `-`: the `./` is kept, so that a later program does not read the name as an option.

Sources: [src/dir_entry.rs:58-72](repo://src/dir_entry.rs#L58-L72), [src/filesystem.rs:118-121](repo://src/filesystem.rs#L118-L121), [src/dir_entry.rs:110-113](repo://src/dir_entry.rs#L110-L113)

`into_stripped_path` is the owned form that the batch runner collects, and it calls `stripped_path` only when stripping is on; otherwise it returns `into_path`.

Sources: [src/dir_entry.rs:74-80](repo://src/dir_entry.rs#L74-L80), [src/exec/job.rs:46-54](repo://src/exec/job.rs#L46-L54)

## Metadata and file type

`metadata` is computed at most once per entry, with a `OnceCell`. A normal entry reads the walker's metadata, and a broken symbolic link reads `symlink_metadata`, so the link itself is described rather than its missing target. The first call fetches it, and later calls return the cached value, including a cached failure.

Sources: [src/dir_entry.rs:82-96](repo://src/dir_entry.rs#L82-L96)

`file_type` takes the type the walker already has for a normal entry and reads metadata only for a broken link. This keeps the file-type filter free of a `stat` call on ordinary entries.

Sources: [src/dir_entry.rs:82-87](repo://src/dir_entry.rs#L82-L87)

`depth` is the walker's depth for a normal entry and `None` for a broken link, which the minimum-depth check treats as too shallow. `style` looks up the `LS_COLORS` style for the entry once and caches it, so colouring a result never repeats the lookup.

Sources: [src/dir_entry.rs:98-103](repo://src/dir_entry.rs#L98-L103), [src/dir_entry.rs:105-110](repo://src/dir_entry.rs#L105-L110)

## Filesystem helpers

`path_absolute_form` makes a path absolute by joining it to the current directory, after removing a leading `./`. `absolute_path` does the same and, on Windows, strips the `\\?\` prefix that the standard library adds. `--absolute-path` and the hyperlink output both use it.

Sources: [src/filesystem.rs:14-36](repo://src/filesystem.rs#L14-L36)

`is_existing_directory` uses `is_dir` and not `exists`, because `.` exists even after the working directory has been deleted. `is_empty` answers the `empty` file type: an empty directory, or a regular file of zero length.

Sources: [src/filesystem.rs:38-41](repo://src/filesystem.rs#L38-L41), [src/filesystem.rs:44-61](repo://src/filesystem.rs#L44-L61), [src/filetypes.rs:31](repo://src/filetypes.rs#L31)

`osstr_to_bytes` turns a name into the bytes the regexes match. On Unix it borrows the raw bytes. On Windows it converts the name with lossy UTF-8 first, so invalid sequences are replaced before matching.

Sources: [src/filesystem.rs:102-116](repo://src/filesystem.rs#L102-L116)

`default_path_separator` returns `/` on Windows when the `MSYSTEM` variable is set, which is the MSYS and Git Bash environment; otherwise it returns `None` and the platform separator is used.

Sources: [src/filesystem.rs:128-137](repo://src/filesystem.rs#L128-L137)
