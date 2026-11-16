---
title: "Testing and Development"
---
## Overview

Hono supports application checks through app.request and typed testClient calls, then verifies the library with TypeScript, Vitest, and runtime-specific suites. The local helpers execute the actual request pipeline without a listener. Runtime tests add host behavior, while build checks validate the package outputs consumers import. [[Quickstart]] establishes the first request; this page follows the tools used to investigate and verify larger changes.

Sources: [src/hono-base.ts:488-517](repo://src/hono-base.ts#L488-L517), [src/helper/testing/index.ts:15-27](repo://src/helper/testing/index.ts#L15-L27), [package.json:13-36](repo://package.json#L13-L36), [build/build.ts:22-26](repo://build/build.ts#L22-L26)

## Test the application in process

app.request accepts a Request, URL, or string plus optional RequestInit, bindings, and execution context. An existing Request is reused unless an initialization object requires constructing a replacement. Relative paths are resolved against localhost, then fetch runs the same dispatch as the runtime entry. Await the result because the method may return either a Response or a promise depending on the handler path.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

Bindings and execution context remain explicit inputs. A test that needs c.env should pass its bindings as the third argument, and host background operations require the fourth argument. Neither app.request nor testClient creates a host execution object automatically. Keep assertions about environment-dependent behavior tied to the values supplied by the test, using the context contracts in [[Request and Context]].

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517), [src/helper/testing/index.ts:16-26](repo://src/helper/testing/index.ts#L16-L26), [src/context.ts:352-396](repo://src/context.ts#L352-L396)

testClient creates hc with a localhost base and replaces its fetch transport with app.request. This preserves the request serialization described in [[Typed Client]] while keeping calls local. Its options argument excludes a custom fetch because the helper owns that transport. The repository's smallest example retains the chained route type and asserts the decoded response:

Sources: [src/helper/testing/index.ts:15-27](repo://src/helper/testing/index.ts#L15-L27), [src/helper/testing/index.test.ts:4-9](repo://src/helper/testing/index.test.ts#L4-L9)

```ts
const app = new Hono().get('/search', (c) => c.json({ hello: 'world' }))
const res = await testClient(app).search.$get()
expect(await res.json()).toEqual({ hello: 'world' })
```

Sources: [src/helper/testing/index.test.ts:6-8](repo://src/helper/testing/index.test.ts#L6-L8)

The same test suite checks bindings through testClient's second argument and headers through its fourth argument. These cases verify the complete local request path: client options become request headers, bindings reach the handler, and the response is decoded by the caller. Register routes before the first request, because the default SmartRouter chooses and installs its matcher on first use.

Sources: [src/helper/testing/index.test.ts:11-28](repo://src/helper/testing/index.test.ts#L11-L28), [src/router/smart-router/router.ts:13-49](repo://src/router/smart-router/router.ts#L13-L49)

## Inspect registered routes

inspectRoutes returns one record per registration with path, method, name, and isMiddleware. It unwraps composed handlers before identifying them. Named functions keep their names; anonymous functions receive a handler or middleware label. The middleware flag uses function arity greater than one, so it is an inspection heuristic rather than an analysis of what the function does.

Sources: [src/helper/dev/index.ts:16-37](repo://src/helper/dev/index.ts#L16-L37), [src/utils/handler.ts:8-15](repo://src/utils/handler.ts#L8-L15)

showRoutes prints grouped method/path entries. By default it filters middleware and omits handler names; verbose includes middleware and prints the grouped names. colorize overrides automatic color detection. This reads registration metadata, whereas the active-match helpers in [[Routing and Dispatch]] describe the handlers attached to a particular request.

Sources: [src/helper/dev/index.ts:39-74](repo://src/helper/dev/index.ts#L39-L74), [src/helper/route/index.ts:32-83](repo://src/helper/route/index.ts#L32-L83)

getRouterName is different from passive inspection: it calls router.match for GET / before returning the router name. On SmartRouter this can select the underlying router and end the registration phase. Call it after application setup, just as a first request should occur after registration, to avoid turning a diagnostic call into a subsequent route-add failure.

Sources: [src/helper/dev/index.ts:76-79](repo://src/helper/dev/index.ts#L76-L79), [src/router/smart-router/router.ts:13-60](repo://src/router/smart-router/router.ts#L13-L60)

## Prepare contributor dependencies

The contribution guide specifies Bun as the repository package manager and uses a frozen lockfile installation. Its required PR check is bun run test. These commands belong to development of this library checkout; the application generator in [[Quickstart]] is a separate entry into creating an application.

Sources: [docs/CONTRIBUTING.md:27-39](repo://docs/CONTRIBUTING.md#L27-L39), [README.md:35-39](repo://README.md#L35-L39)

```bash
bun install --frozen-lockfile
```

Sources: [docs/CONTRIBUTING.md:33-35](repo://docs/CONTRIBUTING.md#L33-L35)

The test script runs tsc against tsconfig.spec.json before invoking Vitest. That configuration includes src, supplies Vitest globals, enables the Hono JSX import source, and emits no JavaScript. It extends strict base settings. The watch script invokes Vitest alone, so it does not reproduce the script's preceding TypeScript check.

Sources: [package.json:14-15](repo://package.json#L14-L15), [tsconfig.spec.json:1-11](repo://tsconfig.spec.json#L1-L11), [tsconfig.base.json:1-15](repo://tsconfig.base.json#L1-L15)

## Select the relevant verification commands

| Script | Defined work |
| --- | --- |
| test | Type-check source tests, then run Vitest |
| test:watch | Run Vitest in watch mode |
| test:node, test:workerd, test:fastly | Select the corresponding Vitest project |
| test:lambda, test:lambda-edge | Select event-adapter Vitest projects |
| test:deno | Run Deno and both Deno JSX configurations |
| test:bun | Run Bun runtime tests with the source JSX import |
| test:all | Run test, then the Deno and Bun scripts |
| lint | Check source, runtime tests, build, performance measures, and benchmarks with ESLint |
| format | Check the listed JavaScript and TypeScript trees with Prettier |
| coverage | Run Vitest with coverage |

Sources: [package.json:14-33](repo://package.json#L14-L33)

Vitest discovers runtime project configurations and defines a main project for source, scripts, and build tests. The main project excludes sandbox files and case-test files. Two additional projects run DOM tests with different JSX import sources: the default JSX implementation and the DOM implementation. This lets the same browser-facing cases exercise both configured JSX entry points.

Sources: [vitest.config.ts:25-71](repo://vitest.config.ts#L25-L71)

Coverage uses V8 and writes JSON, text, and HTML reports under coverage/raw/default. Its exclusions include runtime tests, benchmarks, performance measures, test utilities, the build script, and selected compile-time-only type files. The report therefore measures the configured source scope, not every file involved in a runtime integration.

Sources: [vitest.config.ts:5-24](repo://vitest.config.ts#L5-L24)

## Verify the host boundary

Runtime tests cover behavior that local transport does not create. The workerd suite launches a worker with Wrangler, supplies bindings, calls its fetch endpoint, and stops it afterward. Its WebSocket case connects to the worker's actual address and port. Node tests use @hono/node-server, while the Fastly project installs its compute plugin. Use the matching runtime suite for changes to the integration described in [[Runtime Adapters]].

Sources: [runtime-tests/workerd/index.test.ts:1-39](repo://runtime-tests/workerd/index.test.ts#L1-L39), [runtime-tests/workerd/index.test.ts:41-76](repo://runtime-tests/workerd/index.test.ts#L41-L76), [runtime-tests/node/index.test.ts:1-15](repo://runtime-tests/node/index.test.ts#L1-L15), [runtime-tests/fastly/vitest.config.ts:1-10](repo://runtime-tests/fastly/vitest.config.ts#L1-L10)

These suites are not all equivalent deployment environments. The Lambda suite imports its adapter directly and loads a local mock, while workerd launches a development worker. Interpreting a passing check requires knowing which boundary it exercises: request dispatch, event conversion, or a host listener. test:all adds native Deno and Bun runs after the Vitest-based test command.

Sources: [runtime-tests/lambda/index.test.ts:1-26](repo://runtime-tests/lambda/index.test.ts#L1-L26), [runtime-tests/workerd/index.test.ts:8-20](repo://runtime-tests/workerd/index.test.ts#L8-L20), [package.json:14-23](repo://package.json#L14-L23)

## Build consumable packages

The build script clears dist, runs the Bun build program, and copies the CommonJS package marker into dist/cjs and dist/types. postbuild is configured as publint. The package points import consumers to dist/index.js, require consumers to dist/cjs/index.js, and type consumers to dist/types/index.d.ts.

Sources: [package.json:5-11](repo://package.json#L5-L11), [package.json:29-42](repo://package.json#L29-L42)

Before emitting files, the build validates package.json and jsr.json export keys in both directions, accounting for wildcard mappings. Missing entries throw. It collects TypeScript entry points while excluding its configured test and legacy patterns, then runs ESM, CommonJS, and declaration generation concurrently. The ESM plugin rewrites local imports to JavaScript file or index paths.

Sources: [build/build.ts:20-39](repo://build/build.ts#L20-L39), [build/build.ts:45-107](repo://build/build.ts#L45-L107), [build/validate-exports.ts:1-37](repo://build/validate-exports.ts#L1-L37)

Declaration generation uses tsconfig.build.json, which excludes test files and enables unused-local and unused-parameter checks. After generation, the build removes private field declarations from emitted declaration files using parsed class property locations. This final artifact processing is separate from test execution, so package/export changes need the build path in addition to application response assertions.

Sources: [tsconfig.build.json:1-19](repo://tsconfig.build.json#L1-L19), [build/build.ts:103-114](repo://build/build.ts#L103-L114), [build/remove-private-fields.ts:5-56](repo://build/remove-private-fields.ts#L5-L56)

