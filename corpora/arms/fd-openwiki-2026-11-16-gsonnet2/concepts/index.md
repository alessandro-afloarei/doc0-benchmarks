# Files

- [Entry Filters: Type, Extension, Size, Time, Owner](entry-filters.md) - Semantics, parsing and evaluation order of fd's post-name-match filters - file type, extension, size, modification time and (Unix) owner - including lazy metadata loading and platform gating.
- [Ignore Rules, Hidden Files and Traversal Control](ignore-rules-and-hidden-files.md) - How fd's visibility and traversal flags - hidden files, .gitignore/.fdignore/global/custom ignore files, --exclude, --ignore-contain, --prune, depth limits, symlink following and one-file-system - map onto the ignore crate's WalkBuilder and its precedence rules.
