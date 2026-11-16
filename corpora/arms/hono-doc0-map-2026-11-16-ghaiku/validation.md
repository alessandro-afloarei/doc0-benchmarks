---
title: "Validation"
---
## Overview

`validator(target, fn)` returns a middleware that reads one part of the request, passes it to `fn`, and stores what `fn` returns so the handler can read it with `c.req.valid(target)`. The middleware stores each result through `addValidatedData`, and `HonoRequest` keeps the stored values as described in [[HonoRequest]]. The request part is named by a target such as `json`, `query` or `header`, and the target names are the keys of the `ValidationTargets` type.

Sources: [src/validator/validator.ts:46-61](repo://src/validator/validator.ts#L46-L61), [src/types.ts:2683-2691](repo://src/types.ts#L2683-L2691)

## What the middleware reads

Each target maps to one read. `query` builds an object from `c.req.queries()`, where a key with one value becomes a string and a repeated key becomes an array. `param` reads all path parameters, `header` reads all headers, and `cookie` uses the cookie helper.

Sources: [src/validator/validator.ts:144-161](repo://src/validator/validator.ts#L144-L161)

`json` and `form` read the body, and each first checks the `Content-Type` header. A body whose type does not match is not read, and the validation function receives an empty value. A `json` body that fails to parse is refused with a 400 `HTTPException` whose message is `Malformed JSON in request body`.

Sources: [src/validator/validator.ts:94-103](repo://src/validator/validator.ts#L94-L103), [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26)

The `form` branch accepts `multipart/form-data` and `application/x-www-form-urlencoded`. It parses the buffer once and caches the result in `c.req.bodyCache.formData`, so a second `form` validator on the same request reuses it. A key that ends in `[]` or repeats is collected into an array.

Sources: [src/validator/validator.ts:105-143](repo://src/validator/validator.ts#L105-L143)

## Result and early response

The validation function runs once with the read value and the `Context`. If it returns a `Response`, the middleware returns that response and the handler never runs, which is how a validator refuses a request. Any other return value is stored with `addValidatedData` under the target name, and the middleware calls `next`.

Sources: [src/validator/validator.ts:162-173](repo://src/validator/validator.ts#L162-L173)

Because the middleware calls `next` after storing the value, it works like any other middleware in the compose loop described in [[Request Dispatch]]. It runs in the position its `use` or route call gives it in the chain.

Sources: [src/validator/validator.ts:89-93](repo://src/validator/validator.ts#L89-L93), [src/compose.ts:32-51](repo://src/compose.ts#L32-L51)

## Factory middleware

`createMiddleware` from the factory helper builds a middleware with the same `(c, next)` shape and typed input, for checks that do not read a single target. It is listed with the other helpers in [[Helper Catalogue]].

Sources: [src/helper/factory/index.ts:353-361](repo://src/helper/factory/index.ts#L353-L361)

## Pages

- [[HonoRequest]] explains `valid` and the body readers that the `json` and `form` targets use.
- [[Built-in Middleware]] lists the middleware that run around validators.

Sources: [src/validator/index.ts:1-8](repo://src/validator/index.ts#L1-L8)
