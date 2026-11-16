# Files

- [Build System (GN, DEPS, Webpack, Generated Files)](build-system.md) - How Electron is built as a component inside a Chromium checkout using gclient DEPS, GN/ninja with BUILD.gn and filenames.gni source lists, build args and buildflags, generated headers (fuses, version), the webpack-to-js2c JavaScript pipeline, and packaging into app bundles, asar and zip artifacts.
- [Upstream Patch System (Chromium, Node, V8, ...)](upstream-patches.md) - How Electron carries modifications to Chromium, Node.js, V8 and other upstream dependencies as ordered git-format patch series, how they are applied and exported with git am/format-patch tooling, the justification rules, the mtime cache, and related Chromium source copies in chromium_src.
