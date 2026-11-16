# Files

- [Build, Features, CI, Release and Packaging](build-release-and-packaging.md) - How fd is built and shipped - Cargo features (jemalloc, completions), platform-specific dependencies, MSRV, the CICD workflow matrix, Makefile install and completion targets, Debian packaging and the release checklist scripts.
- [Exit Codes and Error Handling](exit-codes-and-error-handling.md) - ExitCode semantics in fd (success, quiet-mode results, general error, SIGINT re-raise), how errors are printed with the [fd error] prefix, which filesystem errors are shown, and how exec job results are merged.
