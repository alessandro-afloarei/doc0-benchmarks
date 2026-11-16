---
type: search-semantics
title: Pattern matching and path semantics
description: Select regex, glob, literal, or exact matching; understand smart case, required patterns, search roots, full paths, and early path diagnostics.
tags: [search, patterns, regex, paths, cli]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:51.346Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-f5ea23b51c582bb354c81514
    resource: repo://src/filesystem.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
generated: { by: "codex", at: "2026-11-16T06:05:51.346Z" }
---

# Pattern matching and path semantics

The normal invocation is `fd [OPTIONS] [pattern [path]...]`. The first positional argument is a pattern, even when it resembles a directory. The pattern defaults to the empty string and roots default to the current directory. To list descendants of a particular directory, use `fd . src/` or `fd --search-path src/`; `fd src/` occupies the pattern position and triggers a diagnostic.

## Pattern compilation

`main::build_pattern_regex` translates each supplied pattern to a regex string; `build_regex` compiles it with `regex::bytes::RegexBuilder`. Regex is the default mode, and the match is a substring unless the pattern itself anchors it.

| Mode | Example | Interpretation |
| --- | --- | --- |
| Regex, default | `fd '^test_.*\.rs$'` | Regex syntax with explicit name anchors |
| Glob, `-g` | `fd -g 'test_*.rs'` | A glob translated by `globset` with literal path separators |
| Fixed string, `-F` | `fd -F 'report(1)'` | Escaped literal substring |
| Exact, `--exact` | `fd --exact 'report(1).txt'` | Escaped literal with both ends anchored |

`--exact` conflicts with glob and fixed-string options. `--regex` can override glob mode. An empty pattern bypasses glob translation, retaining match-all behavior in glob mode; exact mode instead anchors the empty pattern and requires an empty target string.

All compiled primary patterns have dot-matches-newline enabled. The target bytes are native filename bytes on Unix/Redox and a lossy string encoding on Windows. This allows Unix non-UTF-8 paths to reach the matcher without first decoding the whole filename. Printed byte preservation has separate conditions described in [output and formatting](../output/rendering-and-formatting.md).

## Required patterns and smart case

Repeat `--and` to add required patterns:

```sh
fd foo --and bar --and '\.rs$'
```

The worker requires every compiled pattern to match the same candidate. The patterns need not match at the same position. They all use the invocation's chosen mode and the same matching target. Filters such as [extensions and types](metadata-filters.md) then narrow that result set further.

Smart case is determined once across all translated patterns. An uppercase-bearing pattern makes the shared configuration case-sensitive unless `-i`/`--ignore-case` is active. `-s`/`--case-sensitive` forces sensitive matching; the opposing flags override each other through Clap. Thus an uppercase `--and` pattern can change how the primary pattern is evaluated too.

The uppercase check parses regex structure, examining literals and class ranges rather than simply scanning the original text. The `A` in the regex anchor `\A` does not alone force sensitive matching. Regex helper tests and `test_smart_case` pin this distinction.

## Which string is searched

Without `-p`/`--full-path`, the worker matches only `Path::file_name()`. A matching directory name does not automatically make its descendants match; each entry's own basename is tested.

With `--full-path`, configuration captures the current working directory once. Absolute entry paths are used directly; relative paths have an initial `.` component removed and are joined to that cached directory. Matching therefore uses an absolute path even if displayed results remain relative. In exact mode, the entire absolute path must match the literal pattern. Full-path globs must account for path separators, for example on Unix:

```sh
fd -p -g '**/src/*.rs'
```

`-a`/`--absolute-path` instead normalizes search roots to absolute form so discovered paths are absolute for output/execution. It does not enable full-path matching. `--path-separator` is presentation/template policy and does not replace native separators in the string being searched.

## Root validation and working directory

`--base-directory` validates and changes the process working directory before root resolution. Relative roots, full-path matching, custom relative ignore files, and child commands consequently operate from that directory. An absolute explicit root still identifies its own tree.

Roots may be positional after the pattern or supplied through repeated `--search-path`; those two root forms conflict. Each must identify an existing directory. Invalid roots print errors and are discarded; remaining valid roots are still searched. If none remain, `run` fails with `No valid search paths given.`

Root normalization preserves ordinary relative roots, special-cases `.` as `./` for the walker, and prefixes a root literally named `-` with `./`. Absolute-path mode normalizes roots using `normpath` before making them absolute. The walker does not emit the root entry itself. See [traversal boundaries](traversal-and-ignores.md) for depth and link behavior.

## Diagnostics before traversal

Without full-path mode, both the primary pattern and every `--and` pattern are checked for misplaced path syntax. Any `/` triggers an error, whether or not the text names a real directory. On Windows, a native backslash triggers the same check only when the pattern identifies an existing directory: backslash also serves as regex escape syntax, so expressions such as `\d+` must remain usable. `--full-path` bypasses these checks intentionally.

On Unix, a second diagnostic catches simple anchored-leading-dot patterns while hidden entries are still excluded, suggesting `-H`. It inspects the translated regex, so an exact dotfile glob can trigger it too. This is a limited syntax recognizer, not a proof that every hidden-only expression is detected.

Invalid regex compilation reports the underlying error and suggests fixed-string, exact, or glob matching. Quote patterns in a shell to preserve their syntax. A primary pattern beginning with a dash should follow `--`, as in `fd -- '-draft'`; `--and` values explicitly allow leading hyphens.

## Regression and extension points

The CLI declares modes and conflicts in `src/cli.rs`; translation and shared case policy live in `src/main.rs`; string selection lives in `src/walk.rs`; HIR inspection lives in `src/regex_helper.rs`. A mode change needs to remain coherent across primary and additional patterns, diagnostics, and case selection.

Use `test_and_*`, `test_smart_case`, `test_glob_searches`, `test_fixed_strings`, `test_exact_literal_nonsubstring`, `test_full_path`, `test_multi_file_with_missing`, and `test_base_directory`. The forward-slash regression tests cover nonexistent paths, real paths, additional patterns, and the full-path escape hatch. Unit tests in `src/walk.rs` cover absolute/full-path construction without a traversal.
