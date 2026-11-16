# Files

- [CLI Parsing and Configuration](cli-and-configuration.md) - How fd defines its command-line interface with clap (Opts in src/cli.rs) and how main.rs's construct_config turns parsed options into the immutable Config struct shared by the walker, output, and exec subsystems.
- [Architecture Overview](overview.md) - End-to-end runtime pipeline of the fd binary — from argument parsing and Config construction through the parallel ignore-crate walk and per-entry filtering to the printing receiver or the --exec command runner — plus a map of module responsibilities.
- [Parallel Walk and Result Receiver](parallel-walk-and-receiver.md) - How src/walk.rs drives the ignore crate's parallel walker, filters each entry in the sender callbacks, batches results over a bounded channel, and consumes them with a buffering-then-streaming receiver that sorts fast results, honors --max-results/--quiet, and handles Ctrl-C.
