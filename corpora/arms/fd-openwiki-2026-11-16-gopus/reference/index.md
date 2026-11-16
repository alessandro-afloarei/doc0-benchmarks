# Files

- [CLI Options Reference and Argument Model](cli-options.md) - How fd's command-line interface is defined with clap derive in src/cli.rs — option families and where each is consumed, negation/override flags, conflicts, aliases and hidden options, derived helpers such as threads and max_results, the hand-rolled exec arguments, and shell completions and man page upkeep.
- [Exit Codes and Error Reporting](exit-codes-and-errors.md) - fd's ExitCode model and numeric exit statuses, how codes from parallel workers and commands are merged, SIGINT re-raising, --quiet semantics, the [fd error] message format, filesystem error visibility, and broken-pipe handling.
