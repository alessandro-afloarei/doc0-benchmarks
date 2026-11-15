# Files

- [Build, Release and Packaging](build-release-and-packaging.md) - How fd is built, tested in CI, packaged and released. Covers Cargo features (completions, use-jemalloc, base) and allocator gating, the release profile and MSRV, the Makefile install and completion targets, cross-compilation settings, the GitHub Actions CICD matrix, Debian packaging, and the release checklist.
- [Exit Codes, Errors and Signals](exit-codes-and-errors.md) - Covers what exit status fd returns and why. Includes the ExitCode variants and their numeric values, how per-command codes are merged, --quiet result signaling, SIGINT handling and re-raising, the [fd error] message format, filesystem errors with --show-errors, and broken-pipe behavior.
