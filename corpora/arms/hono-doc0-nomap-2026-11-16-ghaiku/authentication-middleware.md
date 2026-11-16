---
title: "Authentication Middleware"
---
## Overview

The two built-in authentication middlewares, `basicAuth` and `bearerAuth`, read a credential from the `Authorization` header and either call `next()` or stop the request with a 401 (or 400) response. They do not store the user: the only hook that receives the user name is the `onAuthSuccess` option, which the app supplies. This page explains what each one checks, the options that change its answers, and how a refusal is built. The signed-token middleware is on [[JWT and JWK]].

Sources: [src/middleware/basic-auth/index.ts:80-103](repo://src/middleware/basic-auth/index.ts#L80-L103), [src/middleware/bearer-auth/index.ts:104-121](repo://src/middleware/bearer-auth/index.ts#L104-L121)

## Basic auth

`basicAuth` takes either a `username` and `password` pair in its options, or a `verifyUser` function, and any number of extra user pairs as arguments. A pair given in the options is added to the front of the user list. The function throws at creation if neither form is present, and it sets the defaults `realm` to `Secure Area` and `invalidUserMessage` to `Unauthorized`.

Sources: [src/middleware/basic-auth/index.ts:80-103](repo://src/middleware/basic-auth/index.ts#L80-L103)

The middleware reads the header with `auth`, which accepts only the `Basic` scheme followed by base64 text. The decoded text must contain a colon, and the username is everything before the first colon. A header that does not decode returns no user, and that case is treated the same as a wrong password.

Sources: [src/utils/basic-auth.ts:3-26](repo://src/utils/basic-auth.ts#L3-L26)

With `verifyUser`, the function decides the answer. Without it, each stored pair is compared with `timingSafeEqual` for the username and for the password, and the request passes when one pair matches both. `onAuthSuccess` runs before `next()` in both cases.

Sources: [src/middleware/basic-auth/index.ts:105-130](repo://src/middleware/basic-auth/index.ts#L105-L130), [src/utils/buffer.ts:76-87](repo://src/utils/buffer.ts#L76-L87)

## Bearer auth

`bearerAuth` takes a `token` (a string or an array of strings) or a `verifyToken` function. Its header defaults to `Authorization` and its prefix to `Bearer`, and both can be changed. The default `realm` is an empty string, and a `prefix` of `''` means the header value is the token itself.

Sources: [src/middleware/bearer-auth/index.ts:104-121](repo://src/middleware/bearer-auth/index.ts#L104-L121)

The middleware works in three steps, and each step can refuse the request. First, a missing header is refused with 401. Second, the header must start with the prefix followed by one space, and the rest must match the token pattern `[A-Za-z0-9._~+/-]+=*`; a header that fails this gets 400 with `error="invalid_request"`. Third, the token is compared with the configured tokens, or passed to `verifyToken`, and a mismatch gets 401 with `error="invalid_token"`.

Sources: [src/middleware/bearer-auth/index.ts:156-216](repo://src/middleware/bearer-auth/index.ts#L156-L216)

With an array of tokens, the middleware checks each in turn and stops at the first match. A string token is compared once. An empty array never matches.

Sources: [src/middleware/bearer-auth/index.ts:194-206](repo://src/middleware/bearer-auth/index.ts#L194-L206)

## How a refusal is built

Both middlewares refuse by throwing an `HTTPException` whose `res` is a `Response` they built. The status is 401 for basic auth, and the `WWW-Authenticate` header is `Basic realm="..."`. The body is the configured message, which can be a string, an object sent as JSON, or a function of the context.

Sources: [src/middleware/basic-auth/index.ts:132-151](repo://src/middleware/basic-auth/index.ts#L132-L151), [src/http-exception.ts:66-77](repo://src/http-exception.ts#L66-L77)

Bearer auth builds the same kind of response through a shared helper, and it lets each of the three refusals set its own `WWW-Authenticate` value and message. Those options are `noAuthenticationHeader`, `invalidAuthenticationHeader` and `invalidToken`, and the older flat message options still work.

Sources: [src/middleware/bearer-auth/index.ts:122-154](repo://src/middleware/bearer-auth/index.ts#L122-L154), [src/middleware/bearer-auth/index.ts:17-66](repo://src/middleware/bearer-auth/index.ts#L17-L66)

Because the refusal is an `HTTPException`, it passes through the app's error handler. The default handler returns the exception's own response, so the client sees the 401 with its `WWW-Authenticate` header, as [[Error Handling]] describes.

Sources: [src/hono-base.ts:35-39](repo://src/hono-base.ts#L35-L39)
