# Files

- [Command Execution (--exec / --exec-batch)](command-execution.md) - How fd runs external commands for search results — template parsing and placeholders, per-result parallel execution with output buffering, batch execution with argmax-sized argument lists and --batch-size, --list-details as a synthesized ls batch, error handling and exit-code merging.
- [Output, Colors, Formatting, and Hyperlinks](output-formatting.md) - How fd prints each result — ./ prefix stripping, custom path separators, trailing directory separators, LS_COLORS-based coloring, --format templates, --print0, OSC 8 hyperlinks, raw-byte output for pipes, and sanitization of terminal escape sequences in file names and error messages.
