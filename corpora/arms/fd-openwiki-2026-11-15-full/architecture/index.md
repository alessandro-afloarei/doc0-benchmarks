# Files

- [Architecture Overview](overview.md) - End-to-end architecture of the fd binary, from clap argument parsing through pattern compilation and Config construction to the parallel walk and the output or exec sinks, with each module's responsibility.
- [Parallel Search Pipeline](search-pipeline.md) - How src/walk.rs runs the search. A multi-threaded ignore::WalkParallel produces filtered entries, a batched bounded channel carries them, and a receiver either buffers and sorts them, streams them to stdout, or hands them to exec workers. Also covers early exit, quiet mode, and Ctrl-C handling.
