---
title: "HonoRequest"
---
## Overview

`c.req` is a `HonoRequest` that wraps the raw `Request` of the current call. It reads path parameters from the route match, query strings and headers from the URL and the request, and bodies through the Web Standard body readers. It also returns data that a validator stored for the handler. The class is created lazily the first time a handler reads `c.req`, from the pieces that [[Request Dispatch]] passes to the `Context`.

Sources: [src/request.ts:36-72](repo://src/request.ts#L36-L72), [src/context.ts:366-370](repo://src/context.ts#L366-L370)

## Path parameters

`param(name)` reads the value for one parameter. It uses `routeIndex` to find the parameter map of the handler that is running, because the compose loop sets that index before each handler. A value is decoded only when it contains a `%`. Without a name, `param()` returns all of them.

Sources: [src/request.ts:102-109](repo://src/request.ts#L102-L109), [src/request.ts:112-123](repo://src/request.ts#L112-L123)

The parameter map holds indexes into the router's parameter stash when the regular-expression router is used, and the values themselves otherwise. `#getParamValue` resolves either form, so handlers see the same string whichever router answered.

Sources: [src/request.ts:126-128](repo://src/request.ts#L126-L128)

## Query and headers

`query(key)` and `queries(key)` parse the URL's query string. `query()` returns a record of single values, and `queries()` returns arrays for repeated keys. Both read the URL on each call, and neither caches the result.

Sources: [src/request.ts:150-152](repo://src/request.ts#L150-L152), [src/request.ts:169-171](repo://src/request.ts#L169-L171)

`header(name)` reads one header from the raw request. Without a name it copies every header into a plain object with lowercase keys, so the result is safe to change.

Sources: [src/request.ts:188-197](repo://src/request.ts#L188-L197)

## Reading the body

`json`, `text`, `arrayBuffer`, `bytes`, `blob` and `formData` each read the body once and keep the result in `bodyCache`. A later reader takes the cached promise. If another format is already cached, the reader converts that cached result instead of reading the stream again.

Sources: [src/request.ts:245-335](repo://src/request.ts#L245-L335), [src/request.ts:69-69](repo://src/request.ts#L69-L69)

`#cachedBody` is where that conversion happens. When `text` is cached and `json` is asked for, `json` parses the text. When `json` is cached and text is asked for, the value is stringified and wrapped in a `Response` so that `text()` can read it.

Sources: [src/request.ts:228-244](repo://src/request.ts#L228-L244), [src/request.ts:253-255](repo://src/request.ts#L253-L255)

`parseBody` reads a form only. The content type must be `multipart/form-data` or `application/x-www-form-urlencoded`; any other type returns an empty object. Form data is cached as `formData` so that a later `formData()` call reuses it.

Sources: [src/utils/body.ts:97-115](repo://src/utils/body.ts#L97-L115), [src/utils/body.ts:117-135](repo://src/utils/body.ts#L117-L135), [src/request.ts:212-220](repo://src/request.ts#L212-L220)

## Validated data

`addValidatedData(target, data)` stores the output of a validator under its target name, such as `json` or `query`. `valid(target)` returns the stored value. The validator middleware calls `addValidatedData` after its validation function succeeds, and [[Validation]] describes that step.

Sources: [src/request.ts:339-342](repo://src/request.ts#L339-L342), [src/request.ts:352-354](repo://src/request.ts#L352-L354)

## Pages

- [[Context]] explains the `Context` that holds this object.
- [[Router Selection]] explains the matched route that `param` reads.

Sources: [src/request.ts:36-40](repo://src/request.ts#L36-L40)
