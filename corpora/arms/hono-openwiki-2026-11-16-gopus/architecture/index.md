# Files

- [Architecture overview](overview.md) - How the Hono repository is laid out, which public entrypoints and subpath exports it ships, how HonoBase, Hono and the tiny/quick presets divide responsibility, and how the core subsystems relate.
- [Request lifecycle and composition](request-lifecycle.md) - How HonoBase registers routes and dispatches each Request through router matching, Context creation, compose() middleware chaining, error and not-found handling, HEAD fallback, and sub-app composition with route(), basePath() and mount().
- [Routers](routers.md) - The Router interface and its two Result formats, and how SmartRouter, RegExpRouter, PreparedRegExpRouter, TrieRouter, PatternRouter and LinearRouter work, which path syntax each supports, and how they are tested against a shared case suite.
