---
type: workflow
title: Frontend conversation experience
description: Browser routing, conversation creation, Socket.IO synchronization, REST caching, UI state, and the separate shared component package.
tags: [frontend, react, conversations, socketio, state]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:51.947Z
sources:
  - id: openwiki-source-b18e9242e8b5eda6fb47c473
    resource: repo://frontend/react-router.config.ts
  - id: openwiki-source-9187b2942d20e9bda777d7ad
    resource: repo://frontend/src/api/open-hands.ts
  - id: openwiki-source-7fe22009973f2cc88663591e
    resource: repo://frontend/src/context/conversation-subscriptions-provider.tsx
  - id: openwiki-source-c25e6721ceef43d48fb22c35
    resource: repo://frontend/src/context/ws-client-provider.tsx
  - id: openwiki-source-3179d3ce3d08ff9bfc0fceb8
    resource: repo://frontend/src/hooks/mutation/use-create-conversation.ts
  - id: openwiki-source-85badec3163ca8ed74ecf00f
    resource: repo://frontend/src/routes/conversation.tsx
  - id: openwiki-source-d0357eaf5ee19a57a2329994
    resource: repo://openhands-ui/vite.config.ts
generated: { by: "codex", at: "2026-11-16T17:43:51.947Z" }
---

# Frontend conversation experience

The main application in `frontend/` uses React, React Router, TypeScript, Redux Toolkit, and TanStack Query. React Router is configured with SSR disabled; a build hook moves the client output into `frontend/build` for static serving by the backend. The browser orchestrates user interaction and displays events; the backend remains the owner of agent execution.

## Routes and conversation startup

`src/routes.ts` defines a root layout with home, nested settings, conversation, and microagent-management routes. Settings include model, MCP, user, Git integrations, application, billing, secrets, and API keys; availability and behavior can depend on server mode.

`useCreateConversation` sends task text, repository/provider/branch selection, optional conversation instructions, and optional microagent creation information through the REST API client. Success invalidates the cached conversation list. Navigating to `conversations/:conversationId` fetches that conversation, reports inaccessible/missing conversations, and starts a stopped conversation before refetching it.

Changing conversation ID clears terminal, Jupyter, conversation state, and resets the agent state to loading. The conversation route wraps its content in the active socket provider, background subscription provider, and event handler. This reset boundary matters when fixing messages or tool output leaking between conversations.

## State ownership

| State | Owner |
| --- | --- |
| REST resources such as conversation metadata, settings, file changes, and diffs | TanStack Query hooks and API clients |
| Active connection status, received events, parsed events, reconnect cursor | `WsClientProvider` |
| Agent state, terminal output, browser state, Jupyter, metrics, security, and other presentation slices | Redux store and event service handlers |
| Additional conversation subscriptions and their notifications | `ConversationSubscriptionsProvider` |

The API client supports a conversation-specific URL and `X-Session-API-Key`, falling back to `/api/conversations/{id}`. This allows a conversation to be served at a location other than the default app origin. Preserve that routing when adding conversation-scoped endpoints.

## Live messages and reconnection

The active socket sends `oh_user_action` and listens for `oh_event`. Connection query parameters include the conversation ID, provider selections, and the latest received event ID; a conversation-specific URL can supply a different socket location and session key. On disconnect, the provider updates the cursor for reconnect. On conversation change, it clears the cursor and local event arrays.

Incoming messages pass through the chat/event services, update parsed event history, remove optimistic user messages when the server echoes them, and track error observations. A numeric event ID advances the reconnect cursor. The server uses that cursor to send stored events before live delivery; see [server lifecycle](../architecture/server-conversations.md).

File-edit, file-write, and command actions invalidate the file-change query. Edit/write actions also invalidate the affected file diff after normalizing workspace/repository path prefixes. This connects live activity to REST-derived panels: a stale diff can be an invalidation or path-normalization issue even when chat updates correctly.

Background subscriptions are separate sockets with their own per-conversation event arrays. They generate runtime-start, error, and completion notifications, and unsubscribe when they observe `FINISHED`. Do not assume they use precisely the same reconnection or cursor policy as the active conversation socket.

## Errors and settings

Global QueryClient handlers invalidate the authentication query on 401 responses. Query errors use short-lived duplicate-toast suppression; mutation errors follow their own toast path. The active socket separately handles transport and agent errors, while `useHandleWSEvents` recognizes server errors and can send a paused-state request for limit messages. Connection status, runtime readiness, and agent state are distinct signals.

Settings changes flow through dedicated service and mutation/query hooks. When adding a setting, follow its route form, request type, mutation invalidation, server validation/storage, and eventual application during session startup. A value appearing in a settings form does not prove an already-running controller has been reconfigured.

## UI package and build boundaries

`openhands-ui/` is a separate publishable `@openhands/ui` package with component/style exports, Vite library output, declaration generation, and Storybook development. Its build externalizes React and React DOM. The main frontend has its own dependency manifest and local UI components; editing the library does not imply the main app imports that component or updates automatically.

For application work, run focused Vitest checks and `npm run typecheck` in `frontend/`. The application build regenerates translations before building. Frontend Playwright starts a mocked app, while Python end-to-end tests target a live backend. Representative event tests include `frontend/src/services/__tests__/actions.test.ts`; socket/provider tests are under the frontend test trees. See [testing workflows](../testing/validation.md).
