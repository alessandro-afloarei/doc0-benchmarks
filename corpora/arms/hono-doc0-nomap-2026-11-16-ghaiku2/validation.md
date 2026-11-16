---
title: "Validation"
---
## Overview

`validator(target, fn)` is a middleware. It reads one part of the request, passes the value to a function that checks or transforms it, and stores the function's result on the request for the handler to read with `c.req.valid(target)`. If the function returns a `Response`, that response ends the chain instead. Reading the request is described in [[Request Object]], and the types of the result are described in [[Type Inference]].

Sources: [src/validator/validator.ts:46-89](repo://src/validator/validator.ts#L46-L89), [src/validator/index.ts:6-7](repo://src/validator/index.ts#L6-L7)

## Targets

The target names one of six parts of the request: `json`, `form`, `query`, `param`, `header` and `cookie`. The middleware reads the matching part before calling the function. The target type is `ValidationTargets`, which gives each target the shape of the value the function receives.

Sources: [src/validator/validator.ts:94-160](repo://src/validator/validator.ts#L94-L160), [src/types.ts:2683-2691](repo://src/types.ts#L2683-L2691)

`query` turns the query string into an object, and a key that appears once maps to a single string while a repeated key maps to an array. `param` gives the path parameters of the handler, `header` gives every header, and `cookie` runs `getCookie`.

Sources: [src/validator/validator.ts:144-158](repo://src/validator/validator.ts#L144-L158)

## Reading a JSON body

For `json`, the middleware parses the body only when the `Content-Type` matches the JSON media-type pattern, which also accepts suffixed types such as `application/problem+json`. A matching body that is not valid JSON raises a `400` `HTTPException` with the message `Malformed JSON in request body`.

Sources: [src/validator/validator.ts:24-24](repo://src/validator/validator.ts#L24-L24), [src/validator/validator.ts:94-104](repo://src/validator/validator.ts#L94-L104)

When the `Content-Type` does not match, the value stays as the empty object set at the start of the middleware, and the function still runs on `{}`. A validation function therefore sees an empty value rather than a missing request, and should check the value it gets.

Sources: [src/validator/validator.ts:89-104](repo://src/validator/validator.ts#L89-L104)

## Reading a form body

For `form`, the middleware accepts `multipart/form-data` and `application/x-www-form-urlencoded`. The body is read once: the parsed `FormData` is stored in `bodyCache.formData`, so another validator on the same request reuses it instead of reading the stream again. A body that fails to parse raises a `400` with `Malformed FormData request.` and the parser's message.

Sources: [src/validator/validator.ts:25-26](repo://src/validator/validator.ts#L25-L26), [src/validator/validator.ts:105-127](repo://src/validator/validator.ts#L105-L127)

The `FormData` is converted to a plain object. A key that ends with `[]` always holds an array. A key that appears twice becomes an array, so the function receives either one value or a list for each field.

Sources: [src/validator/validator.ts:128-141](repo://src/validator/validator.ts#L128-L141)

## Running the function

After the value is read, the function is called with the value and the context. Its result is checked for a `Response` first. A `Response` is returned at once, and the chain does not reach the handler; this is how a validator rejects a request with its own status and body.

Sources: [src/validator/validator.ts:162-166](repo://src/validator/validator.ts#L162-L166)

Any other result is stored with `addValidatedData(target, result)`, and then the middleware calls `next()`. The handler reads the result with `c.req.valid(target)`, so a transformed value, such as a parsed number, is what the handler gets.

Sources: [src/validator/validator.ts:168-171](repo://src/validator/validator.ts#L168-L171), [src/request.ts:339-367](repo://src/request.ts#L339-L367)

```ts
app.post(
  '/items',
  validator('json', (value, c) => {
    if (typeof value.name !== 'string') {
      return c.text('name is required', 400)
    }
    return { name: value.name }
  }),
  (c) => c.json(c.req.valid('json'), 201)
)
```

Sources: [src/validator/validator.ts:162-171](repo://src/validator/validator.ts#L162-L171)

## Failures

A validator does not catch errors from its function: nothing in the middleware wraps the call in `try`. An error the function throws propagates through the chain to the app's error handler, as [[Request Dispatch]] describes. The `400` responses for malformed bodies are raised as `HTTPException` errors, so the same handler turns them into responses.

Sources: [src/validator/validator.ts:100-103](repo://src/validator/validator.ts#L100-L103), [src/validator/validator.ts:120-126](repo://src/validator/validator.ts#L120-L126)
