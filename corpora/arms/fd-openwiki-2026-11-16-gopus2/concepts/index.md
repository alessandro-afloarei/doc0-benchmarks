# Files

- [Exit Codes and Error Handling](exit-codes-and-errors.md) - Meaning of fd's process exit codes (0, 1, 130), how --quiet maps results to exit status, how exit codes from parallel commands are merged, how SIGINT is re-raised, and how errors are reported to stderr.
- [Filtering and Ignore Rules](filtering-and-ignore-rules.md) - Which filesystem entries fd visits and reports - hidden-file handling, .gitignore/.fdignore/global/custom ignore files, exclude globs, --ignore-contain, and the ordered per-entry filter chain for depth, pattern, extension, type, owner, size and modification time.
