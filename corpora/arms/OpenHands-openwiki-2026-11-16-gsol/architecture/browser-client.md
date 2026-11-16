---
type: architecture
title: Browser client and live conversations
description: How the React application routes conversations, separates query and interface state, and exchanges live events with the conversation server.
tags: [frontend, conversations, socketio, state]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:50:03.393Z
sources:
  - id: openwiki-source-b18e9242e8b5eda6fb47c473
    resource: repo://frontend/react-router.config.ts
  - id: openwiki-source-9187b2942d20e9bda777d7ad
    resource: repo://frontend/src/api/open-hands.ts
  - id: openwiki-source-c25e6721ceef43d48fb22c35
    resource: repo://frontend/src/context/ws-client-provider.tsx
  - id: openwiki-source-088a015993b157b0efaacaf3
    resource: repo://frontend/src/entry.client.tsx
generated: { by: "codex", at: "2026-11-16T06:50:03.393Z" }
---

# Browser client and live conversations

The application in `frontend/` is a React 19 client built with React Router 7 and Vite. It runs in SPA mode (`ssr: false`); the build hook moves the client assets into `frontend/build/` for static serving. `openhands-ui/` is a separate publishable component package, with its own manifest and build workflow.

## Application and state ownership

`src/routes.ts` places home, conversation, settings, and microagent management routes under a common layout. Settings has nested routes for LLMs, MCP, integrations, secrets, billing, and account settings. The root layout queries authentication, server capabilities, and user settings and coordinates login, consent, language, and access-related UI.

`entry.client.tsx` hydrates the router inside Redux and TanStack Query providers. Three distinct forms of state matter when debugging:

| State | Owner | Examples |
| --- | --- | --- |
| Server resources | TanStack Query hooks and API services | Conversation metadata, settings, repository files and diffs |
| Interface projections | Redux store and action/observation handlers | Agent status, terminal input/output, browser, notebook, metrics |
| Live conversation feed | `WsClientProvider` | Connection status, raw and parsed events, last received event |

The server remains the owner of execution. Browser projections are reconstructed from received events. `services/actions.ts` dispatches command inputs, notebook inputs, metrics, and security-analysis inputs; observations have a neighboring handler. Adding a new backend event usually requires updating TypeScript types and guards as well as these projections and its rendering component.

## HTTP and live transport

`api/open-hands-axios.ts` creates the HTTP client using the page protocol and either `VITE_BACKEND_BASE_URL` or the page host. The conversation API helper can use the selected conversation's custom URL, and supplies `X-Session-API-Key` when present. This supports conversations hosted away from the main application server; endpoint additions should preserve that routing.

`WsClientProvider` emits user input as `oh_user_action` and receives `oh_event`. It opens a Socket.IO connection with the WebSocket transport and sends conversation ID, provider selections, session API key, and `latest_event_id` in connection query parameters. An absolute conversation URL determines the socket host and path prefix; otherwise it uses the backend override or current host.

On conversation changes the provider clears its feed and last-event reference. On disconnect it puts the last received event ID into the next connection query so the server can replay later events. Reconnect behavior therefore depends on persisted server history as well as client connection state; see [conversation server](conversation-server.md).

## Event effects and failure behavior

The receive handler first sends events through shared action/observation dispatch. It then builds the parsed feed using event guards. A received user message removes its optimistic counterpart. File-write, file-edit, and command actions invalidate the file-changes query; direct file modifications also invalidate the relevant file diff after normalizing the workspace/repository prefix.

Runtime status errors and agent-state errors update the chat error state and leave the normal feed path early. Connection errors mark the transport disconnected and refetch conversation metadata. Global query/mutation error handlers invalidate authentication on HTTP 401; query error toasts are deduplicated briefly. Transport connection, conversation execution state, and displayed error state are separate signals.

## Development and verification

From `frontend/`, use `npm run dev` for the real backend, `npm run dev:mock` for mocked OSS behavior, or `npm run dev:mock:saas` for mocked SaaS behavior. Development startup conditionally loads the MSW browser worker before hydration. The Vite proxy forwards `/api`, `/ws`, and `/socket.io` to the configured backend; the default development ports are 3001 for the client and 3000 for the backend.

The focused socket test is `frontend/__tests__/context/ws-client-provider.test.tsx`; it checks outgoing `oh_user_action` emission and error-message handling. Service tests also live beside implementations. Use [validation guidance](../testing/validation.md) for type generation, Vitest, and Playwright commands. Consult [events and state](../concepts/events-state.md) before changing event IDs, action schemas, or replay semantics.
