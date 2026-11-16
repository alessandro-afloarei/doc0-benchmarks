# Files

- [Building Electron](building.md) - How Electron is built from source, from gclient checkout of Chromium and Node.js through GN argument sets and the Ninja build, to the generated typings, webpack bundles, fuses, and distribution zips, with the GN arguments that change behavior.
- [Contributing and Linting](contributing-and-linting.md) - The contribution workflow for Electron and the code-quality gates it enforces, including the lint.js language checks for C++, Objective-C, JavaScript and TypeScript, Python, GN, patches, and Markdown, the docs lint chain, the pre-commit and pre-push hooks, and the semantic pull-request title rule.
- [Testing](testing.md) - How Electron's test suites run, covering the main-process Electron app under spec/, the spec runner that installs and launches it, the mocha options for focusing on a subset, the Node.js and NAN native test runners, the type-smoke check, and how CI shards the suite.
