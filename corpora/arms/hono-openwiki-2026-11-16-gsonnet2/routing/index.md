# Files

- [RegExpRouter and PreparedRegExpRouter](regexp-router.md) - How RegExpRouter collects routes and middleware, compiles one regular expression per HTTP method with a static-path fast path, rejects ambiguous patterns via UnsupportedPathError, and how PreparedRegExpRouter replays a pre-built matcher.
- [Router Contract and SmartRouter](router-contract-and-smart-router.md) - The Router interface and its two Result shapes, route-registration constants and UnsupportedPathError, and how SmartRouter lazily selects the first router able to handle all registered routes; also which preset uses which routers.
- [TrieRouter, LinearRouter and PatternRouter](trie-linear-pattern-routers.md) - Algorithms and trade-offs of Hono's TrieRouter (segment tree with scored handlers), LinearRouter (sequential scan, no build step) and PatternRouter (one regexp per route), including supported patterns, ordering rules and when each is selected.
