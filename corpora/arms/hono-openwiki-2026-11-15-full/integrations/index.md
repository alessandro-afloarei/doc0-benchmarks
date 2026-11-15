# Files

- [RPC Client (hc)](rpc-client.md) - How the hono/client hc function turns an app's route schema into a typed, Proxy-based HTTP client — path chaining, $method calls, request building for query/param/json/form/header/cookie, $url/$path/$ws, header and fetch options, parseResponse, and type utilities like InferRequestType and PickResponseByStatusCode.
- [Runtime Adapters](runtime-adapters.md) - How src/adapter bridges Hono's Web-standard fetch() to AWS Lambda (API Gateway v1/v2, ALB, VPC Lattice, streaming), Lambda@Edge, Cloudflare Workers and Pages, Bun, Deno, Netlify, Vercel and Service Workers, and how each supplies serveStatic, upgradeWebSocket, getConnInfo and toSSG implementations.
