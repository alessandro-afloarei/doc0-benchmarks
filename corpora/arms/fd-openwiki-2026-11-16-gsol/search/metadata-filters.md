---
type: search-semantics
title: File types and metadata filters
description: How fd combines extension, type, executable, empty, size, modification-time, and Unix ownership constraints while avoiding unnecessary metadata reads.
tags: [search, filtering, metadata, filesystem]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:51.346Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-f5ea23b51c582bb354c81514
    resource: repo://src/filesystem.rs
  - id: openwiki-source-8b3eaed746bb796650559c48
    resource: repo://src/filetypes.rs
  - id: openwiki-source-c7455adc83d664149895de1b
    resource: repo://src/filter/owner.rs
  - id: openwiki-source-a0933a10afe9624b44e21d5f
    resource: repo://src/filter/size.rs
  - id: openwiki-source-0d5ea0012fa8783c7eda55f2
    resource: repo://src/filter/time.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "codex", at: "2026-11-16T06:05:51.346Z" }
---

# File types and metadata filters

The walker applies result filters after deciding which directories to visit. A filename mismatch does not stop descent into a directory. Except for explicit pruning and traversal rules, excluding a directory from the result set still permits matches inside it. See [traversal and ignores](traversal-and-ignores.md) for the rules that actually remove subtrees.

## Filter order and composition

The worker first checks minimum depth, then requires every [search pattern](patterns-and-paths.md) to match. It next evaluates extension, type, Unix ownership, size, and modification-time constraints, in that order. Cheap name checks happen before metadata-dependent checks. Any failing filter rejects that result; different filter categories therefore intersect.

Within categories, composition differs:

| Filter | Multiple selections mean |
| --- | --- |
| `--extension` | Match any requested extension |
| Basic `--type` selections | Allow any selected basic kind |
| `--type executable`, `--type empty` | Apply additional predicates to allowed kinds |
| Repeated `--size` | Satisfy every size constraint |
| `--changed-within` and `--changed-before` together | Satisfy both modification-time bounds |
| Owner user and group | Satisfy both supplied fields |

For example, `fd -t f -e rs -e toml -S +1k` searches for regular files with either suffix and a size of at least 1,000 bytes. The primary name pattern can be omitted when all names should qualify.

## Extensions and entry types

`construct_config` strips leading dots from extension arguments, escapes their text, and builds one case-insensitive regex set. Extension matching uses the basename, regardless of `--full-path`, and is independent of the main pattern's case policy. Multiple-part suffixes such as `tar.gz` are supported. A suffix must have a character before its separating dot, so a bare dotfile `.gitignore` is not treated like `name.gitignore`.

Extensions do not imply regular files: a directory whose name has a matching suffix can pass. Add `-t f` when the downstream workflow expects files.

Basic kinds are regular file, directory, symlink, socket, pipe, block device, and character device. `-t x` enables regular files and adds an executable-access predicate through `faccess::PathExt`; it is not just a name-extension test. If combined with directory selection, directories must also pass that predicate. `-t e` adds an emptiness predicate; when neither files nor directories is selected, configuration enables both.

Empty regular files have metadata length zero. Empty directories have no entry from `fs::read_dir`, so contents excluded by ignore rules still make a directory nonempty. An unreadable directory is not accepted as empty. Special-kind helpers use Unix/Redox file type extensions where configured and return false on Windows.

## Size bounds

`-S`/`--size` requires an integer and unit, with an optional sign:

- `+1k`: at least 1,000 bytes, including the boundary.
- `-1ki`: at most 1,024 bytes, including the boundary.
- `512b`: exactly 512 bytes.
- `-S +1k -S -1m`: both constraints, forming an inclusive range.

Units are case-insensitive: `b`, decimal `k/m/g/t`, and binary `ki/mi/gi/ti`; the non-byte units also accept a trailing `b`. Bare numbers and fractional quantities do not match the parser grammar. Invalid syntax is rejected during CLI parsing.

With any size constraint active, the worker requires `entry.path().is_file()` and readable entry metadata. Directories cannot pass merely because their filesystem metadata has a length. Link following and the walker's entry representation affect metadata semantics, so use explicit type/follow settings when those distinctions matter.

## Modification time

`--changed-within` creates an `After` constraint and `--changed-before` creates a `Before` constraint. Both compare the entry's modification time, with strict `>` and `<` respectively; these bounds differ from inclusive size bounds.

The parser tries a Jiff duration/span relative to the current time, then a timestamp with timezone, then a civil datetime interpreted in the system timezone, and finally nonnegative Unix seconds prefixed with `@`. Ambiguous local datetimes resolve through Jiff's `later()` policy. Examples include `15min`, `2018-03-15T12:00:00Z`, `2018-03-15 12:00:00`, and `@1521115200`. Invalid constraints fail configuration construction before traversal. Missing metadata or an unavailable modification timestamp rejects the candidate.

## Unix ownership

`-o`/`--owner` is compiled only on Unix. Its `user:group` syntax permits numeric IDs or resolved account names, omitted fields, and an independent `!` negation on either field. Thus `:staff` filters only the group, while `'!root:'` excludes a user and ignores the group. Unknown names and extra colons are parse errors. An empty string or `:` becomes a no-op and is removed from runtime configuration.

## Metadata lifetime and failures

`DirEntry` lazily caches both metadata and color style. Metadata lookup stores `Option<Metadata>` in a `OnceCell`, so failed lookup is cached too. Normal entries obtain metadata from the `ignore` entry; recovered broken symlinks use `symlink_metadata` and have no known depth. When an active owner, size, or time filter needs metadata that is unavailable, the candidate is rejected. These filter-time failures are not separately emitted as walker errors by this code.

To extend filtering, parse and normalize the option in the CLI/configuration layer, place its predicate at the appropriate cost point in the worker, and decide explicitly what missing metadata means. Reuse `DirEntry::metadata` where appropriate rather than issuing redundant lookups.

Regression anchors in `tests/tests.rs` include `test_extension`, `test_type`, `test_type_executable`, `test_type_empty`, `test_size`, `test_modified_relative`, `test_modified_absolute`, and `test_owner_*`. Parser unit tests in `src/filter/` cover accepted syntax and comparison boundaries; the time tests can pin the reference clock.
