---
title: "Context"
---
## Overview

The `Context` is the object each handler receives as `c`. It holds the request, the bindings, the match result, and the `Response` the handler builds. [[Request Dispatch]] creates one per request, and every middleware and handler in that request shares it. Reading the request goes through `c.req`, which [[HonoRequest]] describes.

Sources: [src/context.ts:293-300](repo://src/context.ts#L293-L300), [src/hono-base.ts:421-427](repo://src/hono-base.ts#L421-L427)

## Creating the response

The constructor keeps the raw `Request`, the bindings, the path, the match result and the not-found handler. The `res` getter creates an empty `Response` the first time it is read, and it uses the headers collected so far, so a handler can set headers before any body exists.

Sources: [src/context.ts:352-360](repo://src/context.ts#L352-L360), [src/context.ts:403-406](repo://src/context.ts#L403-L406)

The `res` setter is where a response becomes final. When an earlier response exists, the new one is built with its body, and the earlier response's headers are copied across except `content-type`. `set-cookie` values are copied one by one so none are lost. The setter then sets `finalized` to `true`, which is the flag [[Request Dispatch]] checks.

Sources: [src/context.ts:414-435](repo://src/context.ts#L414-L435)

## Headers and status

`header` writes to the response that is in progress, or to a prepared set of headers when no response exists yet. If the context is already finalized, `header` first copies the response so that its headers can be changed. A `undefined` value deletes the header, and `append: true` adds a second value.

Sources: [src/context.ts:515-527](repo://src/context.ts#L515-L527)

`status` stores a status code. The next response built by the helpers uses it unless the helper receives an explicit status.

Sources: [src/context.ts:529-531](repo://src/context.ts#L529-L531), [src/context.ts:604-640](repo://src/context.ts#L604-L640)

## Response helpers

Most helpers go through the private `#newResponse` method; the `text` fast path described below is the exception. It starts from the headers already on the context, copies headers from an init object or a `headers` argument, and takes the status from a number argument, from the init object, or from `status`. Its result is a new `Response` with those values.

Sources: [src/context.ts:604-640](repo://src/context.ts#L604-L640)

`body` passes the data through unchanged. `text` and `json` add a default `Content-Type` before calling `#newResponse`: `text/plain; charset=UTF-8` for `text`, and `application/json` for `json`, which first passes its object to `JSON.stringify`. A caller's own `Content-Type` header is kept.

Sources: [src/context.ts:664-668](repo://src/context.ts#L664-L668), [src/context.ts:682-697](repo://src/context.ts#L682-L697), [src/context.ts:708-720](repo://src/context.ts#L708-L720), [src/context.ts:281-286](repo://src/context.ts#L281-L286)

`text` takes a fast path. When no header, status or argument has been set and the context is not finalized, it returns `new Response(text)` directly, which skips the header merge.

Sources: [src/context.ts:682-696](repo://src/context.ts#L682-L696)

`html` accepts a string or a promise of one. A promise is resolved with the HTML escape step before the response is built, and the default type is `text/html; charset=UTF-8`.

Sources: [src/context.ts:723-731](repo://src/context.ts#L723-L731)

`redirect` sets the `Location` header, encoding any character above `\x00-\xFF` with `encodeURI`, and returns an empty response with status 302 unless a status is given.

Sources: [src/context.ts:750-765](repo://src/context.ts#L750-L765)

## Values across handlers

`set` and `get` keep values in a `Map` created on first use, scoped to the request. `var` returns the same values as a read-only object, and returns an empty object when nothing has been set. The typings for these methods come from the `Variables` field of the app's environment type.

Sources: [src/context.ts:546-560](repo://src/context.ts#L546-L560), [src/context.ts:571-580](repo://src/context.ts#L571-L580), [src/context.ts:593-603](repo://src/context.ts#L593-L603)

## Layouts and render

`render` uses a renderer set with `setRenderer`. If none is set, it falls back to `html`, so `c.render('text')` returns an HTML response. `setLayout` and `getLayout` store a layout function on the context, and the `jsx-renderer` middleware uses them to wrap rendered content. [[JSX Server Rendering]] explains how JSX becomes that content.

Sources: [src/context.ts:448-457](repo://src/context.ts#L448-L457), [src/context.ts:459-500](repo://src/context.ts#L459-L500)

## Pages

- [[HonoRequest]] reads the request that `c.req` wraps.
- [[Built-in Middleware]] lists the middleware that call these helpers.

Sources: [src/context.ts:366-370](repo://src/context.ts#L366-L370)
