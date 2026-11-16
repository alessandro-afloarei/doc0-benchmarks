---
type: architecture
title: Web Frontend and Shared UI
description: The React Router single-page application in frontend/ that users operate in the browser, covering its route tree, REST client, Socket.IO event channel and conversation state, Redux slices, build and i18n steps, and the openhands-ui component package it depends on.
tags: [frontend, react, react-router, redux, socketio, websocket, ui, openhands-ui]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-63117229de55feec7d3e110e
    resource: repo://frontend/src/api/open-hands-axios.ts
  - id: openwiki-source-c25e6721ceef43d48fb22c35
    resource: repo://frontend/src/context/ws-client-provider.tsx
  - id: openwiki-source-71cade68435ab3546fa87680
    resource: repo://frontend/src/routes.ts
  - id: openwiki-source-088038e212593056e5081d6c
    resource: repo://frontend/src/store.ts
  - id: openwiki-source-613b4c79970bb0ed7f1ea285
    resource: repo://openhands-ui/package.json
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Web Frontend and Shared UI

The web app is a React single-page application in `frontend/`. The server serves its build, and it
talks to the backend in two ways: REST calls for conversations, settings, and secrets, and a
Socket.IO connection that streams agent events while a conversation is open. A separate package,
`openhands-ui/`, holds reusable components that the app imports. This page describes how the pieces fit
together. The server side is covered in [Server, Routes, and Conversation Management](../architecture/server-and-conversations.md).

## Build and runtime

- The app is built with `react-router build`, after a step that generates translation bundles
  (`make-i18n`, `scripts/make-i18n-translations.cjs`). The `build`, `dev`, and `dev:mock` scripts in
  `frontend/package.json` all run that step first.
- `VITE_BACKEND_BASE_URL` selects the backend host for both REST and Socket.IO. If it is unset, the
  page uses its own origin (`frontend/src/api/open-hands-axios.ts:4`).
- `VITE_MOCK_API` switches the entry point to mocked responses for development
  (`frontend/src/entry.client.tsx:51`).
- The package requires Node 22 or later (`frontend/package.json`, `engines`).

## Route tree

`frontend/src/routes.ts` declares the routes. Everything is nested under one layout,
`routes/root-layout.tsx`:

| Path | Module | Purpose |
| --- | --- | --- |
| `/` | `routes/home.tsx` | Home page. |
| `/accept-tos` | `routes/accept-tos.tsx` | Terms-of-service acceptance gate. |
| `/settings` and children | `routes/settings.tsx` | Settings shell with LLM (`index`), MCP, user, integrations (git), app, billing, secrets, and API keys pages. |
| `/conversations/:conversationId` | `routes/conversation.tsx` | The conversation workspace. |
| `/microagent-management` | `routes/microagent-management.tsx` | Browse and manage microagents. |

Tab components for the browser, changes, Jupyter, served apps, and VS Code
(`routes/browser-tab.tsx`, `changes-tab.tsx`, `jupyter-tab.tsx`, `served-tab.tsx`, `vscode-tab.tsx`)
present parts of the conversation's workspace state.

## REST client

`frontend/src/api/open-hands.ts` defines the `OpenHands` class of static methods. It wraps the axios
instance in `open-hands-axios.ts`, whose response interceptor normalizes errors. Methods cover:

- conversations: `createConversation` (POST `/api/conversations`), `getUserConversations`,
  `searchConversations`, `deleteUserConversation`, and per-conversation getters under
  `/api/conversations/{id}`;
- feedback, workspace download, web hosts, VS Code URL, and runtime ID for a conversation;
- sub-services grouped in folders: `auth-service`, `git-service`, `option-service`, `secrets-service.ts`,
  `api-keys.ts`, `suggestions-service`, and `user-service`.

The endpoints match the routers described in [Server, Routes, and Conversation Management](../architecture/server-and-conversations.md).
Query hooks under `frontend/src/hooks/query/` and mutation hooks under `hooks/mutation/` wrap these
calls with TanStack Query, which handles caching and refetching.

