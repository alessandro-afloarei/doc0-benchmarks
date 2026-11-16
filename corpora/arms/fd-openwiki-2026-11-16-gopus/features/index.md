# Files

- [Command Execution: --exec, --exec-batch, and --list-details](command-execution.md) - How fd turns search results into external command invocations — parsing command templates and placeholders, running one command per result in parallel job threads with buffered output, batching many results into argument-length-limited invocations, the --list-details ls wrapper, and exit-code merging.
- [Output Formatting, Colors, Hyperlinks, and Sanitization](output-formatting.md) - How fd prints each result — the --format template, LS_COLORS-based colorization, raw-byte output on pipes, trailing directory separators, custom path separators, ./ prefix stripping, null separators, OSC 8 hyperlinks, and sanitization of control characters for terminals.
