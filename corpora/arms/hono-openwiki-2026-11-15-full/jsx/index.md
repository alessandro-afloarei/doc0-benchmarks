# Files

- [Client-side JSX (hono/jsx/dom) and Hooks](client-dom.md) - How hono/jsx/dom renders JSX in the browser — the virtual node model, build/apply reconciliation, keyed child matching, batched update scheduling, effects timing, transitions, portals, createRoot — and how the shared hooks in src/jsx/hooks behave during server rendering versus DOM rendering.
- [Server-side JSX](server-jsx.md) - How hono/jsx renders JSX to escaped HTML strings on the server — JSXNode stringification, escaping rules, async components and the string-buffer/callback protocol, context isolation via AsyncLocalStorage, Suspense streaming with renderToReadableStream, ErrorBoundary, the jsx-renderer middleware, the html tagged template and the css helper.
