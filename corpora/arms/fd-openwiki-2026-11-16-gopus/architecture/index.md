# Files

- [Parallel Walk, Batching, and the Receiver](parallel-walk-and-receiver.md) - How fd's walk module drives a multi-threaded ignore::WalkParallel traversal, filters entries in sender threads, batches results over a bounded channel, and how a single receiver buffers, sorts, streams, or dispatches results to command execution.
- [Search Pipeline: From Arguments to Results](search-pipeline.md) - End-to-end control flow of a single fd invocation in src/main.rs, from clap parsing through search-path resolution, pattern-to-regex translation, Config construction and validation, to the handoff into walk::scan.
