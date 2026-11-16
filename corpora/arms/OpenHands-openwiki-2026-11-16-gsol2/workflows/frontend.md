---
type: workflow
title: Browser conversation workflow
description: How the React application loads conversations, connects sockets, handles replayed events and updates chat, terminal and file views.
tags: [frontend, react, socketio, conversations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:55:05.802Z
sources:
  - id: openwiki-source-b18e9242e8b5eda6fb47c473
    resource: repo://frontend/react-router.config.ts
  - id: openwiki-source-c25e6721ceef43d48fb22c35
    resource: repo://frontend/src/context/ws-client-provider.tsx
  - id: openwiki-source-85badec3163ca8ed74ecf00f
    resource: repo://frontend/src/routes/conversation.tsx
  - id: openwiki-source-c46258d1e4d2d1b2d3099e02
    resource: repo://frontend/src/services/actions.ts
  - id: openwiki-source-f574b65dfc2f0f277a05ce1f
    resource: repo://frontend/src/services/observations.ts
generated: { by: "codex", at: "2026-11-16T16:55:05.802Z" }
---

# Browser conversation workflow

## Application and routes

The main browser application is `frontend/`, built with React, TypeScript, React Router and Vite. React Router configuration disables SSR and flattens the generated client build into `frontend/build`, which the Python server can serve. `src/routes.ts` defines home, settings subsections, conversation and microagent-management routes under a root layout. `openhands-ui/` is separately packaged reusable UI code.

The client uses several state owners: React Query for server resources and invalidation, Redux slices for agent/terminal/browser/metrics display state, and socket-provider React state for received events and connection status. Changing one does not implicitly refresh the others.

## Open or resume a conversation

`OpenHands.createConversation` posts repository, branch, prompt, provider, conversation instructions and optional suggested-task or microagent-creation details to `/api/conversations`. The conversation route loads active metadata and configuration, redirects unavailable conversations for authenticated users and starts stopped conversations through the start endpoint. On a conversation-ID change it clears terminal/notebook/conversation state and sets the displayed agent state to loading.

`WsClientProvider` waits for usable conversation metadata, then creates a websocket-only Socket.IO connection. It sends the conversation ID, latest received event ID, providers and session API key as query data. When the conversation has an absolute URL, the provider derives its host and socket path prefix from that URL; otherwise it uses the configured backend host or current browser host. This supports a conversation endpoint hosted away from the main application origin or under a path prefix.

On disconnect the provider updates the reconnect cursor from the last numeric event ID. The server replays later events before joining the conversation. Switching conversations resets local event arrays and the cursor. On connection errors the provider updates error state and refetches conversation metadata; server/runtime status and socket transport status remain different signals.

## Events into views

Outgoing user events use `oh_user_action`; incoming events arrive as `oh_event`. The socket handler first calls the service dispatcher, then updates parsed/raw event collections and query state. A returned user-message event removes its optimistic placeholder. The receive-rate hook helps distinguish rapid history loading from a quieter live conversation.

The action service updates terminal and notebook inputs, metrics and security-analysis state, while ignoring hidden actions. The observation service updates command output, notebook results, browser URL/screenshots and agent state. Terminal output is shortened for display above 5,000 characters by retaining the head and tail; that display transformation does not truncate the persisted event record. Other observation types can be consumed by specialized renderers even when the generic observation switch has no display action.

Command, write and edit actions invalidate file-change queries; write/edit also invalidate the relevant file diff after normalizing workspace/repository prefixes. Status messages can invalidate conversation metadata after title updates. When adding event types, update TypeScript schemas/guards, service dispatch, specialized chat handlers and any affected query invalidation together.

`ConversationSubscriptionsProvider` maintains separate per-conversation sockets and event handlers for additional subscriptions, including status toasts. It is distinct from the primary conversation socket provider and owns its own unsubscribe/cleanup logic.

## Development and validation

From `frontend/`, `npm run dev` uses the real API; `dev:mock` and `dev:mock:saas` select mocked flows. Vite proxies `/api`, `/ws` and `/socket.io` to the configured backend. Build and dev scripts generate translations first. `npm run typecheck` generates route types before TypeScript; lint combines typechecking, ESLint and Prettier. Keep user-visible strings in the translation workflow.

Trace [routes](../../frontend/src/routes.ts), [conversation route](../../frontend/src/routes/conversation.tsx), [socket provider](../../frontend/src/context/ws-client-provider.tsx), [actions](../../frontend/src/services/actions.ts) and [observations](../../frontend/src/services/observations.ts). Frontend service and component tests cover client logic; Playwright uses a mocked server as described in [testing](../testing/validation-and-evaluation.md). Pair those checks with server socket tests for serialization/replay changes.

Related: [server conversations](../architecture/conversations.md), [quickstart](../quickstart.md).
