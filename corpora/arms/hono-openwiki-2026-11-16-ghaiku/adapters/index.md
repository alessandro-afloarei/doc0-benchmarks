# Files

- [Runtime Adapters and Platform Entrypoints](runtime-adapters.md) - How a Hono app object is attached to each supported runtime (Cloudflare Workers and Pages, Deno, Bun, AWS Lambda, Lambda@Edge, Vercel, Netlify, service workers), what each entrypoint passes into app.fetch, and which platform helpers (getConnInfo, serveStatic, toSSG, WebSocket upgrades) ship alongside them.
