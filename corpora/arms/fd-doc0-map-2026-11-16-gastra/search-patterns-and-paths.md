---
title: "Search Patterns and Paths"
---
## Overview

Search setup turns command-line arguments into roots, compiled patterns, and a shared `Config`. The commands in [[Quickstart]] enter through `run`, which resolves the working directory before building patterns and calling the scanner. This page follows that setup through the actual bytes matched for each entry; ignore policies belong to [[Directory Traversal and Ignore Rules]], and the predicates applied after a name match belong to [[File Filters]].

Sources: [src/main.rs:75-112](repo://src/main.rs#L75-L112), [src/walk.rs:347-365](repo://src/walk.rs#L347-L365), [src/walk.rs:514-591](repo://src/walk.rs#L514-L591)

## Working directory and search roots

`set_working_dir` validates `--base-directory` and changes the process's current directory. Only then does `Opts::search_paths` select positional roots, roots supplied with `--search-path`, or the default `./`. The two explicit root forms conflict at argument parsing. Consequently, a relative root and the base used for full-path matching both reflect the requested working directory.

Sources: [src/main.rs:83-84](repo://src/main.rs#L83-L84), [src/main.rs:131-146](repo://src/main.rs#L131-L146), [src/main.rs:301-308](repo://src/main.rs#L301-L308), [src/cli.rs:661-672](repo://src/cli.rs#L661-L672), [src/cli.rs:696-721](repo://src/cli.rs#L696-L721)

Each explicit root must be an existing directory. Invalid roots produce an error message and are filtered out; remaining valid roots can still be searched. An empty result fails with “No valid search paths given.” For the implicit current directory, the existence helper additionally checks normalization for paths without a filename, because the code comments identify a deleted working directory as a case where a simpler existence test is insufficient.

Sources: [src/cli.rs:696-721](repo://src/cli.rs#L696-L721), [src/main.rs:83-87](repo://src/main.rs#L83-L87), [src/filesystem.rs:38-42](repo://src/filesystem.rs#L38-L42), [src/cli.rs:963-970](repo://src/cli.rs#L963-L970)

Root normalization depends on output options. With `--absolute-path`, the root is normalized and made absolute. Otherwise a root of `.` becomes `./` for compatibility with the underlying walker, and a root of `-` is prefixed with `.` so the walker treats it as a path. Other roots keep their supplied form. This is separate from choosing whether patterns inspect the full path.

Sources: [src/cli.rs:723-735](repo://src/cli.rs#L723-L735), [src/cli.rs:213-225](repo://src/cli.rs#L213-L225), [src/cli.rs:255-264](repo://src/cli.rs#L255-L264), [src/filesystem.rs:14-35](repo://src/filesystem.rs#L14-L35)

## Pattern modes

The primary pattern defaults to an empty string. Additional `--and` expressions join it in the same compilation path, and each expression receives the selected pattern mode. The scanner later uses `all` over the compiled patterns, so adding an expression narrows the results rather than adding an alternative. An omitted primary pattern is compatible with supplying only additional expressions.

Sources: [src/cli.rs:200-211](repo://src/cli.rs#L200-L211), [src/cli.rs:628-639](repo://src/cli.rs#L628-L639), [src/main.rs:89-109](repo://src/main.rs#L89-L109), [src/walk.rs:517-524](repo://src/walk.rs#L517-L524)

| Mode | Transformation before compilation | Matching intent |
| --- | --- | --- |
| Default regex | Preserve the input expression | Regular-expression matching |
| `--glob` | Convert a nonempty glob using `literal_separator(true)` | Glob pattern matching |
| `--fixed-strings` | Escape regex syntax | Literal substring matching |
| `--exact` | Escape regex syntax and surround with start/end anchors | Entire filename or full path |

Sources: [src/main.rs:218-231](repo://src/main.rs#L218-L231), [src/cli.rs:153-198](repo://src/cli.rs#L153-L198)

Exact matching conflicts with both glob and fixed-string modes, and glob conflicts with fixed strings. `--regex` overrides glob mode. A pattern beginning with a dash needs the argument separator before it, as in the CLI's documented `fd -- '-foo'` form. These are parser-level choices, before the scanner sees an entry.

Sources: [src/cli.rs:153-198](repo://src/cli.rs#L153-L198), [src/cli.rs:628-639](repo://src/cli.rs#L628-L639)

## Smart case and regex compilation

`construct_config` makes the search case-sensitive when `--case-sensitive` is set or any transformed pattern contains an uppercase character, unless `--ignore-case` is set. The helper parses regex syntax and examines literals and character-class ranges recursively. It does not simply scan the source string for uppercase letters: its tests explicitly show that the anchor in `\Acargo` does not trigger smart case.

Sources: [src/main.rs:248-255](repo://src/main.rs#L248-L255), [src/regex_helper.rs:4-37](repo://src/regex_helper.rs#L4-L37), [src/regex_helper.rs:81-96](repo://src/regex_helper.rs#L81-L96)

`build_regex` creates a byte regex with the chosen case behavior and enables dot matching across newline characters. Compilation errors include suggestions for fixed-string, exact, and glob matching. Uppercase detection returning false after a syntax parse failure does not accept an invalid regex: the later regex compilation still returns its error.

Sources: [src/main.rs:541-554](repo://src/main.rs#L541-L554), [src/regex_helper.rs:5-12](repo://src/regex_helper.rs#L5-L12)

## Filename and full-path matching

Without `--full-path`, `search_str_for_entry` returns only the final filename component. With it, an already absolute entry path is used directly; a relative path has a leading `.` stripped and is joined to the captured current directory. Matching therefore uses an absolute path even when ordinary displayed results remain relative. `--absolute-path` controls roots and output paths; it does not by itself select full-path pattern matching.

Sources: [src/walk.rs:656-677](repo://src/walk.rs#L656-L677), [src/main.rs:301-308](repo://src/main.rs#L301-L308), [src/cli.rs:723-735](repo://src/cli.rs#L723-L735)

The selected OS string becomes bytes before each regex is tested. Unix and Redox borrow its underlying bytes. Windows uses a lossy string conversion and returns owned bytes only when conversion needs an allocation. These matching conversions are distinct from the rendering decisions in [[Output and Formatting]], which can add formatting and terminal escaping after a match is accepted.

Sources: [src/walk.rs:514-524](repo://src/walk.rs#L514-L524), [src/filesystem.rs:102-115](repo://src/filesystem.rs#L102-L115), [src/output.rs:17-42](repo://src/output.rs#L17-L42), [src/output.rs:69-85](repo://src/output.rs#L69-L85)

## Diagnostics before traversal

Unless full-path matching is enabled, every primary and additional pattern is checked for a path separator. A slash always triggers the diagnostic because it cannot occur inside the matched filename and has no regex meaning. On Windows, a native backslash triggers it only when the pattern also names an existing directory; the extra check preserves regex escapes such as `\d+`. The diagnostic suggests either supplying a match-all pattern followed by the directory or enabling full-path matching.

Sources: [src/main.rs:149-215](repo://src/main.rs#L149-L215)

On Unix, another check rejects patterns recognized as matching only names with a leading dot when hidden entries are excluded. The helper intentionally recognizes a limited syntax: a start anchor followed by a literal dot. Its comments explicitly say that more complicated alternatives can evade detection. This is a helpful diagnostic, not proof that every pattern targeting hidden entries will receive a warning; traversal visibility still follows [[Directory Traversal and Ignore Rules]].

Sources: [src/main.rs:521-538](repo://src/main.rs#L521-L538), [src/regex_helper.rs:39-78](repo://src/regex_helper.rs#L39-L78), [src/main.rs:310-320](repo://src/main.rs#L310-L320)
