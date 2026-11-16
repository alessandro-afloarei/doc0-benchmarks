---
title: "Search Patterns and Roots"
---
## Overview

A search definition combines roots, matching syntax, and a choice of name or full-path matching. `run` resolves these before starting filesystem traversal: it parses `Opts`, changes the working directory if requested, validates roots and patterns, creates `Config`, and compiles byte-oriented regular expressions. This page follows that preparation; [[Traversal and Filtering]] covers the gates applied after candidates are discovered.

Sources: [src/main.rs:75-111](repo://src/main.rs#L75-L111), [src/main.rs:541-554](repo://src/main.rs#L541-L554), [src/walk.rs:514-591](repo://src/walk.rs#L514-L591)

## Working directory and roots

`--base-directory` changes the process working directory before roots are resolved. `set_working_dir` first checks that its argument is a directory, then calls `set_current_dir`; either failure becomes a startup error. Relative search paths consequently resolve from the selected base directory. The existence helper checks both directory status and, for paths without a filename component, normalization, because the code explicitly accounts for a deleted current directory.

Sources: [src/main.rs:83-87](repo://src/main.rs#L83-L87), [src/main.rs:131-147](repo://src/main.rs#L131-L147), [src/filesystem.rs:38-42](repo://src/filesystem.rs#L38-L42)

The positional syntax places the optional pattern before optional root directories. Repeated `--search-path` arguments offer an alternative that conflicts with positional roots. With neither form present, `Opts::search_paths` validates and returns `./`. With explicit roots, it reports and drops each non-directory; valid roots remain usable. Only an empty final root list triggers `No valid search paths given` in `run`.

Sources: [src/cli.rs:630-672](repo://src/cli.rs#L630-L672), [src/cli.rs:696-720](repo://src/cli.rs#L696-L720), [src/main.rs:83-87](repo://src/main.rs#L83-L87)

Root normalization supports output and walker requirements. `--absolute-path` normalizes roots and converts them to absolute paths. Without that option, a root of `.` becomes `./` as a walker compatibility workaround, and a root of `-` gains a current-directory prefix so the walker treats it as a path. Other roots retain the supplied path representation. These root transformations are distinct from the final prefix and separator rendering described in [[Output and Formatting]].

Sources: [src/cli.rs:723-735](repo://src/cli.rs#L723-L735), [src/filesystem.rs:14-35](repo://src/filesystem.rs#L14-L35), [src/output.rs:142-180](repo://src/output.rs#L142-L180)

## Pattern modes

Each supplied pattern passes through `build_pattern_regex`. An omitted positional pattern is the empty string. Additional `--and` expressions join the primary pattern, and the same mode applies to all of them. Glob translation occurs for a nonempty glob pattern; exact mode escapes and anchors the string; fixed-string mode escapes without anchors; default regex mode keeps the input expression.

Sources: [src/cli.rs:200-211](repo://src/cli.rs#L200-L211), [src/cli.rs:630-639](repo://src/cli.rs#L630-L639), [src/main.rs:89-100](repo://src/main.rs#L89-L100), [src/main.rs:218-231](repo://src/main.rs#L218-L231)

| Mode | Option | Translation and effect |
| --- | --- | --- |
| Regular expression | Default, or `--regex` to override glob mode | Keeps the expression as supplied; anchoring depends on the expression |
| Glob | `-g`, `--glob` | Uses `GlobBuilder` with literal separators and takes its regex representation |
| Literal substring | `-F`, `--fixed-strings`, `--literal` | Escapes regex syntax while leaving substring matching possible |
| Exact literal | `--exact` | Escapes the pattern and surrounds it with start and end anchors |

Sources: [src/cli.rs:153-198](repo://src/cli.rs#L153-L198), [src/main.rs:218-231](repo://src/main.rs#L218-L231)

Clap rejects glob mode combined with fixed-string mode, and exact mode combined with either glob or fixed-string mode. `--regex` is an override for `--glob`, not a separate compilation engine. After translation, `build_regex` sets case behavior and enables dot to match newlines. A compilation failure includes suggestions to use fixed strings, exact matching, or globs if regex syntax was unintended.

Sources: [src/cli.rs:153-198](repo://src/cli.rs#L153-L198), [src/main.rs:541-554](repo://src/main.rs#L541-L554)

## Smart case across expressions

Case sensitivity is selected once for the complete search. Unless `--ignore-case` is active, explicit `--case-sensitive` or an uppercase character detected in any translated pattern enables case-sensitive matching. As a result, adding an uppercase `--and` expression can affect the primary expression too. `-i` and `-s` override one another at argument parsing time.

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255), [src/cli.rs:130-151](repo://src/cli.rs#L130-L151)

The uppercase detector parses regex syntax rather than scanning the raw source string. It examines literals and character-class endpoints, then recursively visits captures, repetitions, concatenations, and alternatives. The tests show that `foo.[a-zA-Z]` counts as uppercase while the uppercase letter in the regex anchor `\Acargo` does not. A syntax parse failure returns false here; final regex compilation still performs its own validation.

Sources: [src/regex_helper.rs:4-37](repo://src/regex_helper.rs#L4-L37), [src/regex_helper.rs:81-96](repo://src/regex_helper.rs#L81-L96), [src/main.rs:541-554](repo://src/main.rs#L541-L554)

## What each expression matches

Without `--full-path`, `search_str_for_entry` selects only the entry's filename component. With `--full-path`, configuration stores the current directory as a base. Absolute entry paths are used directly; relative paths have a leading `.` component removed before joining that base. Thus full-path mode matches an absolute path even if the displayed result remains relative. `--absolute-path` controls root representation, while `--full-path` controls the matching subject.

Sources: [src/main.rs:301-308](repo://src/main.rs#L301-L308), [src/walk.rs:656-677](repo://src/walk.rs#L656-L677), [src/cli.rs:723-735](repo://src/cli.rs#L723-L735)

The walker requires every compiled expression to match the same subject. It converts that subject to bytes before testing: Unix and Redox use the underlying OS-string bytes, while Windows converts through a lossy string representation. The matching stage does not read file contents; accepted names continue to extension, type, and metadata filters in [[Traversal and Filtering]].

Sources: [src/walk.rs:514-541](repo://src/walk.rs#L514-L541), [src/filesystem.rs:102-115](repo://src/filesystem.rs#L102-L115)

## Diagnostics before walking

Without full-path mode, fd checks the primary pattern and every `--and` expression for path mistakes. A slash is always rejected because filename-only matching cannot match a separator. On Windows, a native backslash triggers this diagnostic only if the pattern also identifies an existing directory: backslashes otherwise remain available for regex escapes. The error suggests either a match-all pattern followed by the directory root, or `--full-path` when the path itself is the intended subject.

Sources: [src/main.rs:149-215](repo://src/main.rs#L149-L215)

On Unix, a second check rejects patterns recognized as matching only a leading-dot name while hidden entries remain disabled. This runs after configuration construction and before final regex compilation. The detector explicitly covers simple start-anchor-plus-literal-dot patterns, rather than proving the property for every possible expression. Its absence does not mean a more complex hidden-only expression can bypass hidden-file filtering.

Sources: [src/main.rs:102-109](repo://src/main.rs#L102-L109), [src/main.rs:521-538](repo://src/main.rs#L521-L538), [src/regex_helper.rs:39-78](repo://src/regex_helper.rs#L39-L78)
