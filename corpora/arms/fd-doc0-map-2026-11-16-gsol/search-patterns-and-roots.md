---
title: "Search Patterns and Roots"
---
## Overview

An `fd` invocation becomes a set of search roots, compiled byte regexes, and one `Config`. `run` performs this preparation before calling `walk::scan`: it parses options, changes the working directory, validates roots, converts patterns, constructs configuration, and compiles the matchers. Every supplied pattern must match an entry. [[Ignore Rules and Traversal]] takes over once those roots and matchers reach the walker; [[File Filters]] covers predicates applied after name matching.

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112), [src/walk.rs:514-542](repo://src/walk.rs#L514-L542)

## Invocation and root selection

The first positional argument is the optional pattern, defaulting to an empty string. Remaining positional arguments are root directories. Alternatively, repeat `--search-path` to supply roots while leaving the pattern positional; this form conflicts with positional roots. A pattern beginning with `-` can follow `--`, as the CLI's `fd -- '-foo'` example shows. This distinction matters when a name resembles an option or a directory is being supplied without a restrictive pattern.

Sources: [src/cli.rs:628-672](repo://src/cli.rs#L628-L672)

`--base-directory` changes the process working directory before any search roots are resolved. `set_working_dir` rejects a base that is not a directory, then attaches context if the directory change fails. Relative positional roots and relative `--search-path` values are consequently interpreted under that base. The option also affects the current directory cached for full-path matching, because configuration is constructed after the change.

Sources: [src/cli.rs:613-626](repo://src/cli.rs#L613-L626), [src/main.rs:83-102](repo://src/main.rs#L83-L102), [src/main.rs:131-146](repo://src/main.rs#L131-L146), [src/main.rs:301-308](repo://src/main.rs#L301-L308)

`Opts::search_paths` uses positional roots if present, otherwise named roots, otherwise `./`. Each explicit root is checked with `is_existing_directory`; invalid roots produce a diagnostic and are dropped, so valid roots can still proceed. If none survives, `run` fails with “No valid search paths given.” The implicit current directory gets a separate existence check that reports a potentially deleted working directory.

Sources: [src/cli.rs:696-721](repo://src/cli.rs#L696-L721), [src/cli.rs:963-970](repo://src/cli.rs#L963-L970), [src/filesystem.rs:38-42](repo://src/filesystem.rs#L38-L42), [src/main.rs:83-87](repo://src/main.rs#L83-L87)

Root normalization preserves relative paths by default. `.` becomes `./` as a walker workaround, and a root named `-` is prefixed with the current-directory component so the underlying walker treats it as a path. `--absolute-path` instead normalizes roots into absolute paths; the filesystem helper removes the Windows extended-path prefix from that representation. This output-oriented option is separate from the choice of string used for matching.

Sources: [src/cli.rs:213-225](repo://src/cli.rs#L213-L225), [src/cli.rs:723-735](repo://src/cli.rs#L723-L735), [src/filesystem.rs:14-36](repo://src/filesystem.rs#L14-L36), [src/walk.rs:656-677](repo://src/walk.rs#L656-L677)

## Pattern modes

| Mode | Conversion before regex compilation | Matching scope |
| --- | --- | --- |
| Default regex | Preserve the supplied expression | Whatever the expression matches |
| `--glob` | Build a glob with literal separators and use its regex | Glob semantics; an empty pattern falls through |
| `--fixed-strings` | Escape regex metacharacters | Literal substring |
| `--exact` | Escape the pattern and add start and end anchors | Entire literal filename or full path |

Sources: [src/main.rs:218-231](repo://src/main.rs#L218-L231), [src/cli.rs:153-198](repo://src/cli.rs#L153-L198)

`--and` adds required patterns rather than alternatives. `run` chains the additional patterns with the primary pattern and sends each through the same conversion function. Workers later call `all` over the compiled regexes against one search string. A name that satisfies the primary expression but fails one additional expression is rejected before extension or metadata filtering.

Sources: [src/cli.rs:200-211](repo://src/cli.rs#L200-L211), [src/main.rs:89-109](repo://src/main.rs#L89-L109), [src/walk.rs:514-535](repo://src/walk.rs#L514-L535)

## Smart case and compilation

`construct_config` chooses one case-sensitivity setting for all patterns. `--ignore-case` disables sensitivity; otherwise `--case-sensitive` enables it, as does an uppercase character detected in any converted pattern. Detection parses regex syntax and walks literals, character classes, captures, repetitions, concatenations, and alternations. It therefore examines the expression's parsed content instead of simply looking for an uppercase byte in the raw CLI argument.

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255), [src/regex_helper.rs:4-37](repo://src/regex_helper.rs#L4-L37)

`build_regex` uses `regex::bytes::RegexBuilder`, applies the shared case setting, and enables dot matching across newlines. A compilation error is augmented with suggestions to use literal or glob modes. Search input is converted to bytes using raw OS-string bytes on Unix and Redox; Windows uses the OS string's lossy string representation. These are matching representations, independent of the later terminal rendering path.

Sources: [src/main.rs:541-555](repo://src/main.rs#L541-L555), [src/walk.rs:517-521](repo://src/walk.rs#L517-L521), [src/filesystem.rs:102-116](repo://src/filesystem.rs#L102-L116)

## Filename and full-path matching

By default, `search_str_for_entry` borrows only the entry's filename, including directory names when the entry is a directory. With `--full-path`, configuration caches the current directory. Absolute discovered paths are matched directly; relative ones have a leading current-directory component stripped and are joined to that cached directory. The pattern then sees an absolute path even if printed results remain relative. [[Result Output]] describes the separate display-path choices.

Sources: [src/cli.rs:255-264](repo://src/cli.rs#L255-L264), [src/main.rs:301-308](repo://src/main.rs#L301-L308), [src/walk.rs:656-677](repo://src/walk.rs#L656-L677)

## Early diagnostics

Without `--full-path`, startup checks the primary pattern and every `--and` expression for a path-separator mistake. A forward slash always triggers the diagnostic. On Windows, a native backslash triggers it only when the pattern names an existing directory, since backslash is also a regex escape. The error offers two concrete alternatives: use a match-all pattern with the directory as a root, or enable full-path matching. This prevents a common filename search that could never match its intended path.

Sources: [src/main.rs:149-215](repo://src/main.rs#L149-L215)

On Unix, another check rejects detected patterns that only match leading-dot names while hidden entries remain excluded. The detector handles a simple start anchor followed by a literal dot; its comments explicitly say more complex equivalents are not detected. Enabling hidden search resolves that conflict, but an ignore rule can still exclude the entry. [[Ignore Rules and Traversal]] explains why hidden visibility and ignore-file handling are configured independently.

Sources: [src/main.rs:521-539](repo://src/main.rs#L521-L539), [src/regex_helper.rs:39-78](repo://src/regex_helper.rs#L39-L78), [src/main.rs:310-320](repo://src/main.rs#L310-L320)
