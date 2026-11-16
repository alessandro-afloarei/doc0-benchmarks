# Files

- [CLI Parsing and Configuration](cli-and-configuration.md) - How fd parses its clap-derived command line, turns the pattern and flags into compiled regular expressions and a Config, and which options control case sensitivity, pattern interpretation, ignore behavior and execution mode.
- [System Overview](overview.md) - Map of the fd binary's architecture - entry point, module layout under src/, the pipeline from argument parsing to printed or executed results, the concurrency model and the exit-status contract.
- [Parallel Directory Traversal and Result Delivery](parallel-traversal.md) - How fd's walker in src/walk.rs runs a parallel directory walk, batches matching entries across a bounded channel to a single receiver thread, switches from buffered to streaming output, and handles quit, Ctrl-C, broken pipes and exit status.
- [Search Filters and Ignore Rules](search-filters.md) - Every filter fd applies to a candidate entry, split into walker-level rules (hidden files, ignore files, excludes, depth, pruning) and sender-level predicates (name, extension, file type, owner, size, modification time), with their order, semantics and cost.
