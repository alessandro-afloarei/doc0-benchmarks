# Files

- [CLI Parsing and Configuration](cli-and-configuration.md) - How fd turns command-line arguments into the Opts struct and then into the single Config value that drives the walker, covering pattern-mode selection, smart case, startup validation, ignore-rule wiring, color and hyperlink resolution, and thread defaults.
- [Architecture Overview](overview.md) - End-to-end map of fd, from argument parsing through config construction, regex compilation, parallel directory traversal, per-entry filtering, and result delivery to printing or command execution, with the owning module for each stage.
- [Parallel Traversal and Result Delivery](parallel-traversal.md) - How fd drives the ignore crate's parallel walker, wires ignore and exclude rules into it, runs per-entry filtering on sender threads, batches results over a bounded channel, and switches the single receiver between buffered (sorted) and streaming output, including quit and interrupt handling.
