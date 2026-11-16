# Files

- [CLI Parsing and Config Construction](cli-and-configuration.md) - How fd turns command-line arguments (clap `Opts`) into the immutable `Config` used by the walker, including search-path resolution, flag overrides/aliases, color, hyperlink, thread and strip-prefix decisions, and startup diagnostics.
- [Architecture Overview: From argv to Output](overview.md)
- [Parallel Walk, Batching and the Receiver Thread](parallel-walk-and-receiver.md) - Deep dive into src/walk.rs - how sender threads filter entries, how BatchSender and a bounded channel move results, how ReceiverBuffer switches from sorted buffering to streaming, and how quiet, max-results, broken symlinks and Ctrl-C are handled.
