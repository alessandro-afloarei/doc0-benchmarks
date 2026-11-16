---
title: "AWS Lambda and Lambda@Edge"
---
## Overview

AWS Lambda does not call functions with a `Request`; it passes a JSON event whose shape depends on what invoked the function, and expects a JSON result back. The `hono/aws-lambda` adapter converts each supported event into a standard `Request`, calls `app.fetch`, and converts the `Response` into the result the invoker expects. `hono/lambda-edge` does the same for CloudFront's Lambda@Edge events. Inside the app, handlers see an ordinary request, and the original event is available in `c.env` ([[Context and Responses]]).

Sources: [src/adapter/aws-lambda/handler.ts:198-276](repo://src/adapter/aws-lambda/handler.ts#L198-L276), [src/adapter/lambda-edge/handler.ts:116-147](repo://src/adapter/lambda-edge/handler.ts#L116-L147)

```ts
import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'

const app = new Hono()
app.get('/', (c) => c.text('Hello from Lambda'))

export const handler = handle(app)
```

Sources: [src/adapter/aws-lambda/handler.ts:210-221](repo://src/adapter/aws-lambda/handler.ts#L210-L221)

## Event sources

`getProcessor(event)` picks one of four processors by looking at the event:

Sources: [src/adapter/aws-lambda/handler.ts:625-658](repo://src/adapter/aws-lambda/handler.ts#L625-L658)

| Event | Detected by | Processor |
| --- | --- | --- |
| Application Load Balancer | `requestContext.elb` | `ALBProcessor` |
| API Gateway HTTP API (v2) and Lambda function URLs | `rawPath` and `requestContext.http` | `EventV2Processor` |
| VPC Lattice (v2) | `requestContext.serviceArn` | `LatticeV2Processor` |
| API Gateway REST API (v1) | anything else | `EventV1Processor` |

Sources: [src/adapter/aws-lambda/handler.ts:625-658](repo://src/adapter/aws-lambda/handler.ts#L625-L658)

A comment explains why the v2 test needs both fields: a v1 event behind a custom domain base path mapping also has a `rawPath`, but only v2 events have `requestContext.http`.

Sources: [src/adapter/aws-lambda/handler.ts:646-651](repo://src/adapter/aws-lambda/handler.ts#L646-L651)

## Building the Request

`EventProcessor.createRequest` is shared by all processors, which only supply the path, method, query string and headers for their event shape. The URL is `https://` plus the domain, taken from `requestContext.domainName` or else the `host` header, plus the path and the query string. A body is decoded from base64 when `isBase64Encoded` is set, and `content-length` is set to its byte length.

Sources: [src/adapter/aws-lambda/handler.ts:278-342](repo://src/adapter/aws-lambda/handler.ts#L278-L342)

| Processor | Path, method | Query string | Headers and cookies |
| --- | --- | --- | --- |
| v2 | `rawPath`, `requestContext.http.method` | `rawQueryString` | `headers`; `cookies` joined into one `Cookie` header |
| v1 | `path`, `httpMethod` | Rebuilt from `multiValueQueryStringParameters` or `queryStringParameters`, re-encoded | `multiValueHeaders` appended, then `headers` not already set |
| ALB | `path`, `httpMethod` | Rebuilt, multi-value first | `multiValueHeaders` (values joined) or `headers` |
| Lattice | `path`, `method` | none | Header arrays appended |

Sources: [src/adapter/aws-lambda/handler.ts:404-499](repo://src/adapter/aws-lambda/handler.ts#L404-L499), [src/adapter/aws-lambda/handler.ts:503-580](repo://src/adapter/aws-lambda/handler.ts#L503-L580), [src/adapter/aws-lambda/handler.ts:584-623](repo://src/adapter/aws-lambda/handler.ts#L584-L623)

The v1 processor re-encodes query values because, as its comment says, API Gateway passes them decoded. The ALB processor checks the multi-value parameters first; its comment describes events, such as those from the Serverless framework, that carry both forms, where only the multi-value form holds every value.

Sources: [src/adapter/aws-lambda/handler.ts:452-468](repo://src/adapter/aws-lambda/handler.ts#L452-L468), [src/adapter/aws-lambda/handler.ts:534-558](repo://src/adapter/aws-lambda/handler.ts#L534-L558)

Header values with non-ASCII characters are passed through `encodeURIComponent` by the v1, ALB and Lattice processors.

Sources: [src/adapter/aws-lambda/handler.ts:13-21](repo://src/adapter/aws-lambda/handler.ts#L13-L21), [src/adapter/aws-lambda/handler.ts:474-492](repo://src/adapter/aws-lambda/handler.ts#L474-L492)

If building the request throws, `handle` answers without calling the app: `400 Invalid request` for a `TypeError`, such as a malformed URL, and `500 Internal Server Error` otherwise.

Sources: [src/adapter/aws-lambda/handler.ts:252-266](repo://src/adapter/aws-lambda/handler.ts#L252-L266)

## Bindings

`handle` calls `app.fetch(req, { event, requestContext, lambdaContext })`. Handlers can read the raw event, the request context (used by `getConnInfo` for the client address, see [[Runtime and Connection Info]]) and the Lambda context from `c.env`:

Sources: [src/adapter/aws-lambda/handler.ts:268-272](repo://src/adapter/aws-lambda/handler.ts#L268-L272), [src/adapter/aws-lambda/index.ts:1-14](repo://src/adapter/aws-lambda/index.ts#L1-L14)

```ts
import type { LambdaEvent, LambdaContext } from 'hono/aws-lambda'

type Bindings = { event: LambdaEvent; lambdaContext: LambdaContext }

const app = new Hono<{ Bindings: Bindings }>()
app.get('/id', (c) => c.text(c.env.lambdaContext.awsRequestId))
```

Sources: [src/adapter/aws-lambda/handler.ts:268-272](repo://src/adapter/aws-lambda/handler.ts#L268-L272), [src/adapter/aws-lambda/index.ts:1-14](repo://src/adapter/aws-lambda/index.ts#L1-L14)

## Building the result

`createResult` reads the whole response body. It is base64-encoded when `isContentTypeBinary(contentType)` is true, or when `Content-Encoding` is set to anything other than `identity`; otherwise it is sent as text.

Sources: [src/adapter/aws-lambda/handler.ts:344-359](repo://src/adapter/aws-lambda/handler.ts#L344-L359), [src/adapter/aws-lambda/handler.ts:672-674](repo://src/adapter/aws-lambda/handler.ts#L672-L674)

`defaultIsContentTypeBinary` treats everything as binary except `text/plain`, `text/html`, `text/css`, `text/javascript`, `text/csv` and JSON or XML types. The `isContentTypeBinary` option replaces it; the doc comment shows building on the default to add types such as `image/*`.

Sources: [src/adapter/aws-lambda/handler.ts:666-670](repo://src/adapter/aws-lambda/handler.ts#L666-L670), [src/adapter/aws-lambda/handler.ts:223-237](repo://src/adapter/aws-lambda/handler.ts#L223-L237)

Headers are returned in the same form the event used: `multiValueHeaders` (each value wrapped in an array) when the event had them, `headers` otherwise. `Set-Cookie` needs special handling because a response can carry several:

Sources: [src/adapter/aws-lambda/handler.ts:361-401](repo://src/adapter/aws-lambda/handler.ts#L361-L401), [src/adapter/aws-lambda/handler.ts:423-425](repo://src/adapter/aws-lambda/handler.ts#L423-L425), [src/adapter/aws-lambda/handler.ts:494-498](repo://src/adapter/aws-lambda/handler.ts#L494-L498), [src/adapter/aws-lambda/handler.ts:572-579](repo://src/adapter/aws-lambda/handler.ts#L572-L579), [src/adapter/aws-lambda/handler.ts:615-620](repo://src/adapter/aws-lambda/handler.ts#L615-L620)

| Processor | Cookies in the result |
| --- | --- |
| v2 | The `cookies` array |
| v1 | `multiValueHeaders['set-cookie']` |
| ALB | `multiValueHeaders['set-cookie']`, or only the first cookie in `headers` when multi-value headers are off |
| Lattice | `headers['set-cookie']` as an array |

Sources: [src/adapter/aws-lambda/handler.ts:361-401](repo://src/adapter/aws-lambda/handler.ts#L361-L401), [src/adapter/aws-lambda/handler.ts:423-425](repo://src/adapter/aws-lambda/handler.ts#L423-L425), [src/adapter/aws-lambda/handler.ts:494-498](repo://src/adapter/aws-lambda/handler.ts#L494-L498), [src/adapter/aws-lambda/handler.ts:572-579](repo://src/adapter/aws-lambda/handler.ts#L572-L579), [src/adapter/aws-lambda/handler.ts:615-620](repo://src/adapter/aws-lambda/handler.ts#L615-L620)

## Response streaming

`streamHandle(app)` wraps the app with `awslambda.streamifyResponse`, the global the Lambda Node.js runtime provides for response streaming. It builds the request the same way, calls `app.fetch(req, { event, requestContext, context })`, sends the status, headers and cookies as `HttpResponseStream` metadata, and then copies the body to the Node.js stream chunk by chunk, so streamed responses ([[Streaming and Server-Sent Events]]) reach the client as they are produced.

Sources: [src/adapter/aws-lambda/handler.ts:126-193](repo://src/adapter/aws-lambda/handler.ts#L126-L193)

The bindings key for the Lambda context is `context` here, not `lambdaContext` as in `handle`. Any error writes `Internal Server Error` to the stream, and the stream is always ended.

Sources: [src/adapter/aws-lambda/handler.ts:153-157](repo://src/adapter/aws-lambda/handler.ts#L153-L157), [src/adapter/aws-lambda/handler.ts:185-190](repo://src/adapter/aws-lambda/handler.ts#L185-L190)

## Lambda@Edge

`handle(app)` from `hono/lambda-edge` returns `(event, context, callback)` for CloudFront triggers. It builds the request from `Records[0].cf.request`: `https://` plus the `host` header or the distribution's domain name, the URI and the query string, every header value appended, and the body, base64-decoded when CloudFront marks it so, only for methods other than `GET` and `HEAD`.

Sources: [src/adapter/lambda-edge/handler.ts:164-212](repo://src/adapter/lambda-edge/handler.ts#L164-L212)

The app receives `{ event, context, callback, config, request, response }` as bindings. A handler that should not answer itself, for example to forward the possibly modified request to the origin, can call `c.env.callback(null, request)`. The adapter records the first callback call, still forwards it to Lambda's own callback, and returns that result instead of the app's response; an error passed to the callback is thrown.

Sources: [src/adapter/lambda-edge/handler.ts:116-147](repo://src/adapter/lambda-edge/handler.ts#L116-L147)

```ts
import { handle } from 'hono/lambda-edge'
import type { Callback, CloudFrontRequest } from 'hono/lambda-edge'

type Bindings = { callback: Callback; request: CloudFrontRequest }
const app = new Hono<{ Bindings: Bindings }>()

app.get('*', (c) => {
  c.env.callback(null, c.env.request) // pass the request on to the origin
  return c.body(null)
})

export const handler = handle(app)
```

Sources: [src/adapter/lambda-edge/handler.ts:83-85](repo://src/adapter/lambda-edge/handler.ts#L83-L85), [src/adapter/lambda-edge/index.ts:1-14](repo://src/adapter/lambda-edge/index.ts#L1-L14)

Otherwise the response becomes a CloudFront result: the status as a string, headers in CloudFront's `{ key, value }[]` form with lower-cased names, and the body, base64-encoded with `bodyEncoding: 'base64'` when the type is not text, JSON, XML or SVG, or when `Content-Encoding` is set to something other than `identity`.

Sources: [src/adapter/lambda-edge/handler.ts:105-114](repo://src/adapter/lambda-edge/handler.ts#L105-L114), [src/adapter/lambda-edge/handler.ts:149-162](repo://src/adapter/lambda-edge/handler.ts#L149-L162), [src/adapter/lambda-edge/handler.ts:214-218](repo://src/adapter/lambda-edge/handler.ts#L214-L218)

The module also sets `globalThis.crypto` from `node:crypto` when it is missing, so Web Crypto-based features such as [[JWT and JWK]] work in that environment.

Sources: [src/adapter/lambda-edge/handler.ts:1-8](repo://src/adapter/lambda-edge/handler.ts#L1-L8)
