---
title: "Web Frontend"
---
## Overview

The web interface is a React single-page application in `frontend/`, built with React Router in SPA mode on Vite, TypeScript, Redux Toolkit, TanStack Query, Tailwind CSS and i18next. It talks to the server in two ways: REST calls for everything that is request and response (conversations, settings, files, git), and one Socket.IO connection per open conversation for the live event stream. The production build is served by the Python server itself from `frontend/build`.

Sources: [frontend/README.md:1-20](repo://frontend/README.md#L1-L20), [frontend/package.json:17-59](repo://frontend/package.json#L17-L59), [openhands/server/listen.py:15-18](repo://openhands/server/listen.py#L15-L18)

The server side of these channels is on [[Server Application and REST API]] and [[Sessions and Socket.IO]].

Sources: [openhands/server/listen_socket.py:35-140](repo://openhands/server/listen_socket.py#L35-L140), [openhands/server/listen_socket.py:143-158](repo://openhands/server/listen_socket.py#L143-L158)

## Routes

The route table nests every page in a root layout:

Sources: [frontend/src/routes.ts:8-9](repo://frontend/src/routes.ts#L8-L9)

| Path | Page |
| --- | --- |
| `/` | home: start a conversation from a repository, a suggested task or a prompt |
| `/conversations/:conversationId` | the conversation workspace |
| `/settings` (index) | LLM settings |
| `/settings/mcp`, `/user`, `/integrations`, `/app`, `/secrets`, `/api-keys`, `/billing` | MCP servers, user, git provider tokens, app preferences, custom secrets, API keys, billing |
| `/microagent-management` | browse and edit repository microagents |
| `/accept-tos` | terms of service |

Sources: [frontend/src/routes.ts:1-25](repo://frontend/src/routes.ts#L1-L25)

`npm run dev` starts the Vite dev server (after generating the translation files), `npm run build` builds into `build/`, and `npm run test` runs Vitest. `make start-frontend` runs the dev server pointed at the local backend through `VITE_BACKEND_HOST`.

Sources: [frontend/package.json:60-75](repo://frontend/package.json#L60-L75), [Makefile:254-263](repo://Makefile#L254-L263)

## REST client

### The axios instance

All REST calls go through one axios instance whose base URL is `VITE_BACKEND_BASE_URL` or the page's own host. The module also defines a check that looks for an `EmailNotVerifiedError` in error responses.

Sources: [frontend/src/api/open-hands-axios.ts:1-40](repo://frontend/src/api/open-hands-axios.ts#L1-L40)

### The OpenHands service class

`OpenHands` in `api/open-hands.ts` wraps the endpoints as static methods: creating, listing, searching, starting, stopping, updating and deleting conversations; feedback; workspace zip, files and uploads; VS Code URL and web hosts; git changes and diffs; microagents; trajectory; and billing. Other services in `api/` cover settings, secrets, git, auth and options.

Sources: [frontend/src/api/open-hands.ts:71-170](repo://frontend/src/api/open-hands.ts#L71-L170), [frontend/src/api/open-hands.ts:182-260](repo://frontend/src/api/open-hands.ts#L182-L260), [frontend/src/api/open-hands.ts:257-315](repo://frontend/src/api/open-hands.ts#L257-L315), [frontend/src/api/open-hands.ts:316-420](repo://frontend/src/api/open-hands.ts#L316-L420), [frontend/src/api/open-hands.ts:420-480](repo://frontend/src/api/open-hands.ts#L420-L480)

`createConversation` posts the repository, provider, branch, first message, suggested task, conversation instructions and microagent request to `POST /api/conversations`; `startConversation` posts the user's providers to `/start`.

Sources: [frontend/src/api/open-hands.ts:257-304](repo://frontend/src/api/open-hands.ts#L257-L304)

### Queries and mutations

Components read server data through TanStack Query hooks in `hooks/query` (settings, conversations, repositories, branches, suggested tasks, git changes, microagents, VS Code URL and more) and change it through hooks in `hooks/mutation`. The shared `QueryClient` shows each distinct error once as a toast within three seconds, and on any 401 invalidates the authentication query so the app re-checks login.

Sources: [frontend/src/query-client-config.ts:1-45](repo://frontend/src/query-client-config.ts#L1-L45), [frontend/src/hooks/query/use-settings.ts:1-20](repo://frontend/src/hooks/query/use-settings.ts#L1-L20)

## The live connection

### WsClientProvider

The conversation page wraps its content in `WsClientProvider`. Once the conversation is `RUNNING` or reports a runtime status, the provider opens a Socket.IO connection over WebSocket with the query parameters `conversation_id`, `latest_event_id` (the last event it has, or -1), `providers_set` and `session_api_key`; the key is passed in the query because Socket.IO cannot send custom headers. When the conversation has its own URL, as with nested servers in the cloud, the socket connects to that host and path instead of the page's.

Sources: [frontend/src/context/ws-client-provider.tsx:296-345](repo://frontend/src/context/ws-client-provider.tsx#L296-L345), [frontend/src/routes/conversation.tsx:77-95](repo://frontend/src/routes/conversation.tsx#L77-L95)

`send(event)` emits `oh_user_action`. On disconnect, the provider records the last event id in the socket's query so the reconnection replays only what was missed.

Sources: [frontend/src/context/ws-client-provider.tsx:149-156](repo://frontend/src/context/ws-client-provider.tsx#L149-L156), [frontend/src/context/ws-client-provider.tsx:255-268](repo://frontend/src/context/ws-client-provider.tsx#L255-L268)

### Handling oh_event

Every `oh_event` goes to `handleMessage`:

Sources: [frontend/src/context/ws-client-provider.tsx:342-342](repo://frontend/src/context/ws-client-provider.tsx#L342-L342)

1. `handleAssistantMessage` routes actions, observations and status updates to the Redux slices.
2. A status update or agent-state change of type error becomes the visible error message.
3. Actions and observations are added to the parsed event list that the chat renders.
4. File edits, file writes and commands invalidate the cached git changes and that file's diff, without refetching while events arrive quickly, such as during the replay of an existing conversation.
5. The last event with a numeric id is remembered for reconnection.

Sources: [frontend/src/context/ws-client-provider.tsx:162-253](repo://frontend/src/context/ws-client-provider.tsx#L162-L253)

`useHandleWSEvents` shows server errors as toasts and, when an error says the agent reached its maximum, sends a `change_agent_state` event to `paused`, so the user can resume and extend the limit.

Sources: [frontend/src/hooks/use-handle-ws-events.ts:15-46](repo://frontend/src/hooks/use-handle-ws-events.ts#L15-L46), [frontend/src/services/agent-state-service.ts:1-7](repo://frontend/src/services/agent-state-service.ts#L1-L7)

## State

The Redux store combines slices for each part of the workspace: agent state, browser (URL and screenshot), code, terminal commands, Jupyter cells, file state, the initial query, security analyzer, status messages, metrics (cost, budget, tokens), conversation, event messages and microagent management.

Sources: [frontend/src/store.ts:1-40](repo://frontend/src/store.ts#L1-L40)

The event services fill them: `handleActionMessage` updates metrics from each action's `llm_metrics` and appends commands and Jupyter code; `handleObservationMessage` appends command output (keeping the first and last 2,500 characters of long outputs), browser URLs and screenshots; `handleStatusMessage` refreshes the conversation title or shows the current status.

Sources: [frontend/src/services/actions.ts:17-77](repo://frontend/src/services/actions.ts#L17-L77), [frontend/src/services/observations.ts:9-80](repo://frontend/src/services/observations.ts#L9-L80)

## The conversation workspace

On opening a conversation, the page clears the terminal and Jupyter state, sets the agent state to loading, and calls `startConversation` if the conversation is stopped; an unknown conversation sends the user home with an error. The workspace shows the chat beside tabbed panels: changes (git diff of the workspace), browser, Jupyter, served app (the sandbox's web hosts), VS Code (an iframe of the sandbox's VS Code server) and terminal, each loaded lazily.

Sources: [frontend/src/routes/conversation.tsx:40-75](repo://frontend/src/routes/conversation.tsx#L40-L75), [frontend/src/components/features/conversation/conversation-tabs/conversation-tab-content.tsx:1-60](repo://frontend/src/components/features/conversation/conversation-tabs/conversation-tab-content.tsx#L1-L60)

## Mocks

`src/mocks` holds Mock Service Worker handlers for the REST API and the socket. `npm run dev:mock` (and `dev:mock:saas` for the cloud variant) starts the dev server with `VITE_MOCK_API=true`, which makes the client entry start the mock worker, so the UI can be developed without a backend; tests use the same handlers.

Sources: [frontend/package.json:64-66](repo://frontend/package.json#L64-L66), [frontend/src/entry.client.tsx:45-60](repo://frontend/src/entry.client.tsx#L45-L60)
