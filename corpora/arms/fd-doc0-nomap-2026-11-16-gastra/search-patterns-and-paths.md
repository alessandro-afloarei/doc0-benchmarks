---
title: "Search Patterns and Paths"
---
## Overview

A search begins by converting command-line options into validated roots, compiled expressions, and a shared `Config`. `run` establishes the working directory before interpreting search roots, translates every expression with the same matching mode, and compiles them before calling the walker. The worker later requires every expression to match the same candidate name or full path. Ignore policy determines which candidates reach that check, as described in [[Traversal and Ignore Rules]].

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112), [src/walk.rs:514-524](repo://src/walk.rs#L514-L524), [src/walk.rs:352-365](repo://src/walk.rs#L352-L365)

## Select the working directory and roots

The positional interface separates a pattern from zero or more root directories. An omitted pattern is the empty string; omitted roots select `./`. Repeated `--search-path` options are an alternative to positional roots and conflict with them. `--base-directory` changes the process working directory first, so both relative roots and subsequent relative results are interpreted from that directory. The base must pass the existing-directory check, and a failed directory change carries a contextual error.

Sources: [src/cli.rs:613-639](repo://src/cli.rs#L613-L639), [src/cli.rs:652-672](repo://src/cli.rs#L652-L672), [src/cli.rs:696-705](repo://src/cli.rs#L696-L705), [src/main.rs:83-84](repo://src/main.rs#L83-L84), [src/main.rs:131-147](repo://src/main.rs#L131-L147)

Each explicit root is checked independently. A non-directory produces a diagnostic and is removed; valid roots remain usable. Only when the resulting list is empty does `run` abort with “No valid search paths given.” The existing-directory helper also checks normalization for paths without a filename component, because a simple existence check can mishandle a deleted current working directory.

Sources: [src/cli.rs:696-720](repo://src/cli.rs#L696-L720), [src/main.rs:83-87](repo://src/main.rs#L83-L87), [src/filesystem.rs:38-42](repo://src/filesystem.rs#L38-L42)

`--absolute-path` normalizes each root and converts it to absolute form. Otherwise a root of `.` becomes `./`, and a root consisting of `-` is prefixed with `.` so the walker treats it as a path. Absolute-path construction removes the Windows extended-path prefix where applicable. These root transformations are separate from display-time prefix stripping and separator replacement, which belong to [[Output and Formatting]].

Sources: [src/cli.rs:723-735](repo://src/cli.rs#L723-L735), [src/filesystem.rs:14-35](repo://src/filesystem.rs#L14-L35), [src/output.rs:147-155](repo://src/output.rs#L147-L155)

## Translate the search language

| Mode | Translation before compilation | Matching scope |
| --- | --- | --- |
| Default regex | Keep the supplied expression | Whatever the regex expresses; no automatic anchors |
| `--glob` / `-g` | Build a glob with literal path separators, then obtain its regex | Glob-derived matching; the empty pattern bypasses glob conversion |
| `--fixed-strings` / `-F` | Escape regex metacharacters | Literal substring |
| `--exact` | Escape metacharacters and surround with `^` and `$` | Entire filename or entire full-path candidate |

Sources: [src/main.rs:218-231](repo://src/main.rs#L218-L231), [src/cli.rs:174-198](repo://src/cli.rs#L174-L198)

`--regex` can override glob mode. Glob mode conflicts with fixed strings, and exact mode conflicts with both glob and fixed strings. Exact matching controls anchoring and escaping; it does not independently force case sensitivity. The same `build_pattern_regex` function translates the primary pattern and every repeated `--and` expression, so adding a second expression does not introduce a separate matching language.

Sources: [src/cli.rs:153-211](repo://src/cli.rs#L153-L211), [src/main.rs:94-109](repo://src/main.rs#L94-L109), [src/main.rs:218-255](repo://src/main.rs#L218-L255)

The compiled expressions form a conjunction. The worker calls `all` over them, rejecting an entry at the first failing expression. Extension selection is a separate predicate after this conjunction, rather than another expression in it; [[Result Filters]] explains why several extensions behave differently from several `--and` patterns.

Sources: [src/walk.rs:517-535](repo://src/walk.rs#L517-L535), [src/main.rs:361-373](repo://src/main.rs#L361-L373)

## Resolve case sensitivity

Configuration enables case sensitivity when `--ignore-case` is absent and either `--case-sensitive` is present or any translated pattern contains an uppercase character according to the regex-syntax helper. A single uppercase-bearing expression therefore affects the common case setting used for all compiled expressions. The case flags override one another at argument parsing, and the resulting setting is passed to each `RegexBuilder`.

Sources: [src/cli.rs:130-151](repo://src/cli.rs#L130-L151), [src/main.rs:248-255](repo://src/main.rs#L248-L255), [src/main.rs:541-545](repo://src/main.rs#L541-L545)

The helper examines parsed regex structure, including literals, character-class range endpoints, captures, repetitions, concatenations, and alternations. It does not merely scan the typed characters for capitals: a test confirms that `\Acargo` does not trigger smart case even though the anchor contains a capital letter. Failed syntax parsing returns false from the helper; actual regex compilation still performs validation later.

Sources: [src/regex_helper.rs:4-37](repo://src/regex_helper.rs#L4-L37), [src/regex_helper.rs:81-96](repo://src/regex_helper.rs#L81-L96), [src/main.rs:541-554](repo://src/main.rs#L541-L554)

## Choose filename or full-path matching

Without `--full-path`, the candidate is the entry's filename. With it, configuration caches the current working directory, and `search_str_for_entry` returns an absolute candidate: already-absolute paths are borrowed unchanged, while relative paths have a leading `.` stripped and are joined to the cached base. Thus a full-path query matches an absolute path even when printed output remains relative. Changing how results are displayed does not substitute a different matching candidate.

Sources: [src/main.rs:301-308](repo://src/main.rs#L301-L308), [src/walk.rs:656-677](repo://src/walk.rs#L656-L677), [src/output.rs:147-154](repo://src/output.rs#L147-L154)

Matching uses byte regular expressions. On Unix and Redox, `osstr_to_bytes` borrows the operating-system string's bytes; on Windows it converts through a potentially lossy string. `RegexBuilder` also enables dot-matches-newline behavior. These are matching-path choices; the distinct output behavior for non-UTF-8 names is documented in [[Output and Formatting]].

Sources: [src/filesystem.rs:102-116](repo://src/filesystem.rs#L102-L116), [src/walk.rs:519-521](repo://src/walk.rs#L519-L521), [src/main.rs:541-545](repo://src/main.rs#L541-L545)

## Understand preparation errors

Before translation, filename-only searches reject path-like patterns in both the primary position and `--and` arguments. A forward slash is always treated as a path separator. On Windows, a backslash triggers this diagnostic only if the pattern also resolves to an existing directory, preserving valid regex escapes. `--full-path` bypasses this check. The error gives two alternatives: search within a root using a match-all pattern, or explicitly match full paths.

Sources: [src/main.rs:169-215](repo://src/main.rs#L169-L215)

```bash
fd . 'src'
fd --full-path 'src'
```

Sources: [src/main.rs:203-210](repo://src/main.rs#L203-L210)

On Unix, a second diagnostic rejects recognized patterns that only match leading-dot names while hidden filtering remains enabled. This check considers every translated expression. Its helper deliberately handles a limited syntax shape—an initial start anchor followed by a literal dot—and comments identify more complex hidden-only expressions it does not detect. Enabling hidden search resolves that specific conflict, but does not by itself disable the ignore rules explained in [[Traversal and Ignore Rules]].

Sources: [src/main.rs:521-538](repo://src/main.rs#L521-L538), [src/regex_helper.rs:39-79](repo://src/regex_helper.rs#L39-L79), [src/main.rs:313-320](repo://src/main.rs#L313-L320)

Invalid glob construction propagates its error during translation. Invalid compiled regexes return a diagnostic with suggestions for fixed strings, exact strings, or glob matching. All of this happens before `walk::scan`, so malformed expressions cannot produce a partial stream of filesystem results; the top-level error handler prints the error chain and exits with general error status.

Sources: [src/main.rs:62-71](repo://src/main.rs#L62-L71), [src/main.rs:94-111](repo://src/main.rs#L94-L111), [src/main.rs:218-221](repo://src/main.rs#L218-L221), [src/main.rs:541-554](repo://src/main.rs#L541-L554)
