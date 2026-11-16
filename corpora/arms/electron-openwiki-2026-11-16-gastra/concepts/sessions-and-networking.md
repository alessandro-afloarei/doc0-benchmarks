---
type: concept
title: Sessions, storage, permissions, and networking
description: BrowserContext and Session identity, persistent partitions, Chromium-backed requests, custom protocol dispatch, and permission policy ownership.
tags: [session, storage, networking, permissions, protocols]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:40:08.980Z
sources:
  - id: openwiki-source-0702fbd38b1811ca32c7bee1
    resource: repo://lib/browser/api/net-fetch.ts
  - id: openwiki-source-c2f667ce02e32cf3333f95b9
    resource: repo://lib/browser/api/net.ts
  - id: openwiki-source-1c7ea53d0b013a9bb4df85fd
    resource: repo://lib/browser/api/protocol.ts
  - id: openwiki-source-e5ef20902d5cbdcbff6500f8
    resource: repo://lib/common/api/net-client-request.ts
  - id: openwiki-source-71cc3d32b6f7a84b340cebcf
    resource: repo://shell/browser/api/electron_api_protocol.cc
  - id: openwiki-source-1a6f8e7d7e3713a29fbed1d2
    resource: repo://shell/browser/api/electron_api_session.cc
  - id: openwiki-source-a7812b9989726197c70b9034
    resource: repo://shell/browser/electron_browser_context.cc
  - id: openwiki-source-0a6d7972d5b9642b3af64562
    resource: repo://shell/browser/electron_permission_manager.cc
generated: { by: "codex", at: "2026-11-16T08:40:08.980Z" }
---

# Sessions, storage, permissions, and networking

A Session is the JavaScript access point to a BrowserContext's storage and networking services. Choose the Session before investigating cookies, protocol handlers, permissions, or request behavior: two windows can look identical while using different contexts.

## Identity and persistence

Public fromPartition/fromPath access requires app readiness. The native Session constructor cannot be called with new; CreateFrom reuses an existing live Session for the BrowserContext and emits session-created when creating one.

| Selector | Context behavior |
| --- | --- |
| Empty partition | Default persistent BrowserContext |
| `persist:name` | Persistent named partition with the prefix removed |
| Other nonempty partition | In-memory named partition |
| fromPath(absolutePath) | Persistent context at a caller-selected path; empty and relative paths are rejected |

BrowserContext caches contexts by partition plus in-memory identity, or by path. Options are passed only when the context is first constructed. Calling fromPartition again with a new cache option therefore does not reconstruct an existing context.

Named persistent partition paths are derived beneath the session-data directory's Partitions directory; the default context uses the session-data base. Context teardown notifies keyed services and shuts down storage partitions. See [context construction](../../shell/browser/electron_browser_context.cc) and [Session creation](../../shell/browser/api/electron_api_session.cc).

## Storage operations have distinct scopes

Session exposes cookies, protocol, serviceWorkers, webRequest, netLog, and extension access through its native object. clearCache targets the default StoragePartition's network HTTP cache. clearStorageData passes storage/quota masks and a storage key to StoragePartition::ClearData, and resets the media device ID salt when cookies are included. Both return promises completed from their respective native callbacks.

Do not treat cache clearing, cookie clearing, and all storage deletion as interchangeable operations. Await the relevant completion before asserting state in a test. See [Session implementation](../../shell/browser/api/electron_api_session.cc) and its [API reference](../../docs/api/session.md) for option details.

## Requests and Fetch adaptation

The main-process net.request wrapper checks readiness before constructing ClientRequest. Request option conversion validates an explicit Session and gives it precedence over partition. net.fetch delegates to defaultSession.fetch; Session.fetch invokes the shared fetchWithSession adapter with that Session and net.request.

The adapter constructs a WHATWG Request, passes method, URL, origin, credentials, cache and redirect options to the native request path, copies headers, streams the body, and converts IncomingMessage into a Response. An already-aborted signal rejects immediately; later abort rejects and aborts the request. Request errors reject the promise. HEAD and selected status codes receive a null response body.

Two adapter details matter when comparing behavior with a browser fetch: same-origin credentials without an origin are converted to include, and bypassCustomProtocolHandlers is explicitly forwarded to the URL loader. Follow [net-fetch](../../lib/browser/api/net-fetch.ts) when debugging mismatched cookies, origins, streaming, or cancellation.

## Protocol ownership and failure conversion

Global protocol.handle delegates to defaultSession.protocol.handle. Register handlers on the actual Session used by a window or request. Privileged scheme registration is a separate global operation that native code rejects after app readiness.

Protocol.handle adapts the native request into a WHATWG Request and awaits a Response. Built-in http, https and file schemes use interception; other schemes use registration. An invalid response or thrown handler becomes ERR_UNEXPECTED, while Response.error becomes ERR_FAILED. Successful response bodies are converted from web streams to Node streams for the callback. Registration failure throws synchronously.

This pipeline connects custom schemes to Session fetch and WebContents loading; it is not simply a string-to-file mapping.

## Permission policy belongs to the Session

The permission manager has separate request and check handlers. In RequestPermissionsWithDetails, an absent request handler grants the requested permissions in that path. In CheckPermissionWithDetails, an absent check handler permits checks except deprecated synchronous clipboard reads. Other device-specific and platform paths have their own conditions, so these defaults are not a universal guarantee of access.

A configured request handler receives the WebContents, permission, callback, and details including requesting URL and main-frame status. Pending requests collect responses; clearing the handler also drains pending requests for surviving contents. Configure both request and check policy where the application needs it, and use the supplied frame/origin details rather than inferring trust from the window title.

## Validation and related systems

[Session specs](../../spec/api-session-spec.ts) cover identity, cookies, cache, proxies and permissions; [protocol specs](../../spec/api-protocol-spec.ts) include custom-session behavior. Use these focused suites through [validation](../testing/validation.md). [Window ownership](windows-and-web-contents.md) explains the consumers of a Session, and [renderer isolation](renderer-isolation.md) explains Session-owned preload selection.
