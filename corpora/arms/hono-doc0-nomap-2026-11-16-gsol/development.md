---
title: "Testing and Development"
---
## Overview

Hono's tests can enter the same dispatch path as deployed requests without starting a listener. `app.request` constructs a standard request and calls `fetch`; `testClient` supplies that operation to the typed client. Repository scripts then add TypeScript checks, runtime projects, formatting, linting, and package builds. [[Quickstart]] introduces a first request, while [[Typed Client]] owns serialization and response inference used by the testing helper.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517), [src/helper/testing/index.ts:15-27](repo://src/helper/testing/index.ts#L15-L27), [package.json:13-36](repo://package.json#L13-L36)

## Prepare the checkout

The contribution guide specifies Bun as the repository package manager and gives a frozen-lockfile install command. Run it from the checkout before executing the repository scripts. This is distinct from the application scaffold in [[Quickstart]]: it installs the development environment for this framework repository. The guide asks contributors to ensure their pull request passes `bun run test`.

Sources: [docs/CONTRIBUTING.md:27-39](repo://docs/CONTRIBUTING.md#L27-L39), [README.md:35-39](repo://README.md#L35-L39)

```bash
bun install --frozen-lockfile
```

Sources: [docs/CONTRIBUTING.md:33-35](repo://docs/CONTRIBUTING.md#L33-L35)

## Exercise a route in process

`app.request` accepts a path, URL, or Request plus initialization, bindings, and execution context. Relative inputs are placed under localhost, and a supplied Request can be cloned with new initialization. The result may be synchronous or asynchronous, so tests await it before checking status, headers, and consumed body content. Bindings supplied to the helper reach the handler's `c.env`; an execution context is available only when a test provides it.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517), [src/hono.test.ts:120-123](repo://src/hono.test.ts#L120-L123), [src/context.ts:352-359](repo://src/context.ts#L352-L359), [src/context.ts:391-397](repo://src/context.ts#L391-L397)

Register all routes before starting requests or invoking operations that cause router matching. The default SmartRouter releases its route buffer after selecting an implementation and rejects late additions. Tests sharing an application should therefore finish setup before the first assertion that dispatches. [[Routing and Application Composition]] explains that construction boundary and the route-copying behavior of grouped sub-applications.

Sources: [src/router/smart-router/router.ts:13-18](repo://src/router/smart-router/router.ts#L13-L18), [src/router/smart-router/router.ts:32-49](repo://src/router/smart-router/router.ts#L32-L49), [src/hono-base.ts:218-231](repo://src/hono-base.ts#L218-L231)

## Use the typed test client

`testClient(app, Env, executionCtx, options)` builds an `hc` client rooted at localhost. Its custom fetch calls `app.request` with the supplied bindings and execution context. Other client options remain available, while callers cannot replace fetch through this helper's options type. The helper's own test chains route registration into the application value so the resulting schema contains `/search`, then invokes that endpoint through the client.

Sources: [src/helper/testing/index.ts:13-27](repo://src/helper/testing/index.ts#L13-L27), [src/helper/testing/index.test.ts:4-9](repo://src/helper/testing/index.test.ts#L4-L9)

```ts
const app = new Hono().get('/search', (c) => c.json({ hello: 'world' }))
const res = await testClient(app).search.$get()
expect(await res.json()).toEqual({ hello: 'world' })
```

Sources: [src/helper/testing/index.test.ts:6-8](repo://src/helper/testing/index.test.ts#L6-L8)

The test suite also supplies environment values and configured headers to the helper and verifies that handlers read them. This exercises client serialization and server dispatch together. Socket creation remains the client's WebSocket branch rather than an HTTP fetch; the helper test stubs the global constructor for that case. For actual upgrade behavior, use the runtime-specific integration described in [[WebSockets]].

Sources: [src/helper/testing/index.test.ts:11-40](repo://src/helper/testing/index.test.ts#L11-L40), [src/client/client.ts:187-212](repo://src/client/client.ts#L187-L212)

## Inspect registrations and matched routes

`inspectRoutes` maps registered routes to path, method, handler name, and a middleware flag. It unwraps composed handlers first. Middleware classification uses function arity greater than one, so this is an inspection heuristic. `showRoutes` filters middleware unless verbose mode is requested, groups duplicate method/path pairs for display, supports color configuration, and prints handler names in verbose mode.

Sources: [src/helper/dev/index.ts:23-74](repo://src/helper/dev/index.ts#L23-L74), [src/utils/handler.ts:8-15](repo://src/utils/handler.ts#L8-L15)

`getRouterName` actively calls `router.match('GET', '/')` before returning the router name. With SmartRouter this can initialize routing, so use it after registration. Inside a request, `matchedRoutes` returns the route metadata from its match result; `routePath` and `baseRoutePath` select by supplied index or current route index. The route helper's `basePath` resolves dynamic base segments against the request and caches the result by context and index.

Sources: [src/helper/dev/index.ts:76-79](repo://src/helper/dev/index.ts#L76-L79), [src/helper/route/index.ts:32-34](repo://src/helper/route/index.ts#L32-L34), [src/helper/route/index.ts:58-83](repo://src/helper/route/index.ts#L58-L83), [src/helper/route/index.ts:106-140](repo://src/helper/route/index.ts#L106-L140)

## Run the relevant checks

| Script | Work performed |
| --- | --- |
| `test` | Type-checks the source test project, then runs Vitest |
| `test:watch` | Runs Vitest watch mode |
| `test:node`, `test:workerd`, `test:fastly`, `test:lambda`, `test:lambda-edge` | Select the named Vitest runtime project |
| `test:deno` | Runs Deno request and JSX suites with their configuration files |
| `test:bun` | Runs Bun runtime tests with the source JSX import setting |
| `test:all` | Runs the main test command, Deno tests, and Bun tests |
| `lint` | Checks source, runtime tests, build code, performance measures, and benchmarks with ESLint |
| `format` | Checks the configured TypeScript/JavaScript globs with Prettier |
| `coverage` | Runs Vitest with coverage |

Sources: [package.json:14-33](repo://package.json#L14-L33)

The root Vitest configuration loads runtime project configurations and a main source project. It also runs DOM and hook tests under both the ordinary JSX runtime and the DOM runtime. Coverage uses V8 and excludes runtime tests, benchmarks, build tooling, and selected compile-time type modules. The TypeScript test configuration uses noEmit, Hono JSX, and Vitest globals, so the `test` script checks test types before runtime assertions.

Sources: [vitest.config.ts:3-73](repo://vitest.config.ts#L3-L73), [tsconfig.spec.json:1-11](repo://tsconfig.spec.json#L1-L11), [package.json:14-15](repo://package.json#L14-L15)

## Build package outputs

The build script first validates package.json and jsr.json export coverage in both directions, including wildcard handling. It scans TypeScript entry files while excluding specified patterns. ESM output goes to dist and uses a plugin to add JavaScript extensions to local import references; CommonJS goes to dist/cjs. In parallel it runs declaration-only TypeScript generation, then removes private-field declarations from the emitted declaration files.

Sources: [build/build.ts:18-39](repo://build/build.ts#L18-L39), [build/build.ts:45-70](repo://build/build.ts#L45-L70), [build/build.ts:72-114](repo://build/build.ts#L72-L114), [build/validate-exports.ts:6-37](repo://build/validate-exports.ts#L6-L37)

The package `build` command removes dist, invokes the Bun build script, and copies CommonJS package metadata into both CommonJS and declaration output directories. `postbuild` runs publint. `watch` selects the builder's watch mode, which creates esbuild contexts rather than one-shot builds; its TypeScript subprocess also receives watch mode. The package export map points consumers to separate import, require, and type paths, so changes to public entries need to remain consistent across those outputs.

Sources: [package.json:29-42](repo://package.json#L29-L42), [build/build.ts:94-107](repo://build/build.ts#L94-L107)
