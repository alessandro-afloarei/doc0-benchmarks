---
title: "AWS Lambda and Lambda@Edge"
---
## Overview

AWS Lambda does not speak `Request` and `Response`: a function receives a JSON event whose shape depends on what invoked it, and must return a JSON result in a matching shape. The `hono/aws-lambda` adapter converts each supported event into a standard `Request`, runs it through `app.fetch` like any other runtime (see [[Request Lifecycle and Middleware Composition]]), and converts the `Response` back. `hono/lambda-edge` does the same for CloudFront's Lambda@Edge events. Other runtimes are covered in [[Runtime Adapters]].

Sources: [src/adapter/aws-lambda/handler.ts:239-276](repo://src/adapter/aws-lambda/handler.ts#L239-L276), [src/adapter/aws-lambda/index.ts:6-14](repo://src/adapter/aws-lambda/index.ts#L6-L14)

```ts
import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'

const app = new Hono()
app.get('/hello', (c) => c.json({ ok: true, ip: c.env.requestContext }))

export const handler = handle(app)
```

Sources: [src/adapter/aws-lambda/handler.ts:239-276](repo://src/adapter/aws-lambda/handler.ts#L239-L276)

## Event sources

`getProcessor(event)` picks one of four `EventProcessor` subclasses by inspecting the event:

Sources: [src/adapter/aws-lambda/handler.ts:625-658](repo://src/adapter/aws-lambda/handler.ts#L625-L658)

| Invoker | Detected by | Processor |
| --- | --- | --- |
| Application Load Balancer | `requestContext.elb` | `ALBProcessor` |
| API Gateway HTTP API (payload 2.0), Lambda Function URL | `rawPath` and `requestContext.http` | `EventV2Processor` |
| VPC Lattice (v2) | `requestContext.serviceArn` | `LatticeV2Processor` |
| API Gateway REST API (payload 1.0), anything else | fallback | `EventV1Processor` |

Sources: [src/adapter/aws-lambda/handler.ts:639-658](repo://src/adapter/aws-lambda/handler.ts#L639-L658)

A REST API event behind a custom domain mapping can also carry `rawPath`, which is why version 2 detection requires the `http` object as well.

Sources: [src/adapter/aws-lambda/handler.ts:646-651](repo://src/adapter/aws-lambda/handler.ts#L646-L651)

## From event to Request

### The shared steps

`EventProcessor.createRequest` builds `https://<domain><path>?<query>`. The domain comes from `requestContext.domainName`, else the `host` header, else the multi-value `host` header. When the event has a body it is base64-decoded if `isBase64Encoded`, otherwise UTF-8 encoded, and `content-length` is set from the byte length.

Sources: [src/adapter/aws-lambda/handler.ts:291-342](repo://src/adapter/aws-lambda/handler.ts#L291-L342)

### What differs per event

| Processor | Path, method | Query string | Headers and cookies |
| --- | --- | --- | --- |
| V2 | `rawPath`, `requestContext.http.method` | `rawQueryString` as sent | `headers`; the separate `cookies` array is joined into `Cookie` |
| V1 | `path`, `httpMethod` | Rebuilt from `multiValueQueryStringParameters` or `queryStringParameters`, re-encoded because API Gateway decodes them | `multiValueHeaders` appended, then `headers` not already present |
| ALB | `path`, `httpMethod` | Rebuilt, preferring the multi-value form, values kept as received | Multi-value headers joined with `; `, else `headers`; cookie from either |
| Lattice | `path`, `method` | none | Every value of each header list |

Sources: [src/adapter/aws-lambda/handler.ts:404-439](repo://src/adapter/aws-lambda/handler.ts#L404-L439), [src/adapter/aws-lambda/handler.ts:443-499](repo://src/adapter/aws-lambda/handler.ts#L443-L499), [src/adapter/aws-lambda/handler.ts:503-580](repo://src/adapter/aws-lambda/handler.ts#L503-L580), [src/adapter/aws-lambda/handler.ts:584-621](repo://src/adapter/aws-lambda/handler.ts#L584-L621)

Header values containing non-ASCII characters are percent-encoded by `sanitizeHeaderValue` for the V1, ALB and Lattice processors, because the `Headers` constructor rejects them and the request would otherwise fail.

Sources: [src/adapter/aws-lambda/handler.ts:13-21](repo://src/adapter/aws-lambda/handler.ts#L13-L21)

### Errors and bindings

If building the request throws, `handle` answers without calling the app: 400 `Invalid request` for a `TypeError` (such as an invalid URL or header), 500 otherwise. Otherwise the app runs with `c.env` set to `{ event, requestContext, lambdaContext }`, so handlers can read the raw event, the request context (authorizer claims, stage, source IP) and the Lambda context.

Sources: [src/adapter/aws-lambda/handler.ts:252-275](repo://src/adapter/aws-lambda/handler.ts#L252-L275)

## From Response to result

`createResult` reads the body as text, or as base64 with `isBase64Encoded: true` when the content is binary. Binary means the content type is not text-like according to `defaultIsContentTypeBinary` (text types such as plain, HTML, CSS, JavaScript and CSV, plus any JSON or XML type, count as text), or the response has a `Content-Encoding` other than `identity`, as produced by `compress`. `handle(app, { isContentTypeBinary })` replaces the content-type rule.

Sources: [src/adapter/aws-lambda/handler.ts:344-386](repo://src/adapter/aws-lambda/handler.ts#L344-L386), [src/adapter/aws-lambda/handler.ts:666-674](repo://src/adapter/aws-lambda/handler.ts#L666-L674)

The result uses `multiValueHeaders` when the event did (V1 or ALB with multi-value headers enabled), and plain `headers` otherwise. `Set-Cookie` needs special care because a plain header map can hold only one value, so `setCookies` removes it from the headers and each processor places the list where its invoker expects it:

Sources: [src/adapter/aws-lambda/handler.ts:361-401](repo://src/adapter/aws-lambda/handler.ts#L361-L401)

| Processor | Cookies go to |
| --- | --- |
| V2 | `result.cookies` |
| V1 | `multiValueHeaders['set-cookie']` |
| ALB | `multiValueHeaders['set-cookie']`, or only the first cookie in `headers` when multi-value headers are off |
| Lattice | `headers['set-cookie']` as an array |

Sources: [src/adapter/aws-lambda/handler.ts:423-425](repo://src/adapter/aws-lambda/handler.ts#L423-L425), [src/adapter/aws-lambda/handler.ts:494-498](repo://src/adapter/aws-lambda/handler.ts#L494-L498), [src/adapter/aws-lambda/handler.ts:572-579](repo://src/adapter/aws-lambda/handler.ts#L572-L579), [src/adapter/aws-lambda/handler.ts:615-620](repo://src/adapter/aws-lambda/handler.ts#L615-L620)

> [!WARNING]
> An ALB target group without multi-value headers can return only one cookie per response. Enable multi-value headers on the target group when the app sets several cookies.

Sources: [src/adapter/aws-lambda/handler.ts:572-579](repo://src/adapter/aws-lambda/handler.ts#L572-L579)

## Response streaming

`streamHandle(app)` is for functions invoked with response streaming (Function URLs with `RESPONSE_STREAM`). It wraps the handler with the runtime's `awslambda.streamifyResponse`, builds the request with the same processors, and passes `{ event, requestContext, context }` as the env (note `context` rather than `lambdaContext`). It then sends the status, headers and cookies as metadata with `awslambda.HttpResponseStream.from` and copies the response body chunk by chunk into the Node.js stream, so output from [[Streaming and Server-Sent Events]] reaches the client as it is produced. An error writes `Internal Server Error` to the stream.

Sources: [src/adapter/aws-lambda/handler.ts:126-193](repo://src/adapter/aws-lambda/handler.ts#L126-L193)

## Client address

`getConnInfo(c)` from `hono/aws-lambda` reads `requestContext.identity.sourceIp` for REST APIs and `requestContext.http.sourceIp` for HTTP APIs and Function URLs. For ALB it takes the last entry of `X-Forwarded-For`, which the load balancer appends.

Sources: [src/adapter/aws-lambda/conninfo.ts:45-73](repo://src/adapter/aws-lambda/conninfo.ts#L45-L73)

## Lambda@Edge

`handle(app)` from `hono/lambda-edge` receives a CloudFront event. `createRequest` builds the URL from the `host` header or the distribution domain, the `uri` and the `querystring`, copies every CloudFront header value, and decodes the body (base64 or text) except for `GET` and `HEAD`.

Sources: [src/adapter/lambda-edge/handler.ts:116-147](repo://src/adapter/lambda-edge/handler.ts#L116-L147), [src/adapter/lambda-edge/handler.ts:164-212](repo://src/adapter/lambda-edge/handler.ts#L164-L212)

The env exposes `event`, `context`, `config`, the CloudFront `request` and `response`, and a `callback`. A handler acting as an origin-request or viewer-request trigger can call `c.env.callback(null, c.env.request)` to pass the (possibly modified) request on to CloudFront instead of answering; the first callback result is returned in place of the app's response, and a callback error is thrown. Otherwise the response becomes a CloudFront result with a string status, lower-cased header lists and `bodyEncoding: 'base64'` for binary content (here SVG also counts as text).

Sources: [src/adapter/lambda-edge/handler.ts:124-162](repo://src/adapter/lambda-edge/handler.ts#L124-L162), [src/adapter/lambda-edge/handler.ts:214-218](repo://src/adapter/lambda-edge/handler.ts#L214-L218)

`getConnInfo` for Lambda@Edge returns the request's `clientIp`.

Sources: [src/adapter/lambda-edge/conninfo.ts:11-15](repo://src/adapter/lambda-edge/conninfo.ts#L11-L15)
