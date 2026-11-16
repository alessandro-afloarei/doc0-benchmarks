---
title: "Server Application"
---
## Overview

The server is a FastAPI application, `openhands.server.app`, that the socket.io layer in `listen.py` wraps. `app.py` creates the FastAPI object, starts the conversation manager during its lifespan, mounts the MCP endpoint, and attaches the HTTP routers. `listen.py` adds the static frontend, the middleware and the socket.io channel. Each route family then belongs to a page of its own: conversations are on [[Conversation Lifecycle]], and the socket channel is on [[Socket Sessions]].

Sources: [openhands/server/app.py:53-63](repo://openhands/server/app.py#L53-L63), [openhands/server/listen.py:1-27](repo://openhands/server/listen.py#L1-L27)

## Application and lifespan

`app.py` builds the FastAPI object with a title and version and a lifespan that combines two parts: the conversation manager's async context, which the manager uses to start and stop its background work, and the MCP app's lifespan. The MCP endpoint is mounted at `/mcp`.

Sources: [openhands/server/app.py:43-66](repo://openhands/server/app.py#L43-L66)

An `AuthenticationError` raised by a git provider is turned into a 401 response that carries the error text, rather than an unhandled 500.

Sources: [openhands/server/app.py:68-72](repo://openhands/server/app.py#L68-L72)

## Routers

The application includes its routers in a fixed order: public, files, security, feedback, conversation, manage-conversations, settings and secrets, then the git router, which is included only in the OSS app mode, then trajectory. The health endpoints are added last.

Sources: [openhands/server/app.py:75-86](repo://openhands/server/app.py#L75-L86), [openhands/server/routes/health.py:6-17](repo://openhands/server/routes/health.py#L6-L17)

The public router serves the metadata the interface needs before any conversation exists: the list of models, the list of agents, the list of security analysers, and the configuration as seen by the client.

Sources: [openhands/server/routes/public.py:14-69](repo://openhands/server/routes/public.py#L14-L69)

The app mode is read from the server configuration. The OSS mode is the default and includes the git router. The SaaS mode, which the enterprise package uses, leaves the git router out. The same configuration names the classes for settings, secrets and conversation storage.

Sources: [openhands/server/config/server_config.py:8-24](repo://openhands/server/config/server_config.py#L8-L24), [openhands/server/types.py:6-9](repo://openhands/server/types.py#L6-L9)

## Listen layer

`listen.py` mounts the built frontend at `/` when `SERVE_FRONTEND` is true. `SPAStaticFiles` answers any path it cannot find with `index.html`, which lets the client-side router handle deep links.

Sources: [openhands/server/listen.py:15-18](repo://openhands/server/listen.py#L15-L18), [openhands/server/static.py:6-12](repo://openhands/server/static.py#L6-L12)

Three middleware are added to the app. `LocalhostCORSMiddleware` allows any origin on `localhost` or `127.0.0.1` and adds the origins listed in `PERMITTED_CORS_ORIGINS`. `CacheControlMiddleware` sets a long cache lifetime on fingerprinted `/assets` files and `no-store` on everything else. `RateLimitMiddleware` answers 429 once a client passes the limit, which is 10 requests per second in the listen module.

Sources: [openhands/server/middleware.py:16-50](repo://openhands/server/middleware.py#L16-L50), [openhands/server/middleware.py:51-69](repo://openhands/server/middleware.py#L51-L69), [openhands/server/middleware.py:70-131](repo://openhands/server/middleware.py#L70-L131), [openhands/server/listen.py:19-24](repo://openhands/server/listen.py#L19-L24)

The rate limiter keeps a list of request times per key and drops those older than its window. `/assets` requests are exempt, and every other request counts against the limit.

Sources: [openhands/server/middleware.py:70-107](repo://openhands/server/middleware.py#L70-L107), [openhands/server/middleware.py:127-131](repo://openhands/server/middleware.py#L127-L131)

The socket.io application wraps the FastAPI app, so a request with a socket.io path is handled by the socket layer and every other path goes to the FastAPI app.

Sources: [openhands/server/listen.py:26-27](repo://openhands/server/listen.py#L26-L27)

## Authentication

When the `SESSION_API_KEY` environment variable is set, every router that uses `get_dependencies` requires the `X-Session-API-Key` header to match it, and any other value gets a 401. When the variable is not set, no check runs.

Sources: [openhands/server/dependencies.py:6-24](repo://openhands/server/dependencies.py#L6-L24), [openhands/server/routes/manage_conversations.py:78-78](repo://openhands/server/routes/manage_conversations.py#L78-L78)

The shared singletons are created once when the module is imported: the conversation manager, and the settings, secrets and conversation stores, each built from its class name in the server configuration with `get_impl`. Routes reach them through `openhands.server.shared`.

Sources: [openhands/server/shared.py:1-77](repo://openhands/server/shared.py#L1-L77), [openhands/server/app.py:34-34](repo://openhands/server/app.py#L34-L34)
