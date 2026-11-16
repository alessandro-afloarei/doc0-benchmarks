---
title: "Quickstart"
---
## Overview

Start with an application that registers one route and exports its Hono instance. The same instance can answer an in-process request before a host runtime is attached. This is the smallest path through the request architecture in [[Overview]]: a handler receives a context and returns a standard response, while the application supplies registration and dispatch.

Sources: [README.md:22-33](repo://README.md#L22-L33), [src/hono-base.ts:479-517](repo://src/hono-base.ts#L479-L517)

## Create an application

The repository README gives this scaffold command. It creates a new application; the repository development commands later on this page are for working on Hono itself. Keep those two entry points distinct when deciding which directory should receive dependencies.

Sources: [README.md:35-39](repo://README.md#L35-L39), [docs/CONTRIBUTING.md:27-35](repo://docs/CONTRIBUTING.md#L27-L35)

```bash
npm create hono@latest
```

Sources: [README.md:35-39](repo://README.md#L35-L39)

The README's complete minimal application is below. The GET handler returns the text produced by `c.text`; exporting the application makes its fetch interface available to a host. [[Runtime Adapters]] describes the wrappers used by hosts whose callback signatures include runtime-specific event objects.

Sources: [README.md:26-33](repo://README.md#L26-L33), [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/cloudflare-pages/handler.ts:32-46](repo://src/adapter/cloudflare-pages/handler.ts#L32-L46)

```ts
import { Hono } from 'hono'
const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [README.md:26-33](repo://README.md#L26-L33)

## Exercise the fetch interface

Call `app.request('/')` to exercise that route without setting up a listening server. Await the result because dispatch may return either a response or a promise. The helper accepts a pathname, a full HTTP URL, a URL object, or an existing Request. For a pathname it creates an absolute URL under `http://localhost`, builds a Request, and invokes the application's own `fetch` method.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

The helper forwards optional `RequestInit`, environment bindings, and execution context. With an existing Request, an explicitly supplied initialization object produces a new Request from that input; otherwise the original object goes straight to `fetch`. This gives tests access to the same bindings and method dispatch used by the host, including the HEAD branch that executes GET behavior and removes the response body.

Sources: [src/hono-base.ts:412-415](repo://src/hono-base.ts#L412-L415), [src/hono-base.ts:479-517](repo://src/hono-base.ts#L479-L517)

A pathname with no matching handler receives the default text response `404 Not Found` with status 404. For the registered route, the response body is the handler's `Hono!` text. Read status and body from the returned response when checking behavior. For typed route-level tests, `testClient` supplies a custom client fetch function that calls `app.request`; its contract is covered by [[Validation and Typed Clients]].

Sources: [README.md:26-33](repo://README.md#L26-L33), [src/hono-base.ts:31-33](repo://src/hono-base.ts#L31-L33), [src/hono-base.ts:429-447](repo://src/hono-base.ts#L429-L447), [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

## Add request behavior

Register middleware with `app.use` and handlers with methods such as `get` and `post`. Without an explicit path, `use` registers its middleware against the wildcard path. Middleware can await `next()` and then inspect the downstream response, as the built-in logger does when recording status and elapsed time. [[Routing and Middleware Execution]] explains how registration determines the chain and why each continuation must be awaited.

Sources: [src/hono-base.ts:126-168](repo://src/hono-base.ts#L126-L168), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

Use the context response methods to produce the result your handler needs. `c.text` handles text, and `c.json` is the JSON response interface. Prepared headers and status affect response construction, so request data, shared variables, and response setup are documented together in [[Request and Context]]. An application can replace its error handler with `onError` and its unmatched-route response with `notFound`.

Sources: [src/context.ts:641-710](repo://src/context.ts#L641-L710), [src/hono-base.ts:255-293](repo://src/hono-base.ts#L255-L293)

## Work on this repository

The contribution guide specifies Bun as the package manager and installs dependencies against the checked-in lockfile. Run the following from this repository when preparing its development environment. This installation is separate from creating a consumer application with the scaffold command.

Sources: [docs/CONTRIBUTING.md:27-35](repo://docs/CONTRIBUTING.md#L27-L35)

```bash
bun install --frozen-lockfile
```

Sources: [docs/CONTRIBUTING.md:33-35](repo://docs/CONTRIBUTING.md#L33-L35)

The contribution guide requires `bun run test` for proposed changes. The package's `test` script first type-checks the specification project and then runs Vitest. A failing type check therefore prevents the runtime test command from starting. Watch mode is a separate script, and runtime-specific suites are named separately so their requirements remain visible.

Sources: [docs/CONTRIBUTING.md:37-39](repo://docs/CONTRIBUTING.md#L37-L39), [package.json:13-23](repo://package.json#L13-L23)

| Script | Defined operation |
| --- | --- |
| `test` | Type-check specifications, then run Vitest once |
| `test:watch` | Run Vitest in watch mode |
| `test:deno` | Run Deno runtime and JSX suites |
| `test:bun` | Run Bun runtime tests with the JSX import source |
| `test:node`, `test:workerd`, `test:lambda`, `test:lambda-edge`, `test:fastly` | Select the corresponding Vitest project |
| `lint` | Check source, runtime tests, build tools, performance measures and benchmarks with ESLint |
| `format` | Check the configured JavaScript and TypeScript globs with Prettier |
| `build` | Remove dist, run the Bun build program, and copy the CommonJS package metadata |

Sources: [package.json:13-36](repo://package.json#L13-L36)

The package publishes the `dist` directory and declares separate import, require, and declaration entries. Its default export path and the tiny and quick presets all have explicit export mappings. This is why repository source paths and consumer import paths differ: consumer code imports `hono`, while the build supplies the files referenced by that package mapping.

Sources: [package.json:5-11](repo://package.json#L5-L11), [package.json:38-68](repo://package.json#L38-L68)

