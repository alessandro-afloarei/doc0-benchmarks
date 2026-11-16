---
type: concept
title: Pattern matching and metadata filters
description: Regex, glob and literal matching semantics, filename versus full-path searches, and the ordered metadata filter pipeline.
tags: [patterns, regex, filters, metadata]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:13:39.635Z
sources:
  - id: openwiki-source-f5ea23b51c582bb354c81514
    resource: repo://src/filesystem.rs
  - id: openwiki-source-c7455adc83d664149895de1b
    resource: repo://src/filter/owner.rs
  - id: openwiki-source-a0933a10afe9624b44e21d5f
    resource: repo://src/filter/size.rs
  - id: openwiki-source-0d5ea0012fa8783c7eda55f2
    resource: repo://src/filter/time.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "codex", at: "2026-11-16T17:13:39.635Z" }
---

# Pattern matching and metadata filters

An entry must first survive [traversal and ignore policy](../architecture/traversal-and-ignores.md), then match every search pattern and every enabled filter family. fd searches entry names or paths; it does not inspect file contents.

## Pattern language and case

| Mode | Transformation | Example |
| --- | --- | --- |
| Default regex | Compile the supplied regex directly | `fd '^test_.*\.rs$'` |
| `--glob`, `-g` | Convert a glob through `GlobBuilder` with literal path separators | `fd -g '*.rs'` |
| `--fixed-strings`, `-F` | Escape regex syntax, retaining substring matching | `fd -F 'a.foo'` |
| `--exact` | Escape regex syntax and anchor both ends | `fd --exact 'a.foo'` |

The empty pattern is a match-all expression, including with glob mode. `--and` contributes additional required patterns, transformed through the same mode as the positional pattern. The walker applies `.all(...)`, so these are conjunctions, not alternatives. See [pattern conversion](../../src/main.rs#L218-L232), [startup](../../src/main.rs#L94-L116), and [matching](../../src/walk.rs#L514-L524).

Smart case examines the parsed regex structure for uppercase literals or class endpoints. Any pattern that triggers smart case makes the search case-sensitive unless `--ignore-case` is set. `--case-sensitive` explicitly requests sensitivity. Regex syntax such as `\A` does not itself count as an uppercase literal. The compiled regexes are byte regexes with dot matching newlines. See [case resolution](../../src/main.rs#L248-L255), [regex helper](../../src/regex_helper.rs#L4-L37), and [compilation](../../src/main.rs#L541-L554).

## What text is matched

By default only the final filename component is matched. `--full-path` matches an absolute path assembled from the cached working directory and the entry path, stripping a leading `./`; this is distinct from `--absolute-path`, which affects result paths by normalizing search roots. See [search_str_for_entry](../../src/walk.rs#L656-L677).

Without `--full-path`, fd rejects `/` in the positional pattern or any `--and` pattern. On Windows, a backslash-containing pattern is additionally rejected when it names an existing directory; arbitrary backslashes remain available for regex escapes. The diagnostic suggests `fd . DIRECTORY` for searching inside a directory and `fd --full-path PATTERN` for matching paths. On Unix, a separate conservative check rejects recognized leading-dot-only patterns while hidden filtering is active; it does not recognize every possible hidden-only regex. See [validation](../../src/main.rs#L160-L215) and [leading-dot detection](../../src/regex_helper.rs#L39-L78).

Unix matching obtains raw bytes from `OsStr`; Windows matching uses a lossy string conversion. This platform boundary matters when extending support for unusual filenames. See [filesystem conversion](../../src/filesystem.rs#L102-L115) and [output byte behavior](../workflows/output-and-pipelines.md).

## Filter combinations and costs

The worker checks minimum depth, all name patterns, extensions, file types, Unix ownership, size and modification time in that order. Name and extension checks come before metadata-dependent work. Metadata is cached on the entry; failure to obtain required metadata rejects that entry. See [filter pipeline](../../src/walk.rs#L508-L591).

Repeated `-e` extensions form alternatives in a case-insensitive regex set. Leading dots are stripped from supplied extensions, the suffix is escaped, and matching requires a character before the extension dot. Repeated basic `-t` types enable alternatives, while executable and empty flags add restrictions. Executable selection also enables files; empty selection alone enables files and directories. Empty directories are checked using `read_dir`, while empty files require zero-length metadata. See [filter construction](../../src/main.rs#L333-L373), [filetypes.rs](../../src/filetypes.rs#L20-L42), and [emptiness](../../src/filesystem.rs#L44-L59).

Size constraints apply only to paths that are files, and every supplied constraint must pass. `+10k` means at least 10,000 bytes, `-10ki` means at most 10,240 bytes, and `10b` means exactly ten bytes. Bounds are inclusive; decimal and binary units differ. See [size parsing and comparison](../../src/filter/size.rs#L27-L74).

`--changed-within` creates an after constraint; `--changed-before` creates a before constraint. Time comparisons are strict. Parsing tries a relative span, a timestamp, a civil date/time interpreted in the system timezone, then `@` followed by Unix seconds. Ambiguous civil times choose the later interpretation. Invalid time input fails setup. See [time.rs](../../src/filter/time.rs#L28-L62) and [constraint extraction](../../src/main.rs#L496-L519).

Unix `--owner` accepts user and group names or numeric IDs in `user:group` form. Either side may be omitted or prefixed with `!` to negate that check. Both supplied checks must pass; empty/no-op ownership constraints are removed during configuration. See [owner.rs](../../src/filter/owner.rs#L24-L102).

## Verification and extension

For a new predicate, place parsing in the CLI or filter module, resolve it into `Config`, and add the predicate at the appropriate cost point in `spawn_senders`. Keep traversal pruning separate from result rejection.

Focused tests include `test_and_*`, `test_smart_case`, `test_full_path`, `test_exact_literal_nonsubstring`, `test_size`, `test_modified_relative`, and `test_owner_*`. The exact-match regression verifies literal punctuation, rejection of substrings, and case overrides in [tests/tests.rs](../../tests/tests.rs#L2230-L2264). Filter modules contain parser and boundary unit tests; time tests use an injectable reference time.

Related: [search pipeline](../architecture/search-pipeline.md), [ignore rules](../architecture/traversal-and-ignores.md), [output formatting](../workflows/output-and-pipelines.md).
