# Files

- [CLI Parsing and Config Construction](cli-to-config.md) - How fd turns clap-parsed command-line options (Opts) into the immutable Config consumed by the walker, including pattern modes, smart case, color/hyperlink decisions, ignore-flag derivation and early validation errors.
- [Architecture Overview](overview.md) - End-to-end lifecycle of an fd invocation from argument parsing through configuration, parallel directory traversal and result printing or command execution, plus a map of every source module and its responsibility.
- [Parallel Walk Pipeline](parallel-walk-pipeline.md) - The concurrency model of fd's search in src/walk.rs - parallel walker sender callbacks, eagerly-sent shared batches over a bounded channel, the buffering-then-streaming receiver that sorts fast searches, early termination for --max-results and --quiet, and Ctrl-C handling.
