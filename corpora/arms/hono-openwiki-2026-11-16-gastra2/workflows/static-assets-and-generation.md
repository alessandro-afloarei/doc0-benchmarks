---
type: workflow
title: Static assets and static site generation
description: Asset lookup and runtime filesystem adapters, plus SSG discovery, parameter expansion, hooks, and output persistence.
tags: [static, ssg, filesystem, rendering]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:23:09.970Z
sources:
  - id: openwiki-source-e408144592bb9f8eeca54b23
    resource: repo://src/helper/ssg/middleware.ts
  - id: openwiki-source-0fe126e6c9385affa2b50eb6
    resource: repo://src/helper/ssg/ssg.ts
  - id: openwiki-source-02cf4bb36f551f1a17710d8d
    resource: repo://src/middleware/serve-static/index.ts
generated: { by: "codex", at: "2026-11-16T17:23:09.970Z" }
---

# Static assets and static site generation

Static serving reads existing content during an HTTP request. Static site generation executes application routes and writes their responses to files. Both separate portable orchestration from runtime storage access; [runtime adapters](../integrations/runtime-adapters.md) supply filesystem or asset-service operations.

## Serving existing assets

The shared serveStatic middleware takes `getContent(path, context)`, with optional `join` and `isDir` hooks. Runtime wrappers supply these capabilities; for example, Bun uses Bun.file, node:path join, and filesystem stat.

If the context is already finalized, static middleware continues downstream. Otherwise it uses an explicitly configured path or decodes the request path. Request-derived names containing dot path segments, repeated separators, or backslashes are rejected through onNotFound followed by next. The configured root and optional rewriteRequestPath are then joined. Explicit paths and rewritten paths are application-controlled inputs, so the request-path check is not a general validation of every adapter callback.

With isDir support, directories map to index.html. A Response returned by getContent is recreated through c.newResponse directly. Raw content receives a MIME type, optional precompressed lookup, onFound, and a body response. Missing content calls onNotFound and continues, allowing later handlers or the normal 404 to respond.

Precompressed lookup starts only after base content is found. It checks br, zstd, then gzip against comma-separated Accept-Encoding tokens and looks for .br, .zst, or .gz siblings. A selected representation sets Content-Encoding and appends Vary: Accept-Encoding. The token matching here does not implement quality-weight negotiation.

The default join helper normalizes slash-separated paths and does not support Windows paths. Runtime wrappers can replace it. Cloudflare Pages asset serving is a different integration: it delegates to the ASSETS service instead of this filesystem seam.

## SSG discovery and rendering

`toSSG(app, fs, options)` orchestrates generation; the Bun adapter supplies a filesystem module so callers can use its shorter runtime-specific form. Defaults are output directory ./static and concurrency 2.

The generator selects GET and ALL routes whose unwrapped target handler is classified as an endpoint, sends an initial request to discover route parameters, and then issues concrete requests for generated paths. Both phases set the HONO_SSG_CONTEXT binding. Even a static route receives a discovery request followed by a content request, so handlers should account for generation executing application code more than once.

For dynamic routes, `ssgParams` attaches parameter combinations to the discovery Request and returns notFound before the endpoint executes. Concrete parameterized requests continue normally. Dynamic routes without discovered combinations are skipped. `disableSSG` marks generation responses with x-hono-disable-ssg and returns notFound; `onlySSG` returns notFound for ordinary requests. These controls use the generation binding rather than a different router.

## Hooks, plugins, and writes

Before-request hooks can replace the discovery request or return false to skip it. Method and headers from that request are reused for concrete requests. After-response hooks can transform or skip concrete responses. Direct option hooks are collected before plugin hooks, and combined hooks run in order.

When plugins are omitted, defaultPlugin filters out responses whose status is not 200. Supplying a plugins array replaces that default list. The redirect plugin converts supported HTTP redirects with a Location header into HTML redirect pages; place it before defaultPlugin so filtering sees the converted 200 response.

Response MIME type determines extension mapping, and content is collected as text or ArrayBuffer before writing. Root and trailing-slash paths receive index names; other paths receive an extension unless already present. The generated path is checked for containment in the output directory before filesystem mkdir and writeFile persist output. This is a build-time storage effect, not a framework database. afterGenerate hooks receive the result after orchestration.

Generation aggregates file paths and returns success with the written file list. Caught failures return success false, an empty file list, and an Error. It does not implement transactional filesystem rollback: earlier writes can already exist when another request or write fails. After-generation hooks run outside that catch, so their failures can reject the call. Inspect the result before treating an output directory as a successful build.

## Testing and related workflows

The shared static tests cover path handling, missing assets, MIME types, and precompressed representations; Bun/Deno runtime tests verify actual filesystem behavior. SSG tests cover dynamic-route skipping, parameter discovery short circuits, generation-only controls, hook ordering, plugins, and output behavior.

Use [rendering and streaming](rendering-and-streaming.md) to understand HTML produced by routes. SSG collects response bodies before writing them, whereas live streaming delivers bytes to the client as they become available.
