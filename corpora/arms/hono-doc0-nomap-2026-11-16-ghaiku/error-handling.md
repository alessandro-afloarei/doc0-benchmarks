---
title: "Error Handling"
---
## Overview

An error in a request can end in three ways: a handler throws, a request matches no route, or a handler asks for a specific status with `HTTPException`. Each way has a default answer, and an application can replace the two handlers that produce them. This page covers the defaults, the `onError` and `notFound` hooks, `HTTPException`, and the place where the validator raises a 400. The dispatch code that calls these handlers is on [[Request Dispatch]].

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42)

## Default responses

The default not-found handler answers every unmatched request with status 404 and the text `404 Not Found`. The default error handler has two branches. An error with a `getResponse` method is answered with the response that method returns. Any other error is logged with `console.error` and answered with status 500 and the text `Internal Server Error`.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42)

The two defaults are stored in the app as `#notFoundHandler` and `errorHandler`. Both are replaced by the public methods `notFound` and `onError`, which store the new function and return the app for chaining.

Sources: [src/hono-base.ts:186-188](repo://src/hono-base.ts#L186-L188), [src/hono-base.ts:271-274](repo://src/hono-base.ts#L271-L274), [src/hono-base.ts:291-294](repo://src/hono-base.ts#L291-L294)

## HTTPException

`HTTPException` is an `Error` with a `status` and an optional `res`. Its constructor takes the status, which defaults to 500, and options for `message`, `cause` and `res`. The message is passed to the `Error` base class, so `err.message` holds it.

Sources: [src/http-exception.ts:46-59](repo://src/http-exception.ts#L46-L59)

`getResponse` builds the response for the exception. With a `res` option it copies that response's body and headers, with the exception's status. Without one it returns a plain `Response` with the message as body and the status. The default error handler calls `getResponse` for any error that has the method, so a handler can throw an `HTTPException` and get that status back.

Sources: [src/http-exception.ts:66-77](repo://src/http-exception.ts#L66-L77), [src/hono-base.ts:35-39](repo://src/hono-base.ts#L35-L39)

When a custom `onError` is set, it receives the same `HTTPException` and must produce the response itself. The default handler's `getResponse` branch is not run in that case, so a custom handler that wants the exception's status calls `getResponse` or reads `err.status`.

Sources: [src/http-exception.ts:46-47](repo://src/http-exception.ts#L46-L47), [src/hono-base.ts:399-404](repo://src/hono-base.ts#L399-L404)

## Where the framework raises errors

The validator raises `HTTPException(400)` when a JSON body is not valid JSON, with the message `Malformed JSON in request body`. It raises the same status when a form body cannot be parsed, and adds the parser's message to `Malformed FormData request.`. Both throw before the validation function runs.

Sources: [src/validator/validator.ts:94-104](repo://src/validator/validator.ts#L94-L104), [src/validator/validator.ts:113-126](repo://src/validator/validator.ts#L113-L126)

The `Context` has its own `notFound` method. It runs the not-found handler the app has, and when none was set it returns an empty `Response`.

Sources: [src/context.ts:776-779](repo://src/context.ts#L776-L779)

## Errors inside a chain

In a chain, the runner catches the error and passes it to the error handler, after storing it in `c.error`. A middleware can therefore read `c.error` after `await next()` and act on it, such as adding a header. The handler's response replaces any response that an earlier middleware had set.

Sources: [src/compose.ts:49-60](repo://src/compose.ts#L49-L60), [src/context.ts:333-334](repo://src/context.ts#L333-L334)

A thrown value that is not an `Error` is not passed to the handler. The runner rethrows it, and the dispatch code's `catch` hands it to `#handleError`, which rethrows it again, so the runtime receives the original value. [[Middleware Composition]] covers the runner.

Sources: [src/compose.ts:52-59](repo://src/compose.ts#L52-L59), [src/hono-base.ts:399-404](repo://src/hono-base.ts#L399-L404), [src/hono-base.ts:452-464](repo://src/hono-base.ts#L452-L464)
