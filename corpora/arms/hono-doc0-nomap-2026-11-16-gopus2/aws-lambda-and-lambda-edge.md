---
title: "AWS Lambda and Lambda@Edge"
---
## Overview

AWS does not call functions with a `Request`. A Lambda function receives a JSON event describing the HTTP request, whose shape depends on what invoked it, and must return a JSON result. The two AWS adapters translate in both directions around `app.fetch`: `hono/aws-lambda` for API Gateway (REST and HTTP APIs), Application Load Balancers, function URLs and VPC Lattice, with an optional streaming mode; and `hono/lambda-edge` for CloudFront's Lambda@Edge events. The other platforms are covered in [[Runtime Adapters]].

Sources: [src/adapter/aws-lambda/index.ts:1-14](repo://src/adapter/aws-lambda/index.ts#L1-L14), [src/adapter/lambda-edge/index.ts:1-14](repo://src/adapter/lambda-edge/index.ts#L1-L14)

```ts
import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'

const app = new Hono()
app.get('/', (c) => c.text('Hello from Lambda'))

export const handler = handle(app)
```

Sources: [src/adapter/aws-lambda/handler.ts:239-276](repo://src/adapter/aws-lambda/handler.ts#L239-L276)

## The handle function

`handle(app, { isContentTypeBinary })` returns an async Lambda handler. It picks an event processor for the event, builds a `Request`, and calls `app.fetch` with an env holding `event`, `requestContext` and `lambdaContext`, which handlers read as `c.env.event` and so on. The processor then turns the `Response` into the result object. If building the request fails, the error is logged and a `400 Invalid request` (for a `TypeError`, such as a malformed URL) or `500 Internal Server Error` result is returned without calling the app.

Sources: [src/adapter/aws-lambda/handler.ts:239-276](repo://src/adapter/aws-lambda/handler.ts#L239-L276), [src/adapter/aws-lambda/handler.ts:116-124](repo://src/adapter/aws-lambda/handler.ts#L116-L124)

## Event processors

### Detecting the event type

`getProcessor(event)` inspects the event:

Sources: [src/adapter/aws-lambda/handler.ts:625-658](repo://src/adapter/aws-lambda/handler.ts#L625-L658)

| Event | Detected by | Processor |
| --- | --- | --- |
| ALB | `requestContext.elb` present | `ALBProcessor` |
| API Gateway HTTP API (v2), function URL | `rawPath` and `requestContext.http` present | `EventV2Processor` |
| VPC Lattice v2 | `requestContext.serviceArn` present | `LatticeV2Processor` |
| API Gateway REST API (v1) | anything else | `EventV1Processor` |

Sources: [src/adapter/aws-lambda/handler.ts:625-658](repo://src/adapter/aws-lambda/handler.ts#L625-L658)

A comment explains why v2 detection needs both fields: a v1 event behind a custom domain base path mapping also carries `rawPath`, but only v2 events have `requestContext.http`.

Sources: [src/adapter/aws-lambda/handler.ts:646-651](repo://src/adapter/aws-lambda/handler.ts#L646-L651)

### Building the Request

`EventProcessor.createRequest` is shared. The URL is `https://` plus the domain (from `requestContext.domainName`, else the `host` header, else a multi-value `host`), the path and the query string. A body is decoded from Base64 when `isBase64Encoded` is set, otherwise UTF-8 encoded, and `content-length` is set from its byte length. Subclasses supply the pieces:

Sources: [src/adapter/aws-lambda/handler.ts:278-342](repo://src/adapter/aws-lambda/handler.ts#L278-L342)

| Processor | Path, method | Query string | Headers and cookies |
| --- | --- | --- | --- |
| v2 | `rawPath`, `requestContext.http.method` | `rawQueryString` as is | `headers`; the `cookies` array joined into one `Cookie` header |
| v1 | `path`, `httpMethod` | Rebuilt from `multiValueQueryStringParameters` or `queryStringParameters`, re-encoded because API Gateway passes decoded values | `multiValueHeaders` appended, then single `headers` not already present |
| ALB | `path`, `httpMethod` | Rebuilt from the multi-value or single parameters, without re-encoding | `multiValueHeaders` joined with `; `, or `headers` |
| Lattice | `path`, `method` | none | Every value of each header appended |

Sources: [src/adapter/aws-lambda/handler.ts:404-501](repo://src/adapter/aws-lambda/handler.ts#L404-L501), [src/adapter/aws-lambda/handler.ts:503-622](repo://src/adapter/aws-lambda/handler.ts#L503-L622)

Header values containing non-ASCII characters are percent-encoded by `sanitizeHeaderValue` before they are added (in every processor except v2).

Sources: [src/adapter/aws-lambda/handler.ts:13-21](repo://src/adapter/aws-lambda/handler.ts#L13-L21), [src/adapter/aws-lambda/handler.ts:474-492](repo://src/adapter/aws-lambda/handler.ts#L474-L492)

## Building the result

### Body encoding

`createResult` decides whether to Base64-encode the body. It does when `isContentTypeBinary(contentType)` is true, or when `Content-Encoding` is anything but `identity` (a compressed body is binary whatever its type). The default `defaultIsContentTypeBinary` treats everything as binary except `text/plain`, `text/html`, `text/css`, `text/javascript`, `text/csv`, and JSON or XML types including `+json` and `+xml`; the `isContentTypeBinary` option replaces it.

Sources: [src/adapter/aws-lambda/handler.ts:344-359](repo://src/adapter/aws-lambda/handler.ts#L344-L359), [src/adapter/aws-lambda/handler.ts:659-674](repo://src/adapter/aws-lambda/handler.ts#L659-L674)

### Headers and cookies

The result has `statusCode`, `body` and `isBase64Encoded`, plus `multiValueHeaders` when the incoming event used them and `headers` otherwise, so the response matches the event's format. `Set-Cookie` values are removed from the headers first and placed where each integration expects them: the `cookies` array for v2, `multiValueHeaders['set-cookie']` for v1, the multi-value header or only the first cookie in a single `set-cookie` header for ALB, and a `set-cookie` array in `headers` for Lattice.

Sources: [src/adapter/aws-lambda/handler.ts:361-401](repo://src/adapter/aws-lambda/handler.ts#L361-L401), [src/adapter/aws-lambda/handler.ts:423-425](repo://src/adapter/aws-lambda/handler.ts#L423-L425), [src/adapter/aws-lambda/handler.ts:494-498](repo://src/adapter/aws-lambda/handler.ts#L494-L498), [src/adapter/aws-lambda/handler.ts:572-579](repo://src/adapter/aws-lambda/handler.ts#L572-L579), [src/adapter/aws-lambda/handler.ts:615-620](repo://src/adapter/aws-lambda/handler.ts#L615-L620)

## Response streaming

`streamHandle(app)` wraps the handler in `awslambda.streamifyResponse`, the Lambda runtime's streaming API. It builds the request the same way and calls `app.fetch` with `event`, `requestContext` and `context`, then creates an `HttpResponseStream` with the status, the headers and the `Set-Cookie` values as `cookies`. The response body is read chunk by chunk and written to the Node stream as it arrives, so [[Streaming and Server-Sent Events]] work end to end. An error is logged and `Internal Server Error` is written; the stream is always ended.

Sources: [src/adapter/aws-lambda/handler.ts:126-193](repo://src/adapter/aws-lambda/handler.ts#L126-L193)

## Lambda@Edge

### Request and result

`hono/lambda-edge`'s `handle(app)` reads the first CloudFront record. The URL uses the `host` header or the distribution's domain name, the `uri` and the `querystring`; headers are copied from CloudFront's `{ key, value }` lists; and a body is used only for methods other than `GET` and `HEAD`, decoded from Base64 when CloudFront says so. The module also sets `globalThis.crypto` from `node:crypto` when it is missing.

Sources: [src/adapter/lambda-edge/handler.ts:1-8](repo://src/adapter/lambda-edge/handler.ts#L1-L8), [src/adapter/lambda-edge/handler.ts:164-212](repo://src/adapter/lambda-edge/handler.ts#L164-L212)

The result is CloudFront's shape: `status` as a string, headers converted back to lower-cased `{ key, value }` lists, and the body, Base64-encoded with `bodyEncoding: 'base64'` when the content type is binary or the content is encoded. The Edge version's binary check also treats `image/svg+xml` as text.

Sources: [src/adapter/lambda-edge/handler.ts:105-114](repo://src/adapter/lambda-edge/handler.ts#L105-L114), [src/adapter/lambda-edge/handler.ts:149-162](repo://src/adapter/lambda-edge/handler.ts#L149-L162), [src/adapter/lambda-edge/handler.ts:214-218](repo://src/adapter/lambda-edge/handler.ts#L214-L218)

### The callback

A Lambda@Edge function often lets the request continue to the origin instead of answering. The env passed to `app.fetch` holds `event`, `context`, `config`, `request`, `response` and a `callback`. A handler that calls `c.env.callback(null, c.env.request)`, possibly after modifying the request, makes `handle` return that value instead of the Hono response; an error passed to the callback is thrown. Only the first callback call is recorded, and Lambda's own callback is invoked too when one was given.

Sources: [src/adapter/lambda-edge/handler.ts:116-147](repo://src/adapter/lambda-edge/handler.ts#L116-L147)

```ts
import { handle } from 'hono/lambda-edge'

app.get('*', async (c, next) => {
  await next()
  c.env.callback(null, c.env.request) // forward to the origin
})

export const handler = handle(app)
```

Sources: [src/adapter/lambda-edge/handler.ts:124-146](repo://src/adapter/lambda-edge/handler.ts#L124-L146)

## Client address

`getConnInfo` from `hono/aws-lambda` reads `requestContext.identity.sourceIp` for API Gateway v1 and `requestContext.http.sourceIp` for v2. For ALB, which has neither, it takes the last address in `X-Forwarded-For`, where the comment says ALB appends the real client IP. The Lambda@Edge version returns CloudFront's `clientIp`.

Sources: [src/adapter/aws-lambda/conninfo.ts:45-73](repo://src/adapter/aws-lambda/conninfo.ts#L45-L73), [src/adapter/lambda-edge/conninfo.ts:1-15](repo://src/adapter/lambda-edge/conninfo.ts#L1-L15)
