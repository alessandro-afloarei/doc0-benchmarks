---
title: "Streaming and SSE"
---
## Overview

The streaming helpers send a response that is written in pieces while a callback runs. `stream` and `streamText` pass a `StreamingApi` to a callback that writes chunks; `streamSSE` passes an `SSEStreamingApi` that also frames each write as a Server-Sent Events message. All three are built on one pair of classes, a `TransformStream` with a writer on one side and a `ReadableStream` on the other. This page covers that core, the text and SSE variants, and what happens when a callback fails or the client disconnects. Streaming JSX pages is on [[JSX Rendering]].

Sources: [src/helper/streaming/stream.ts:7-12](repo://src/helper/streaming/stream.ts#L7-L12), [src/utils/stream.ts:6-24](repo://src/utils/stream.ts#L6-L24)

## The core stream

`stream(c, cb, onError)` creates the `TransformStream`, wraps its ends in a `StreamingApi`, and starts the callback without waiting for it. The response it returns is built from the readable side. The callback therefore runs while the response is already on its way to the client.

Sources: [src/helper/streaming/stream.ts:7-14](repo://src/helper/streaming/stream.ts#L7-L14), [src/helper/streaming/stream.ts:44-45](repo://src/helper/streaming/stream.ts#L44-L45)

`StreamingApi.write` encodes a string as UTF-8 and writes it to the writer, and a failed write is ignored. `writeln` adds a newline. `sleep` waits for the given milliseconds. `pipe` releases the writer, copies another stream into the output without closing it, and then takes the writer back. `close` marks the stream closed and closes the writer.

Sources: [src/utils/stream.ts:48-67](repo://src/utils/stream.ts#L48-L67), [src/utils/stream.ts:69-82](repo://src/utils/stream.ts#L69-L82)

The stream closes itself when the callback returns, and when it throws. An error with an `onError` callback is handed to that callback, and any other error is logged with `console.error`. An `undefined` rejection, which happens when the reader is cancelled, is ignored.

Sources: [src/helper/streaming/stream.ts:26-42](repo://src/helper/streaming/stream.ts#L26-L42)

## Text streams

`streamText` sets three headers before calling `stream`: `Content-Type: text/plain; charset=UTF-8`, `X-Content-Type-Options: nosniff`, and `Transfer-Encoding: chunked`. Otherwise it is the same as `stream`.

Sources: [src/helper/streaming/text.ts:6-15](repo://src/helper/streaming/text.ts#L6-L15)

## Server-Sent Events

`streamSSE` sets `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `Connection: keep-alive` before the callback runs. It then runs the callback through `run`, which closes the stream at the end in all cases.

Sources: [src/helper/streaming/sse.ts:72-100](repo://src/helper/streaming/sse.ts#L72-L100)

`writeSSE` takes a message with `data` and optional `event`, `id` and `retry`. The data is resolved first, and each of its lines gets its own `data:` prefix, so a multi-line value is a multi-line event. The `event`, `id` and `retry` fields may not contain a carriage return or a newline. The message ends with a blank line.

Sources: [src/helper/streaming/sse.ts:6-44](repo://src/helper/streaming/sse.ts#L6-L44)

When the callback throws an `Error` and an `onError` is given, `run` calls `onError` and then writes an `error` event with the message as its data. Without `onError` the error is logged, and the stream is closed without an error event.

Sources: [src/helper/streaming/sse.ts:47-68](repo://src/helper/streaming/sse.ts#L47-L68)

## Disconnects

The readable side has a `cancel` handler, which calls `abort` when the stream has not been closed. `abort` runs each registered subscriber once. The first subscriber cancels the reader that feeds the response, so a client that disconnects ends the stream, and a write that waits on the writer stops blocking. `onAbort` adds a subscriber.

Sources: [src/utils/stream.ts:35-45](repo://src/utils/stream.ts#L35-L45), [src/utils/stream.ts:84-97](repo://src/utils/stream.ts#L84-L97), [src/utils/stream.ts:21-33](repo://src/utils/stream.ts#L21-L33)

Some Bun versions do not call `cancel` on a response stream. For those, the helpers listen for the request's `abort` signal. The check looks at the Bun version string. The context is also kept in a `WeakMap` keyed by the response stream, so that Bun does not discard it while the stream is still in use.

Sources: [src/helper/streaming/stream.ts:15-25](repo://src/helper/streaming/stream.ts#L15-L25), [src/helper/streaming/utils.ts:1-11](repo://src/helper/streaming/utils.ts#L1-L11)
