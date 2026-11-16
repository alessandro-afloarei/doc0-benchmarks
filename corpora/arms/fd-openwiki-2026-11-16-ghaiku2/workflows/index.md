# Files

- [Command Execution (--exec and --exec-batch)](command-execution.md) - How fd runs an external command for each search result (-x/--exec) or for batches of results (-X/--exec-batch) - the CommandSet and CommandTemplate model, placeholder expansion, argument-limit batching with argmax, output buffering across threads, and exit-status merging.
- [Output Formatting, Colors and Terminal Safety](output-formatting.md) - How fd prints a matched entry - the per-entry writer in src/output.rs for plain, colorized, --format and hyperlink output; trailing slashes and path separators; raw bytes for pipes; terminal sanitization of control characters; and null-separated output.
