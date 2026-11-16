---
title: "Sessions and Browser Context"
---
## Overview

A `Session` is the JavaScript view of a Chromium `BrowserContext`, which holds the cookies, cache, storage and network settings that a set of pages shares. `ElectronBrowserContext` is the C++ class that owns one, and `Session` wraps it for JavaScript. Messages from a session's pages are routed as described on [[Inter-process Communication]]. Each `WebContents` belongs to one browser context, so its session decides where its cookies go and which protocol handlers apply. This page covers how a partition name becomes a context, and how the session object is reached from JavaScript. The cookie, protocol and download APIs that sessions expose are on their own pages, and the window that uses a session is on [[Windows and WebContents]].

Sources: [shell/browser/electron_browser_context.cc:308-335](repo://shell/browser/electron_browser_context.cc#L308-L335)

## Context map

Every context lives in one process-wide map, which is keyed by `PartitionKey`. A key holds the partition name or file path, a type flag that says which of the two it is, and whether the context is in memory. Two keys are equal only when all three match, so the same name in memory and on disk gives two different contexts.

Sources: [shell/browser/electron_browser_context.cc:308-335](repo://shell/browser/electron_browser_context.cc#L308-L335)

`ElectronBrowserContext::From` returns the context for a partition, creating it on first use, and the default context is the one for the empty partition name on disk. `FromPath` uses the same map with a path key, so a context opened by path is separate from any partition with the same name.

Sources: [shell/browser/electron_browser_context.cc:870-898](repo://shell/browser/electron_browser_context.cc#L870-L898)

## Partition names

`Session.fromPartition` decides how a name maps to a context. An empty name gives the default context. A name that starts with `persist:` gives a context on disk, with the rest of the name as its key. Any other name gives an in-memory context, which is not written to disk.

Sources: [shell/browser/api/electron_api_session.cc:1713-1730](repo://shell/browser/api/electron_api_session.cc#L1713-L1730), [shell/browser/api/electron_api_session.cc:484](repo://shell/browser/api/electron_api_session.cc#L484)

For an on-disk partition, the context's folder is `Partitions/` under the user data folder, followed by the partition name in lower case, escaped for use as a path. The name is escaped before it is used in the path.

Sources: [shell/browser/electron_browser_context.cc:237-239](repo://shell/browser/electron_browser_context.cc#L237-L239), [shell/browser/electron_browser_context.cc:378-385](repo://shell/browser/electron_browser_context.cc#L378-L385)

The constructor reads its options from the dictionary that `fromPartition` passed in. The `cache` option turns the HTTP cache on or off, and the `--disk-cache-size` switch sets the maximum cache size, so both are fixed when the context is created.

Sources: [shell/browser/electron_browser_context.cc:357-376](repo://shell/browser/electron_browser_context.cc#L357-L376)

## Session objects

`Session::CreateFrom` returns the existing JavaScript session for a context when one is alive, and creates a new garbage-collected `Session` otherwise. A context therefore has at most one session object at a time, and every `WebContents` in that context gets the same object.

Sources: [shell/browser/api/electron_api_session.cc:1683-1690](repo://shell/browser/api/electron_api_session.cc#L1683-L1690)

The JavaScript module exposes `fromPartition`, `fromPath` and a `defaultSession` getter that calls `fromPartition('')`. The `Session` prototype's `_init` attaches the IPC dispatch listeners to the session, so the session receives the `-ipc-message` events that its pages send.

Sources: [lib/browser/api/session.ts:115-120](repo://lib/browser/api/session.ts#L115-L120), [lib/browser/api/session.ts:25-27](repo://lib/browser/api/session.ts#L25-L27)
