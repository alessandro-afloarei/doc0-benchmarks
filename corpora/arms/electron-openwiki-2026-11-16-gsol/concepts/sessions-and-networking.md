---
type: concept
title: Sessions, storage, and networking
description: Session identity and persistence, BrowserContext ownership, protocol scoping, fetch adaptation, and permission handler boundaries.
tags: [session, storage, networking, protocol, permissions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:11:18.304Z
sources:
  - id: openwiki-source-0702fbd38b1811ca32c7bee1
    resource: repo://lib/browser/api/net-fetch.ts
  - id: openwiki-source-c2f667ce02e32cf3333f95b9
    resource: repo://lib/browser/api/net.ts
  - id: openwiki-source-1c7ea53d0b013a9bb4df85fd
    resource: repo://lib/browser/api/protocol.ts
  - id: openwiki-source-d80250c29d7bf31d2f7121c4
    resource: repo://lib/browser/api/session.ts
  - id: openwiki-source-1a6f8e7d7e3713a29fbed1d2
    resource: repo://shell/browser/api/electron_api_session.cc
  - id: openwiki-source-a7812b9989726197c70b9034
    resource: repo://shell/browser/electron_browser_context.cc
generated: { by: "codex", at: "2026-11-16T07:11:18.304Z" }
---

# Sessions, storage, and networking

A Session is the JavaScript handle to an ElectronBrowserContext. It groups browser storage and network behavior so multiple pages can share cookies, configuration, and protocol handlers. A window boundary alone does not establish a new storage boundary.

## Identity and persistence

Public session factories require the app to be ready. Sessions cannot be constructed with `new`; obtain them through `session.defaultSession`, `fromPartition`, or `fromPath`.

| Factory input | Context |
| --- | --- |
| Empty partition / defaultSession | Default persistent browser context |
| `persist:name` | Persistent named context |
| Other nonempty partition | In-memory context |
| Absolute path through fromPath | Persistent context at that path |

The context map caches partition contexts by partition and memory mode, and path contexts by path key. Options such as `cache` are consumed when the context is first constructed; retrieving the same context later does not reconstruct it with new options. Named persistent partitions place storage under the session-data directory's `Partitions` tree, while path-backed contexts use the supplied location.

A session's lifetime spans individual page navigations and window closures. At process shutdown, browser main parts ultimately destroys all contexts; see [runtime architecture](../architecture/runtime-and-bootstrap.md#event-loops-and-shutdown).

## Protocol scope and failure handling

A BrowserContext owns its ProtocolRegistry. The top-level protocol module forwards ordinary registration and handling methods to `session.defaultSession.protocol`; registration on a different partition must target that session's protocol object.

`Protocol.handle` adapts Electron's native protocol request into a web Request and awaits a Response. HTTP, HTTPS, and file schemes use interception; other schemes use registration. Request upload data may be raw bytes, files, pipe streams, or blobs, and response streams are converted back into Node readable streams.

Invalid responses map to `ERR_UNEXPECTED`; `Response.error()` maps to `ERR_FAILED`. Exceptions are logged and map to `ERR_UNEXPECTED`. Registration or removal failures throw synchronously. Distinguish global scheme privilege registration from installing a handler in a session; see [protocol API documentation](../../docs/api/protocol.md) for timing and scheme privileges.

## Fetch and request integration

`Session.fetch` calls `fetchWithSession` with that session and `net.request`. `net.fetch` delegates to the default session. The main-process net request entry checks app readiness.

The fetch adapter constructs a Request, forwards session identity and request options, writes headers, streams request bodies into ClientRequest, and converts IncomingMessage into Response. HEAD and statuses with no body use a null response body. Construction and request errors reject the promise. An abort signal rejects with its reason and aborts the underlying request.

Without an origin header, the adapter changes `same-origin` credentials to `include` and avoids setting the default CORS mode header. This is a main-process adapter with specific network semantics; do not assume it is identical to page fetch or Node's global fetch. `bypassCustomProtocolHandlers` is forwarded to URL-loader options for requests that must avoid custom handling.

## Permission ownership

Session permission-request and permission-check handlers are installed on the context's ElectronPermissionManager. Both accept a function or null; invalid values throw. Because this policy belongs to the context, installing it affects pages sharing that context. Coordinate permission decisions with the [preload and IPC boundary](preload-isolation-and-ipc.md), rather than treating access through a bridge as permission approval.

## Verification

`spec/api-session-spec.ts` checks session identity, cookies, storage paths, and permission handlers. `spec/api-protocol-spec.ts` covers handler registration and response adaptation; `spec/api-net-spec.ts` includes net.fetch cases. Reuse their local servers and cleanup conventions to avoid persistent cookie or handler state leaking across cases.

See [windows and navigation](../architecture/windows-and-navigation.md) for page lifetimes and [testing](../testing/runtime-and-api-tests.md) for focused execution.
