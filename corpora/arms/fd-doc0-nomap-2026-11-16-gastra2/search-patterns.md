---
title: "Search Patterns"
---
## Overview

Pattern processing turns the positional expression and any `--and` expressions into byte-oriented regular expressions. Every expression must match the same entry before it can reach the later filters. This extends the first searches in [[Quickstart]]: changing a pattern changes the name predicate, while visibility is controlled by [[Traversal and Ignore Rules]] and metadata by [[File Filters]].

Sources: [src/main.rs:89-111](repo://src/main.rs#L89-L111), [src/walk.rs:514-542](repo://src/walk.rs#L514-L542)

## The argument boundary

The positional pattern defaults to an empty string. Directory roots are separate positional values after it, or repeated `--search-path` options; the two root forms conflict. If a pattern begins with a dash, the CLI documentation uses `--` before the pattern to stop option parsing. Roots are resolved before compilation, after an optional `--base-directory` changes the process working directory.

Sources: [src/cli.rs:628-672](repo://src/cli.rs#L628-L672), [src/main.rs:75-100](repo://src/main.rs#L75-L100), [src/main.rs:131-146](repo://src/main.rs#L131-L146)

`run` chains the additional expressions with the primary pattern and calls `build_pattern_regex` for each. There is one shared mode and case configuration for the resulting collection. It compiles every transformed expression before calling `walk::scan`, so a malformed expression fails setup rather than allowing a partial search with the remaining valid expressions.

Sources: [src/main.rs:90-111](repo://src/main.rs#L90-L111), [src/main.rs:218-255](repo://src/main.rs#L218-L255), [src/main.rs:541-554](repo://src/main.rs#L541-L554)

## Pattern modes

| Mode | Transformation | Match scope |
| --- | --- | --- |
| Default regex | Pass the expression through unchanged | Regex decides whether a substring or anchored match is required |
| `--glob`, `-g` | Convert a nonempty glob with literal separators to a regex | Glob-derived whole-pattern matching |
| `--fixed-strings`, `-F` | Escape regex metacharacters | Literal substring |
| `--exact` | Escape metacharacters and add `^` and `$` | Entire filename, or entire full-path match string |

Sources: [src/main.rs:218-232](repo://src/main.rs#L218-L232), [src/cli.rs:153-198](repo://src/cli.rs#L153-L198)

Glob mode conflicts with fixed-string mode, and exact mode conflicts with both. `--regex` can override glob mode. An empty pattern in glob mode bypasses glob conversion and remains the empty regex; exact mode instead anchors the escaped empty string. Thus the ordinary omitted-pattern behavior should not be generalized to an exact search for an empty name.

Sources: [src/cli.rs:153-198](repo://src/cli.rs#L153-L198), [src/cli.rs:628-639](repo://src/cli.rs#L628-L639), [src/main.rs:218-232](repo://src/main.rs#L218-L232)

The literal modes are useful when punctuation should belong to the filename rather than the regex language. For example, the implementation escapes the supplied text before anchoring an exact match. Regex compilation also enables dot matching across newline characters, so `.` is not restricted to ordinary single-line filename text. These settings are applied consistently to each compiled pattern.

Sources: [src/main.rs:222-230](repo://src/main.rs#L222-L230), [src/main.rs:541-545](repo://src/main.rs#L541-L545)

## Smart case

Configuration enables case sensitivity when `--case-sensitive` is set or any transformed pattern contains an uppercase character, unless `--ignore-case` is active. All patterns then use that shared setting. An uppercase requirement in one `--and` expression can therefore change the matching behavior of the primary expression as well.

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255), [src/main.rs:541-545](repo://src/main.rs#L541-L545)

The uppercase test parses the regex syntax rather than scanning its source spelling. It visits literals, character-class boundaries, captures, repetitions, concatenations and alternatives. The unit tests distinguish a literal uppercase character from regex syntax: `foo.[a-zA-Z]` triggers smart case, whereas `\Acargo` and `carg\x6F` do not. A syntax parse failure returns false here; the subsequent real compiler still reports invalid regex input.

Sources: [src/regex_helper.rs:4-37](repo://src/regex_helper.rs#L4-L37), [src/regex_helper.rs:81-96](repo://src/regex_helper.rs#L81-L96), [src/main.rs:541-554](repo://src/main.rs#L541-L554)

## Choosing the match string

Without `--full-path`, `search_str_for_entry` extracts the basename. With full-path matching, configuration captures the current directory and the helper uses an absolute entry unchanged or joins a relative entry to that directory after stripping its leading `.` component. This matching transformation does not itself request absolute printed results; `--absolute-path` has its own root-normalization branch.

Sources: [src/main.rs:301-308](repo://src/main.rs#L301-L308), [src/walk.rs:656-677](repo://src/walk.rs#L656-L677), [src/cli.rs:723-735](repo://src/cli.rs#L723-L735)

The worker converts the selected `OsStr` into bytes before calling every regex. Unix-like builds borrow the original path bytes; Windows uses a lossy string conversion. After all patterns succeed, extension and type checks begin. The separate formatting stage in [[Output and Formatting]] can replace displayed path separators without redefining this matching string.

Sources: [src/filesystem.rs:102-116](repo://src/filesystem.rs#L102-L116), [src/walk.rs:514-542](repo://src/walk.rs#L514-L542), [src/output.rs:142-155](repo://src/output.rs#L142-L155)

## Diagnostics before traversal

In basename mode, the path diagnostic checks the primary expression and every `--and` expression. Any `/` triggers an error because it cannot occur in a basename. On Windows, a native backslash additionally triggers that diagnostic only if the pattern names an existing directory. The code comments explain the distinction: backslash is also the regex escape character, so rejecting every backslash would incorrectly reject expressions such as `\d+`.

Sources: [src/main.rs:149-215](repo://src/main.rs#L149-L215)

The error suggests two different corrections: use a match-all pattern followed by the directory to search inside it, or enable `--full-path` to match against the path. Full-path mode bypasses this diagnostic entirely. This is a setup failure, not a zero-match search, so it reaches the top-level general-error branch instead of returning ordinary search success.

Sources: [src/main.rs:169-215](repo://src/main.rs#L169-L215), [src/main.rs:62-72](repo://src/main.rs#L62-L72)

On Unix, another setup check rejects detected leading-dot-only patterns while hidden entries are disabled. It suggests `--hidden` or changing the pattern. The detector deliberately recognizes only simple syntax beginning with a start anchor and literal dot; comments explicitly state that more complicated hidden-only expressions may escape detection. Absence of this error therefore does not mean a pattern can match visible entries.

Sources: [src/main.rs:521-539](repo://src/main.rs#L521-L539), [src/regex_helper.rs:39-79](repo://src/regex_helper.rs#L39-L79)

If compilation itself fails, fd includes the regex error and suggests literal substring, exact literal, or glob mode. These are alternatives for expressing the intended name condition; they do not change which directories are traversed. The ignore controls described in [[Traversal and Ignore Rules]] still determine whether an entry reaches the matcher at all.

Sources: [src/main.rs:541-554](repo://src/main.rs#L541-L554), [src/walk.rs:347-369](repo://src/walk.rs#L347-L369)
