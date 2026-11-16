# Files

- [JSX DOM Runtime and Hooks](dom-runtime.md) - How hono/jsx/dom turns JSX into a tree of NodeObject records, builds and applies them to real DOM nodes, schedules hook-driven updates through update() and a microtask queue, and exposes createRoot, render, createPortal, hooks such as useState and useActionState, and the server renderers used alongside it.
- [JSX Runtime and Server Rendering](server-jsx.md) - How Hono's server-side JSX (src/jsx) creates JSX nodes, escapes and serializes them to HTML strings, streams them through renderToReadableStream with experimental Suspense, and wraps pages with the jsxRenderer middleware and its layout model.
