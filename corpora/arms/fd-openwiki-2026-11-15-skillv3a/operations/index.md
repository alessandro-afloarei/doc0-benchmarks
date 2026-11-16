# Files

- [Build, Release, and Packaging](build-release-and-packaging.md) - How fd is built, checked, packaged and released — Cargo features (completions, jemalloc), MSRV and build profiles, the GitHub Actions CI/CD matrix with cross, tarballs and Debian packages, shell completions and man page, Makefile install, and the release checklist and scripts.
- [Exit Codes, Errors, and Interrupts](exit-codes-and-errors.md) - fd's exit-code contract (0, 1, 130 and --quiet semantics), how exit codes from parallel command jobs are merged, how setup errors, filesystem errors and output errors are reported, broken-pipe behavior, and Ctrl-C/SIGINT handling.
