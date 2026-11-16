---
type: concept
title: Sessions, storage and network routing
description: Browser-context identity and persistence, session-scoped network/protocol behavior, storage clearing and permission policy.
tags: [session, storage, networking, protocol, permissions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:01:04.581Z
sources:
  - id: openwiki-source-0702fbd38b1811ca32c7bee1
    resource: repo://lib/browser/api/net-fetch.ts
  - id: openwiki-source-c2f667ce02e32cf3333f95b9
    resource: repo://lib/browser/api/net.ts
  - id: openwiki-source-1c7ea53d0b013a9bb4df85fd
    resource: repo://lib/browser/api/protocol.ts
  - id: openwiki-source-d80250c29d7bf31d2f7121c4
    resource: repo://lib/browser/api/session.ts
  - id: openwiki-source-71cc3d32b6f7a84b340cebcf
    resource: repo://shell/browser/api/electron_api_protocol.cc
  - id: openwiki-source-1a6f8e7d7e3713a29fbed1d2
    resource: repo://shell/browser/api/electron_api_session.cc
  - id: openwiki-source-5b1886b47cac8ce9671914c6
    resource: repo://shell/browser/api/electron_api_web_contents.cc
  - id: openwiki-source-a7812b9989726197c70b9034
    resource: repo://shell/browser/electron_browser_context.cc
  - id: openwiki-source-0a6d7972d5b9642b3af64562
    resource: repo://shell/browser/electron_permission_manager.cc
generated: { by: "codex", at: "2026-11-16T18:01:04.581Z" }
---

# Sessions, storage and network routing

A Session is the application-facing wrapper for an `ElectronBrowserContext`. It is the ownership boundary for browser storage and services such as cookies, protocol handlers, webRequest, service workers, downloads and permissions. Multiple web contents using the same session share that context; creating another window does not imply another storage identity.

## Identity, persistence and configuration

| Selection | Context behavior |
| --- | --- |
| `session.defaultSession` or empty partition | Default persistent context |
| `session.fromPartition('persist:name')` | Persistent named partition; prefix is stripped for context lookup |
| `session.fromPartition('name')` | In-memory named partition |
| `session.fromPath(absolutePath)` | Persistent context rooted at an explicit nonempty absolute path |

Public session lookup requires app readiness. Browser contexts are cached by partition plus memory mode, or by explicit path, and existing Session wrappers are reused. Creation options are used only when the native context is first constructed, so repeated lookup with new options is not reconfiguration.

Named persistent contexts derive their directory from `DIR_SESSION_DATA/Partitions/<normalized-name>`; the default uses the session-data root. The constructor initializes preferences, cookie change notifications and the protocol registry. HTTP cache defaults can be affected by command-line configuration and the initial `cache` option.

WebContents creation chooses an explicit Session first, then a partition option, then the default session. This precedence is the first thing to inspect when a page seems to use the wrong cookies, proxy or protocol handlers.

## Network APIs and data flow

Browser `net.request` requires readiness and constructs the shared `ClientRequest`. Browser `net.fetch` and `net.resolveHost` delegate to the default session. `ses.fetch` invokes `fetchWithSession` with that particular session and the browser request factory.

The fetch adapter constructs a standard Request, propagates method, headers, credentials, cache and redirect configuration to ClientRequest, translates its response stream into a Response, and rejects on request errors. Abort signals reject and abort the underlying request. If credentials are `same-origin` without an explicit origin, this adapter selects `include`; do not assume it has a page document's origin context. `bypassCustomProtocolHandlers` is forwarded to the URL loader options.

ClientRequest validates explicit session/partition arguments and supports `follow`, `error` and `manual` redirect policies. Its browser routing shares Chromium networking infrastructure, whereas [utility-process networking](../architecture/utility-processes.md#networking-boundary) is supplied through a separate system-network-context bundle.

## Protocol registration and response adaptation

The module-level `protocol` methods delegate to `session.defaultSession.protocol`. To serve a custom-partition window, register on that window's session. Scheme privileges are global startup configuration: native `registerSchemesAsPrivileged` rejects calls after app readiness, while request handlers belong to the selected session.

`Protocol.handle` adapts native upload data into a Request and translates the returned Response into a Node-readable stream plus headers/status. For `http`, `https` and `file` it uses interception; other schemes use registration. Invalid response shapes and exceptions yield `ERR_UNEXPECTED`; an error Response yields `ERR_FAILED`; registration failure throws. A handler forwarding to another fetch must consider custom-protocol interception to avoid routing back into itself.

The built-in archive file path has separate [ASAR loader behavior](asar-and-application-loading.md), so protocol interception and archive filesystem adaptation should be investigated independently.

## Storage and permission operations

`clearStorageData` delegates to Chromium's default storage partition and resolves only from its completion callback. Clearing cookies also resets the media-device ID salt. `flushStorageData` asks that partition to flush. `setProxy` stores proxy preferences, prefers a supplied PAC script when no mode is explicit, rejects invalid modes, and resolves on a posted task; `forceReloadProxyConfig` separately talks to the network context.

Permission requests and permission checks have separate handlers. In the generic permission-request path, no application request handler causes grants for the requested permissions, with additional handling for MIDI SysEx and geolocation. This is not a universal statement about every device or OS permission: specialized handlers and platform enforcement have their own paths. Applications loading untrusted content need an explicit session policy, in addition to [renderer isolation and IPC authorization](renderer-security.md).

## Tests and diagnosis

`spec/api-session-spec.ts` covers identity, cookies, storage clearing, protocols, proxies, certificate verification, permissions and persistence. `spec/api-net-session-spec.ts` exercises session-aware authentication. `spec/api-protocol-spec.ts` and `spec/api-net-custom-protocols-spec.ts` cover protocol integration.

When diagnosing a request, trace the initiating WebContents or network API to its Session, then check that session's protocol/proxy/permission configuration before changing global behavior. [Window and web-content ownership](../architecture/windows-and-web-contents.md) explains how navigation relates to that state.
