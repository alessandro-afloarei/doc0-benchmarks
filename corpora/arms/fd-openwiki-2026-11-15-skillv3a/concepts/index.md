# Files

- [Entry Filters: Type, Size, Time, Owner](entry-filters.md) - How fd's per-entry filters work — --type (including executable and empty), --size, --changed-within/--changed-before, --owner, depth limits and --prune — including parsing rules, semantics, evaluation order in the walker, and metadata cost.
- [Ignore Rules and Hidden Files](ignore-rules-and-hidden-files.md) - How fd decides which entries are skipped before matching — hidden files, .gitignore/.ignore/.fdignore, the global fd ignore file, --ignore-file, --exclude overrides, the --no-ignore family, -u, --no-require-git, parent ignores and --ignore-contain — and how each maps onto the ignore crate's WalkBuilder.
- [Pattern Matching](pattern-matching.md) - How fd turns search patterns into byte regexes — regex, --glob, --fixed-strings and --exact modes, --and patterns, smart case, filename versus --full-path matching, extension matching, and the diagnostics for path-like and dot-only patterns.
