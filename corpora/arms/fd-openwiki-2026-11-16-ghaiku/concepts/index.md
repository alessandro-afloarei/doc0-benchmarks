# Files

- [Exit Codes and Error Reporting](exit-codes-and-errors.md) - What exit status fd reports for success, no matches under --quiet, command failures, usage errors, and Ctrl-C, how those codes are merged across --exec jobs, and how errors and filesystem warnings are written to stderr, including the terminal sanitization applied to messages.
- [Pattern Matching Modes](pattern-matching.md) - How fd interprets its search patterns as regular expressions by default, or as glob, exact, or fixed-string patterns, and how smart case, the --and conjunction, --full-path matching, and the path-separator and leading-dot guards affect which entries match.
- [Platform-Specific Behavior](platform-support.md) - Where fd's behavior, features, and dependencies differ between Unix-like systems, Windows, macOS, and other targets, including gated flags such as --owner, file-type detection, the ls command used by --list-details, path separators, hyperlink hosts, and the optional jemalloc allocator.
