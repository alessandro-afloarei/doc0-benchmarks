---
title: "AWS Lambda and Lambda@Edge"
---
## Overview

AWS Lambda does not call a fetch handler. It invokes a function with a JSON event whose shape depends on what triggered it (API Gateway REST or HTTP APIs, Lambda function URLs, Application Load Balancer, VPC Lattice, or CloudFront for Lambda@Edge) and expects a JSON result in a matching shape. The adapters in `hono/aws-lambda` and `hono/lambda-edge` translate in both directions: event to `Request`, `app.fetch`, then `Response` to result. Everything else about the app is unchanged ([[Cloudflare, Deno, Bun, Vercel, Netlify and Service Worker Adapters]] covers the fetch-based runtimes).

Sources: [src/adapter/aws-lambda/handler.ts:239-276](repo://src/adapter/aws-lambda/handler.ts#L239-L276), [src/adapter/lambda-edge/handler.ts:116-147](repo://src/adapter/lambda-edge/handler.ts#L116-L147)

```ts
import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'

const app = new Hono()
app.get('/hello', (c) => c.json({ message: 'Hello from Lambda' }))

export const handler = handle(app)
```

Sources: [src/adapter/aws-lambda/handler.ts:239-252](repo://src/adapter/aws-lambda/handler.ts#L239-L252)

## handle

### Request flow

`handle(app, { isContentTypeBinary? })` returns `async (event, lambdaContext) => result`, which runs four steps.

Sources: [src/adapter/aws-lambda/handler.ts:252-254](repo://src/adapter/aws-lambda/handler.ts#L252-L254)

1. `getProcessor(event)` picks the processor for the event type.
2. `processor.createRequest(event)` builds a `Request`. A `TypeError` while doing so (an invalid URL or header) produces a `400 Invalid request`; any other error a `500`. Both are still converted to a proper result rather than thrown.
3. `app.fetch(req, { event, requestContext, lambdaContext })` runs the app, so handlers read the raw event as `c.env.event`, the request context as `c.env.requestContext` and the Lambda context as `c.env.lambdaContext`.
4. `processor.createResult(event, res, options)` builds the result object.

Sources: [src/adapter/aws-lambda/handler.ts:239-276](repo://src/adapter/aws-lambda/handler.ts#L239-L276)

### Choosing a processor

| Event | Detected by | Processor |
| --- | --- | --- |
| ALB | `requestContext.elb` | `ALBProcessor` |
| API Gateway HTTP API (v2), function URLs | `rawPath` and `requestContext.http` | `EventV2Processor` |
| VPC Lattice v2 | `requestContext.serviceArn` | `LatticeV2Processor` |
| API Gateway REST API (v1) | anything else | `EventV1Processor` |

Sources: [src/adapter/aws-lambda/handler.ts:625-658](repo://src/adapter/aws-lambda/handler.ts#L625-L658)

## Building the Request

`EventProcessor.createRequest` is shared. The URL is `https://<domain><path>?<query>`, where the domain comes from `requestContext.domainName` or the `Host` header. The body, when present, is base64-decoded if `isBase64Encoded` is set, otherwise UTF-8 encoded, and `Content-Length` is set from its byte length.

Sources: [src/adapter/aws-lambda/handler.ts:291-342](repo://src/adapter/aws-lambda/handler.ts#L291-L342)

Each processor supplies the parts that differ.

Sources: [src/adapter/aws-lambda/handler.ts:278-289](repo://src/adapter/aws-lambda/handler.ts#L278-L289)

| Processor | Path, method | Query string | Headers and cookies |
| --- | --- | --- | --- |
| v2 | `rawPath`, `requestContext.http.method` | `rawQueryString` as sent | `headers`, plus the separate `cookies` array joined into one `Cookie` header |
| v1 | `path`, `httpMethod` | Rebuilt from `multiValueQueryStringParameters` (all values) or `queryStringParameters`, URL-encoded | `multiValueHeaders` appended, then `headers` not already present |
| ALB | `path`, `httpMethod` | Rebuilt from multi-value parameters when present, so repeated keys keep every value | Multi-value headers joined with `; `, `Cookie` added separately |
| Lattice | `path`, `method` | none | Multi-value `headers` appended |

Sources: [src/adapter/aws-lambda/handler.ts:404-499](repo://src/adapter/aws-lambda/handler.ts#L404-L499), [src/adapter/aws-lambda/handler.ts:503-621](repo://src/adapter/aws-lambda/handler.ts#L503-L621)

Header values containing non-ASCII characters are percent-encoded with `sanitizeHeaderValue`, because the `Headers` constructor throws on them and API Gateway can deliver raw UTF-8.

Sources: [src/adapter/aws-lambda/handler.ts:13-21](repo://src/adapter/aws-lambda/handler.ts#L13-L21)

## Building the result

`createResult` decides whether the body must be base64-encoded. By default, `defaultIsContentTypeBinary` treats everything except `text/plain`, `text/html`, `text/css`, `text/javascript`, `text/csv` and JSON or XML types (including `+json` and `+xml`) as binary; a custom `isContentTypeBinary` option replaces that test. A `Content-Encoding` other than `identity` (such as gzip from the compress middleware) also forces base64.

Sources: [src/adapter/aws-lambda/handler.ts:344-360](repo://src/adapter/aws-lambda/handler.ts#L344-L360), [src/adapter/aws-lambda/handler.ts:666-674](repo://src/adapter/aws-lambda/handler.ts#L666-L674)

The result has `statusCode`, `body` and `isBase64Encoded`, plus `multiValueHeaders` if the event used them and `headers` otherwise. `Set-Cookie` is handled before other headers, because a header map can hold only one value per name.

Sources: [src/adapter/aws-lambda/handler.ts:388-401](repo://src/adapter/aws-lambda/handler.ts#L388-L401)

| Event | Cookies are returned as |
| --- | --- |
| v2 | The top-level `cookies` array |
| v1 | `multiValueHeaders['set-cookie']` |
| ALB | `multiValueHeaders['set-cookie']`, or only the first cookie in `headers` when multi-value headers are off |
| Lattice | An array in `headers['set-cookie']` |

Sources: [src/adapter/aws-lambda/handler.ts:361-401](repo://src/adapter/aws-lambda/handler.ts#L361-L401), [src/adapter/aws-lambda/handler.ts:423-425](repo://src/adapter/aws-lambda/handler.ts#L423-L425), [src/adapter/aws-lambda/handler.ts:494-498](repo://src/adapter/aws-lambda/handler.ts#L494-L498), [src/adapter/aws-lambda/handler.ts:572-579](repo://src/adapter/aws-lambda/handler.ts#L572-L579), [src/adapter/aws-lambda/handler.ts:615-620](repo://src/adapter/aws-lambda/handler.ts#L615-L620)

ALB only returns all cookies when "multi value headers" is enabled on the target group.

Sources: [src/adapter/aws-lambda/handler.ts:572-579](repo://src/adapter/aws-lambda/handler.ts#L572-L579)

## streamHandle

`streamHandle(app)` wraps the handler with `awslambda.streamifyResponse` for Lambda response streaming (function URLs with `RESPONSE_STREAM` invoke mode). It builds the request the same way, calls `app.fetch(req, { event, requestContext, context })`, then sends the status, headers and cookies as metadata through `awslambda.HttpResponseStream.from` and copies the body stream chunk by chunk to Lambda's writable stream. This keeps [[Streaming and Server-Sent Events]] and streamed JSX working on Lambda. Errors are logged and end the stream with `Internal Server Error`, since the status may already have been sent.

Sources: [src/adapter/aws-lambda/handler.ts:126-193](repo://src/adapter/aws-lambda/handler.ts#L126-L193)

`getConnInfo` from the same module reads the client address from the event ([[Connection Info and IP Restriction]]).

Sources: [src/adapter/aws-lambda/index.ts:1-14](repo://src/adapter/aws-lambda/index.ts#L1-L14)

## Lambda@Edge

### Request and response

`handle(app)` from `hono/lambda-edge` accepts a CloudFront event. `createRequest` builds the URL from the `Host` header (or the distribution's domain name), the `uri` and the `querystring`, copies CloudFront's list-style headers, and decodes the body when it is included and the method is not `GET` or `HEAD`. `createResult` returns `{ status, headers, body, bodyEncoding? }` with CloudFront's `{ key, value }[]` header format, using base64 for binary types or a non-identity content encoding.

Sources: [src/adapter/lambda-edge/handler.ts:105-218](repo://src/adapter/lambda-edge/handler.ts#L105-L218)

### Passing requests through to the origin

On viewer-request and origin-request triggers, a function often modifies the request and lets CloudFront continue rather than answering. The adapter passes `c.env.callback` for this, plus `event`, `context`, `config`, `request` and `response` (the CloudFront request and response objects). When a handler calls `c.env.callback(null, request)`, the first callback result is recorded and returned instead of the app's response, so CloudFront forwards the (possibly modified) request. A callback error is thrown.

Sources: [src/adapter/lambda-edge/handler.ts:116-147](repo://src/adapter/lambda-edge/handler.ts#L116-L147)

```ts
app.get('*', async (c, next) => {
  await next()
  c.env.request.headers['x-from-edge'] = [{ key: 'X-From-Edge', value: 'yes' }]
  c.env.callback(null, c.env.request)
})
```

Sources: [src/adapter/lambda-edge/handler.ts:128-145](repo://src/adapter/lambda-edge/handler.ts#L128-L145)

The module sets `globalThis.crypto` from `node:crypto` when missing, because older Lambda@Edge Node.js runtimes lack the Web Crypto global that JWT, cookies and ETag rely on.

Sources: [src/adapter/lambda-edge/handler.ts:1-8](repo://src/adapter/lambda-edge/handler.ts#L1-L8)