## Real-time channel

`frontend/src/context/ws-client-provider.tsx` owns the Socket.IO connection.

- It opens the connection with `transports: ["websocket"]` to the backend base URL, using the
  `/socket.io` path (or a path under the backend prefix when one is configured) (`ws-client-provider.tsx:325-340`).
- The handshake query carries `conversation_id`, `latest_event_id` (the ID of the last event already
  shown, or -1), and the conversation's `session_api_key`, because Socket.IO clients cannot send custom
  headers (`ws-client-provider.tsx:310-325`).
- Incoming events arrive on the `oh_event` channel and are passed to `handleMessage`, which routes
  assistant messages through `services/actions.ts` and records everything through `EventLogger`
  (`ws-client-provider.tsx:342`).
- User actions are sent on `oh_user_action` (`ws-client-provider.tsx:156`).
- Connection errors and timeouts are surfaced as chat errors through `showChatError` and tracked with
  `trackError` (`ws-client-provider.tsx:108-123`).

`context/conversation-subscriptions-provider.tsx` and `hooks/use-handle-ws-events.ts` sit alongside the
provider and handle subscriptions and event-to-UI updates.

## State

The Redux store (`frontend/src/store.ts`) combines slices from `frontend/src/state/`:

- `agent-slice` for the agent's current state (running, awaiting input, finished, error);
- `conversation-slice` for the conversation metadata and reset on switch;
- `event-message-slice` for the chat transcript;
- `command-slice` and `jupyter-slice` for terminal and notebook output;
- `browser-slice`, `code-slice`, and `file-state-slice` for the browser, code view, and workspace files;
- `metrics-slice` for cost and token totals;
- `security-analyzer-slice` for risk assessments shown in confirmation prompts;
- `status-slice`, `initial-query-slice`, `microagent-management-slice`.

The `services/` folder holds the code that turns events into state: `chat-service.ts` builds outgoing
messages, `observations.ts` maps observation events to UI state, `actions.ts` handles assistant
messages, `agent-state-service.ts` tracks agent state, and `terminal-service.ts` manages terminal output.

## Shared UI package

`openhands-ui/` is a separate package named `@openhands/ui` with `main` at `dist/index.js`
(`openhands-ui/package.json`). It exports a set of primitive components under `components/`:
accordion, button, checkbox, chip, dialog, divider, icon, input, interactive chip, radio group,
scrollable, select, spinner, tabs, toast, toggle, tooltip, and typography. Shared hooks and types are in
`openhands-ui/shared/`, and design tokens in `tokens.css`. The package peer-depends on React 19.1 or
later. The app imports it rather than duplicating primitives. Its build and publishing steps are in
`openhands-ui/PUBLISHING.md`, and the `npm-publish-ui.yml` workflow publishes it.

## Failure behavior

- The handshake includes `latest_event_id`, so the server can start the event feed after the last event
  the page already shows.
- If the backend returns an error for a request, the axios interceptor converts it to a typed error,
  and the calling query shows it through the chat error path.
- Route-level errors render through the `ErrorBoundary` exported from `root-layout.tsx`.

## Extension seams

- New page: add a route file under `frontend/src/routes/` and register it in `routes.ts`.
- New REST call: add a method to `open-hands.ts` (or a sub-service), then a query or mutation hook.
- New event type: add a handler in `services/` and a slice field if the UI needs state.
- New UI primitive: add it under `openhands-ui/components/` and export it from `index.ts`.

## Tests

Unit tests live in `frontend/__tests__/` (for example `api`, `context`, `hooks`) and beside services in
`frontend/src/services/__tests__/`. They run with Vitest, with setup in `vitest.setup.ts`. End-to-end tests use Playwright (`playwright.config.ts`).

## Related pages

- [Server, Routes, and Conversation Management](../architecture/server-and-conversations.md)
- [Event Model and Event Stream](../architecture/event-stream.md)
- [CLI and Local Launchers](../cli/cli-and-launchers.md)
