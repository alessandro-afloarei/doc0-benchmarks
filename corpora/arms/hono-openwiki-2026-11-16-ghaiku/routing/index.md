# Files

- [Route Registration, Grouping and Mounting](route-registration.md) - How Hono records routes - the method helpers (get, post, put, delete, options, patch, all), on() for multiple methods and paths, use() for middleware, the shared
- [Router Selection and Matching](router-selection.md) - The Router contract that every Hono router implements, the five router implementations (RegExpRouter, TrieRouter, LinearRouter, PatternRouter, SmartRouter), the build-once matching model and the UnsupportedPathError fallback that lets SmartRouter pick a router on the first request, the default router chain of each preset, and the shape of the match result consumed by dispatch.
