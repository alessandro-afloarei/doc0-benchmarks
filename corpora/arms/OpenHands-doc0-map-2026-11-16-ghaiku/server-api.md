---
title: "HTTP and WebSocket API"
---
## Overview

The server offers two surfaces on one port. Ordinary requests go to a FastAPI application made of several routers, and live traffic for a conversation goes over Socket.IO. `listen.py` wraps the FastAPI application in a Socket.IO ASGI app, so one process serves both. The routers and the socket handlers both reach the same conversation manager, which is described in [[Sessions and Conversation Manager]].

Sources: [openhands/server/listen.py:20-27](repo://openhands/server/listen.py#L20-L27) [openhands/server/app.py:58-63](repo://openhands/server/app.py#L58-L63)

## Application assembly

`app.py` builds the FastAPI application with a lifespan that enters the conversation manager and the MCP app. It mounts the MCP application at `/mcp`. It maps `AuthenticationError` to HTTP 401 and then includes the routers: public, files, security, feedback, conversations, conversation management, settings, secrets and trajectory. The git router is included only in OSS mode.

Sources: [openhands/server/app.py:58-66](repo://openhands/server/app.py#L58-L66) [openhands/server/app.py:67-74](repo://openhands/server/app.py#L67-L74) [openhands/server/app.py:75-85](repo://openhands/server/app.py#L75-L85)

`listen.py` adds three middleware classes: a localhost CORS policy, a cache-control header, and an in-memory rate limit of 10 requests per second.

Sources: [openhands/server/listen.py:20-26](repo://openhands/server/listen.py#L20-L26)

## Session key check

When the `SESSION_API_KEY` environment variable is set, `get_dependencies` adds a dependency that compares the session API key header with it and returns 401 on a mismatch. When the variable is not set, no check is added.

Sources: [openhands/server/dependencies.py:6-6](repo://openhands/server/dependencies.py#L6-L6) [openhands/server/dependencies.py:10-24](repo://openhands/server/dependencies.py#L10-L24)

## Socket.IO connection

On connect, the handler reads `latest_event_id` and `conversation_id` from the query string. A `latest_event_id` that is not an integer falls back to -1. The connection is refused when the conversation id is missing or the session key is wrong. Otherwise the handler sends the stored events newer than `latest_event_id` to the client as `oh_event` messages.

Sources: [openhands/server/listen_socket.py:36-55](repo://openhands/server/listen_socket.py#L36-L55) [openhands/server/listen_socket.py:61-65](repo://openhands/server/listen_socket.py#L61-L65) [openhands/server/listen_socket.py:104-113](repo://openhands/server/listen_socket.py#L104-L113)

Two events carry user input. `oh_user_action` passes its data to the conversation's event stream. `oh_action` is a legacy name for the same handler, kept for clients that have not been updated. `disconnect` detaches the connection from its session.

Sources: [openhands/server/listen_socket.py:143-153](repo://openhands/server/listen_socket.py#L143-L153) [openhands/server/listen_socket.py:155-158](repo://openhands/server/listen_socket.py#L155-L158)

## Conversation routes

`manage_conversations.py` holds the lifecycle routes: create with `POST /conversations`, list, get, delete, and `PATCH` to update a conversation. `POST .../start` and `POST .../stop` start and stop the agent loop for one conversation. The create and start routes take the user, provider tokens, secrets and settings as dependencies, so the caller's identity is resolved before the handler runs.

Sources: [openhands/server/routes/manage_conversations.py:189-199](repo://openhands/server/routes/manage_conversations.py#L189-L199) [openhands/server/routes/manage_conversations.py:291-292](repo://openhands/server/routes/manage_conversations.py#L291-L292) [openhands/server/routes/manage_conversations.py:330-331](repo://openhands/server/routes/manage_conversations.py#L330-L331) [openhands/server/routes/manage_conversations.py:352-353](repo://openhands/server/routes/manage_conversations.py#L352-L353) [openhands/server/routes/manage_conversations.py:473-480](repo://openhands/server/routes/manage_conversations.py#L473-L480) [openhands/server/routes/manage_conversations.py:534-535](repo://openhands/server/routes/manage_conversations.py#L534-L535) [openhands/server/routes/manage_conversations.py:639-640](repo://openhands/server/routes/manage_conversations.py#L639-L640)

The conversation router reads the event history with `GET /events` and adds events with `POST /events`, and it lists the microagents at `GET /microagents`. The files router handles file reads and uploads, and the upload route is `POST /upload-files`.

Sources: [openhands/server/routes/conversation.py:105-106](repo://openhands/server/routes/conversation.py#L105-L106) [openhands/server/routes/conversation.py:171-172](repo://openhands/server/routes/conversation.py#L171-L172) [openhands/server/routes/conversation.py:191-192](repo://openhands/server/routes/conversation.py#L191-L192) [openhands/server/routes/files.py:287-288](repo://openhands/server/routes/files.py#L287-L288)

## Settings and public routes

The settings router has three routes: one GET and two POSTs. The public router answers with the list of models, the list of agents, the list of security analyzers, and the server configuration. These routes need no conversation.

Sources: [openhands/server/routes/settings.py:28-30](repo://openhands/server/routes/settings.py#L28-L30) [openhands/server/routes/settings.py:90-92](repo://openhands/server/routes/settings.py#L90-L92) [openhands/server/routes/settings.py:133-135](repo://openhands/server/routes/settings.py#L133-L135) [openhands/server/routes/public.py:14-16](repo://openhands/server/routes/public.py#L14-L16) [openhands/server/routes/public.py:32-34](repo://openhands/server/routes/public.py#L32-L34) [openhands/server/routes/public.py:47-49](repo://openhands/server/routes/public.py#L47-L49) [openhands/server/routes/public.py:62-64](repo://openhands/server/routes/public.py#L62-L64)
