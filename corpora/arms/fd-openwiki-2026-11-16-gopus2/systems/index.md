# Files

- [Command Execution (--exec / --exec-batch)](command-execution.md) - How fd runs external commands for search results - command template parsing and placeholders, parallel one-by-one execution with per-entry output buffering, batch execution split by argument-size limits and --batch-size, the --list-details ls command, and exit status merging.
- [Output Rendering](output-rendering.md) - How fd writes each search result - the format-template, LS_COLORS-colorized and uncolorized printing paths, placeholder templates, custom path separators, trailing directory separators, null separators, OSC 8 hyperlinks, terminal escape sanitization, raw-byte output for pipes, and ./ prefix stripping.
