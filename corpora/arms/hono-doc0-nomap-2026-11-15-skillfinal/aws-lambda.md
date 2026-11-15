---
title: "AWS Lambda and Lambda@Edge"
---
## Overview

AWS invokes a Lambda function with a JSON event and expects a JSON result, not a `Request` and a `Response`. The adapters in `hono/aws-lambda` and `hono/lambda-edge` convert in both directions around a normal `app.fetch` call, and pass the original event and context to the app as bindings so handlers can still read them through `c.env` ([[Context]]).

Sources: [src/adapter/aws-lambda/handler.ts:239-276](repo://src/adapter/aws-lambda/handler.ts#L239-L276), [src/adapter/lambda-edge/handler.ts:116-147](repo://src/adapter/lambda-edge/handler.ts#L116-L147)

| Entry point | Event sources | Result |
| --- | --- | --- |
| `handle(app, { isContentTypeBinary })` | API Gateway REST (v1), HTTP API and function URLs (v2), Application Load Balancer, VPC Lattice | buffered `APIGatewayProxyResult` |
| `streamHandle(app)` | the same events | streamed through `awslambda.streamifyResponse` |
| `handle(app)` from `hono/lambda-edge` | CloudFront Lambda@Edge events | CloudFront result, or whatever the app passes to `callback` |

Sources: [src/adapter/aws-lambda/index.ts:1-14](repo://src/adapter/aws-lambda/index.ts#L1-L14), [src/adapter/aws-lambda/handler.ts:138-193](repo://src/adapter/aws-lambda/handler.ts#L138-L193), [src/adapter/aws-lambda/handler.ts:239-276](repo://src/adapter/aws-lambda/handler.ts#L239-L276), [src/adapter/lambda-edge/handler.ts:116-147](repo://src/adapter/lambda-edge/handler.ts#L116-L147)

## Choosing an event processor

`getProcessor(event)` inspects the event and returns one of four `EventProcessor` instances:

Sources: [src/adapter/aws-lambda/handler.ts:625-658](repo://src/adapter/aws-lambda/handler.ts#L625-L658)

| Test | Processor |
| --- | --- |
| `requestContext` has `elb` | `ALBProcessor` |
| event has `rawPath` and `requestContext` has `http` | `EventV2Processor` |
| `requestContext` has `serviceArn` | `LatticeV2Processor` |
| otherwise | `EventV1Processor` |

Sources: [src/adapter/aws-lambda/handler.ts:625-658](repo://src/adapter/aws-lambda/handler.ts#L625-L658)

The v2 test requires both fields because, as the code comment explains, a v1 REST event behind a custom domain base path mapping also carries `rawPath`.

Sources: [src/adapter/aws-lambda/handler.ts:646-651](repo://src/adapter/aws-lambda/handler.ts#L646-L651)

## Building the Request

### Shared steps

`EventProcessor.createRequest` builds `https://{domain}{path}?{query}`. The domain is `requestContext.domainName` when present, else the `host` header (from `headers` or `multiValueHeaders`). A body is base64-decoded when `isBase64Encoded` is set, otherwise UTF-8 encoded, and `content-length` is set from its byte length.

Sources: [src/adapter/aws-lambda/handler.ts:278-342](repo://src/adapter/aws-lambda/handler.ts#L278-L342)

### Per processor

| Processor | Path, method | Query string | Headers and cookies |
| --- | --- | --- | --- |
| v2 | `rawPath`, `requestContext.http.method` | `rawQueryString` | `headers`; the `cookies` array joined into `Cookie` |
| v1 | `path`, `httpMethod` | rebuilt from `multiValueQueryStringParameters` or `queryStringParameters`, re-encoding values API Gateway decoded | `multiValueHeaders` appended, then `headers` not already present |
| ALB | `path`, `httpMethod` | from multi-value parameters first, as given | `multiValueHeaders` joined with `; `, else `headers`; `cookie` copied to `Cookie` |
| Lattice | `path`, `method` | empty | every value of the multi-value `headers` |

Sources: [src/adapter/aws-lambda/handler.ts:404-501](repo://src/adapter/aws-lambda/handler.ts#L404-L501), [src/adapter/aws-lambda/handler.ts:503-622](repo://src/adapter/aws-lambda/handler.ts#L503-L622)

Header values containing non-ASCII characters are percent-encoded with `encodeURIComponent` by `sanitizeHeaderValue` in the v1, ALB and Lattice processors; values that are pure ASCII pass through unchanged.

Sources: [src/adapter/aws-lambda/handler.ts:13-21](repo://src/adapter/aws-lambda/handler.ts#L13-L21), [src/adapter/aws-lambda/handler.ts:474-492](repo://src/adapter/aws-lambda/handler.ts#L474-L492)

## Calling the app

`handle` calls `app.fetch(request, { event, requestContext, lambdaContext })`. If building the request fails, it does not call the app: a `TypeError` becomes `400 Invalid request` and any other error `500 Internal Server Error`, both converted to a Lambda result.

Sources: [src/adapter/aws-lambda/handler.ts:252-276](repo://src/adapter/aws-lambda/handler.ts#L252-L276)

## Building the result

### Body encoding

`createResult` decides whether to base64-encode the body. With the default `defaultIsContentTypeBinary`, anything other than `text/plain`, `text/html`, `text/css`, `text/javascript`, `text/csv` and JSON or XML types counts as binary. A `Content-Encoding` other than `identity` also forces base64. The `isContentTypeBinary` option replaces the content-type test; the doc comment shows extending the default for images and PDFs.

Sources: [src/adapter/aws-lambda/handler.ts:344-359](repo://src/adapter/aws-lambda/handler.ts#L344-L359), [src/adapter/aws-lambda/handler.ts:660-674](repo://src/adapter/aws-lambda/handler.ts#L660-L674), [src/adapter/aws-lambda/handler.ts:224-237](repo://src/adapter/aws-lambda/handler.ts#L224-L237)

### Headers and cookies

The result uses `multiValueHeaders` when the event did, otherwise `headers`. `Set-Cookie` values are taken out of the headers first and placed where each event type expects them:

Sources: [src/adapter/aws-lambda/handler.ts:361-401](repo://src/adapter/aws-lambda/handler.ts#L361-L401)

| Processor | Cookies go to |
| --- | --- |
| v2 | `result.cookies` |
| v1 | `multiValueHeaders['set-cookie']` |
| ALB | `multiValueHeaders['set-cookie']`, or only the first cookie in `headers['set-cookie']` |
| Lattice | `headers['set-cookie']` as an array |

Sources: [src/adapter/aws-lambda/handler.ts:423-425](repo://src/adapter/aws-lambda/handler.ts#L423-L425), [src/adapter/aws-lambda/handler.ts:494-498](repo://src/adapter/aws-lambda/handler.ts#L494-L498), [src/adapter/aws-lambda/handler.ts:572-579](repo://src/adapter/aws-lambda/handler.ts#L572-L579), [src/adapter/aws-lambda/handler.ts:615-620](repo://src/adapter/aws-lambda/handler.ts#L615-L620)

## Response streaming

`streamHandle(app)` wraps its handler in `awslambda.streamifyResponse`, a global provided by the Lambda runtime. It builds the request the same way, calls `app.fetch` with `{ event, requestContext, context }`, then opens the response stream with `awslambda.HttpResponseStream.from` and metadata holding the status, headers and `Set-Cookie` values as `cookies`. The body is copied chunk by chunk from the web stream to the Node stream. Any error is logged and `Internal Server Error` is written to the stream, which is always ended. A body produced with [[Streaming and Server-Sent Events]] is therefore forwarded chunk by chunk as it is read.

Sources: [src/adapter/aws-lambda/handler.ts:126-193](repo://src/adapter/aws-lambda/handler.ts#L126-L193)

## Connection info

`getConnInfo(c)` from `hono/aws-lambda` reads `c.env.requestContext`: `identity.sourceIp` for v1, `http.sourceIp` for v2, and for ALB the last entry of `X-Forwarded-For`, which the comment notes is where ALB appends the client address.

Sources: [src/adapter/aws-lambda/conninfo.ts:1-73](repo://src/adapter/aws-lambda/conninfo.ts#L1-L73)

## Lambda@Edge

### Request and bindings

The Lambda@Edge `handle(app)` builds the request from `event.Records[0].cf.request`: the host header or the distribution's domain name, the URI and query string, every header value, and a body that is base64-decoded when CloudFront says so and ignored for `GET` and `HEAD`. It calls `app.fetch` with `{ event, context, callback, config, request, response }` as bindings.

Sources: [src/adapter/lambda-edge/handler.ts:116-147](repo://src/adapter/lambda-edge/handler.ts#L116-L147), [src/adapter/lambda-edge/handler.ts:164-212](repo://src/adapter/lambda-edge/handler.ts#L164-L212)

### Callback or result

The bindings' `callback` lets a handler return a CloudFront request or response object directly. Only the first call is recorded (and forwarded to Lambda's own callback); if it carried an error the handler throws it, otherwise the callback's result is returned instead of the converted response.

Sources: [src/adapter/lambda-edge/handler.ts:124-146](repo://src/adapter/lambda-edge/handler.ts#L124-L146)

Without a callback, `createResult` returns the status as a string, headers converted to CloudFront's `{ key, value }[]` lists under lower-case names, and the body, base64-encoded with `bodyEncoding: 'base64'` under the same binary rules as Lambda (with `image/svg+xml` also treated as text). `getConnInfo` reads `cf.request.clientIp`.

Sources: [src/adapter/lambda-edge/handler.ts:101-114](repo://src/adapter/lambda-edge/handler.ts#L101-L114), [src/adapter/lambda-edge/handler.ts:149-162](repo://src/adapter/lambda-edge/handler.ts#L149-L162), [src/adapter/lambda-edge/handler.ts:214-218](repo://src/adapter/lambda-edge/handler.ts#L214-L218), [src/adapter/lambda-edge/conninfo.ts:1-15](repo://src/adapter/lambda-edge/conninfo.ts#L1-L15)
