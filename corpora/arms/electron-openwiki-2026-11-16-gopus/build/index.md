# Files

- [Patching Chromium, Node and other dependencies](chromium-and-node-patches.md) - How Electron maintains patch series against Chromium, V8, Node.js and other upstream checkouts — patches/config.json, ordered .patches files, the gclient apply hook, git-import-patches / git-export-patches, the refs/patches/upstream-head marker, CI freshness checks, and patch justification rules.
- [GN build, DEPS and build configuration](gn-build-and-deps.md) - How Electron is fetched with gclient and built with GN/ninja inside a Chromium checkout — DEPS pins and hooks, build/args presets, the main BUILD.gn targets (electron_lib, JS bundles, js2c, fuses, default_app.asar, electron_app, dist zips, node headers), filename lists, npm-driven build actions and pre-commit maintenance.
