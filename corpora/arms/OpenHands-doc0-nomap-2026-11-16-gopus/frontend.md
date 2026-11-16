---
title: "Frontend Web App"
---
## Overview

The frontend in `frontend/` is the web GUI: a React single-page app built with React Router in SPA mode and Vite, using Redux for live conversation state, TanStack Query for server data, Tailwind CSS for styling and i18next for translations. It talks to the server two ways: REST calls through an axios client for settings, conversations, files and git data, and one Socket.IO connection per open conversation for the live event stream.

Sources: [frontend/README.md:1-20](repo://frontend/README.md#L1-L20), [frontend/src/api/open-hands-axios.ts:1-60](repo://frontend/src/api/open-hands-axios.ts#L1-L60), [frontend/src/context/ws-client-provider.tsx:130-160](repo://frontend/src/context/ws-client-provider.tsx#L130-L160)

In production the server serves the built app from `frontend/build`, as [[Web Server and REST API]] describes. During development `make start-frontend` runs the Vite dev server against the backend, or `npm run dev` runs it against a partial mock of the backend built with `msw`.

Sources: [openhands/server/listen.py:15-18](repo://openhands/server/listen.py#L15-L18), [Makefile:254-263](repo://Makefile#L254-L263), [frontend/README.md:20-60](repo://frontend/README.md#L20-L60)

## Routes

| Path | Route module | Page |
| --- | --- | --- |
| `/` | `home.tsx` | Home: start a new conversation |
| `/accept-tos` | `accept-tos.tsx` | Terms of service |
| `/settings` | `llm-settings.tsx` | LLM settings (index) |
| `/settings/mcp`, `/user`, `/integrations`, `/app`, `/billing`, `/secrets`, `/api-keys` | one module each | MCP servers, user, git providers, application, billing, secrets, API keys |
| `/conversations/:conversationId` | `conversation.tsx` | A conversation |
| `/microagent-management` | `microagent-management.tsx` | Browse and manage repository microagents |

Sources: [frontend/src/routes.ts:1-25](repo://frontend/src/routes.ts#L1-L25)

All of them render inside `root-layout.tsx`. The settings pages read and write the stores described in [[Storage]] through the settings and secrets routes.

Sources: [frontend/src/routes.ts:8-24](repo://frontend/src/routes.ts#L8-L24)

## The REST client

`openHands` is an axios instance whose base URL is the page's host, or `VITE_BACKEND_BASE_URL` when set. A response interceptor reloads the page on a 403 that reports an unverified email, unless the user is already on the user settings page.

Sources: [frontend/src/api/open-hands-axios.ts:1-60](repo://frontend/src/api/open-hands-axios.ts#L1-L60)

The `OpenHands` class wraps the endpoints as static methods: listing, searching, creating, starting, stopping, renaming and deleting conversations; workspace files, uploads and zip download; git changes and diffs; VS Code URL, web hosts and runtime id; microagents; feedback; trajectories; and billing. Smaller services in `frontend/src/api` cover authentication, git, options, secrets, suggestions and users.

Sources: [frontend/src/api/open-hands.ts:71-182](repo://frontend/src/api/open-hands.ts#L71-L182), [frontend/src/api/open-hands.ts:182-300](repo://frontend/src/api/open-hands.ts#L182-L300), [frontend/src/api/open-hands.ts:347-490](repo://frontend/src/api/open-hands.ts#L347-L490)

Calls about one conversation go to `getConversationUrl(id)`. For the current conversation that is the `url` the server returned with it, otherwise `/api/conversations/<id>`, and `getConversationHeaders` adds its `session_api_key` as `X-Session-API-Key`. This is what lets the same frontend talk to a conversation hosted elsewhere, such as a nested server in a runtime container, as [[Conversations and Sessions]] describes.

Sources: [frontend/src/api/open-hands.ts:31-67](repo://frontend/src/api/open-hands.ts#L31-L67)

## Server state with TanStack Query

Data fetched over REST lives in TanStack Query caches, through one hook per query in `frontend/src/hooks/query` (settings, the active conversation, conversations, repositories and branches, git changes and diffs, microagents, secrets, suggested tasks and more) and one per mutation in `frontend/src/hooks/mutation`. The WebSocket provider invalidates these caches when events show they are stale.

Sources: [frontend/src/hooks/query/use-active-conversation.ts:1-26](repo://frontend/src/hooks/query/use-active-conversation.ts#L1-L26), [frontend/src/context/ws-client-provider.tsx:204-256](repo://frontend/src/context/ws-client-provider.tsx#L204-L256)

## The conversation page

`conversation.tsx` loads the active conversation and redirects home if it does not exist. If its status is `STOPPED` it calls `startConversation` with the user's providers. On entry it clears the terminal, Jupyter and conversation state and sets the agent state to `LOADING`. It then wraps the page in `WsClientProvider`, `ConversationSubscriptionsProvider` and `EventHandler`, and renders the chat next to the conversation tabs.

Sources: [frontend/src/routes/conversation.tsx:32-90](repo://frontend/src/routes/conversation.tsx#L32-L90)

The tabs show different views of the same runtime: the editor (changed files and diffs), VS Code (the in-sandbox VS Code server), a terminal of command input and output, Jupyter cells, the served app on the runtime's web hosts, and the agent's browser.

Sources: [frontend/src/components/features/conversation/conversation-tabs/conversation-tabs.tsx:85-130](repo://frontend/src/components/features/conversation/conversation-tabs/conversation-tabs.tsx#L85-L130)

## The WebSocket client

`WsClientProvider` opens the conversation's Socket.IO connection once the conversation is running or has a runtime status. The query string carries `conversation_id`, `latest_event_id` (the last event it has, or -1), the user's `providers_set`, and `session_api_key`, which goes in the query because Socket.IO cannot set custom headers. When the conversation has a remote `url`, the socket connects to that host with the path prefix in front of `/socket.io`; otherwise it uses the page's host. Only the WebSocket transport is used.

Sources: [frontend/src/context/ws-client-provider.tsx:295-360](repo://frontend/src/context/ws-client-provider.tsx#L295-L360)

These parameters match what the server's `connect` handler reads, and its replay of history from `latest_event_id + 1` is why the provider remembers the last event: on disconnect it writes that id back into the query, so a reconnect only receives what it missed.

Sources: [frontend/src/context/ws-client-provider.tsx:258-270](repo://frontend/src/context/ws-client-provider.tsx#L258-L270), [openhands/server/listen_socket.py:35-118](repo://openhands/server/listen_socket.py#L35-L118)

`send(event)` emits `oh_user_action`, which the server turns into a user event on the stream. Whatever the UI sends into the conversation, such as a user message or a `change_agent_state` action, goes this way.

Sources: [frontend/src/context/ws-client-provider.tsx:151-157](repo://frontend/src/context/ws-client-provider.tsx#L151-L157), [openhands/server/listen_socket.py:143-153](repo://openhands/server/listen_socket.py#L143-L153)

## Handling events

Every `oh_event` goes to `handleMessage`. It first runs `handleAssistantMessage`, which updates Redux, and then:

Sources: [frontend/src/context/ws-client-provider.tsx:164-166](repo://frontend/src/context/ws-client-provider.tsx#L164-L166)

- An error status update, or an agent state change to `error`, becomes the page's error message and is tracked.
- Actions and observations are appended to `parsedEvents`, the list the chat renders.
- A user message removes the optimistic copy the chat showed while sending.
- File edits, file writes and commands invalidate the `file_changes` query, and edits and writes also invalidate that file's `file_diff`, with the repository directory stripped from the path.

Sources: [frontend/src/context/ws-client-provider.tsx:164-256](repo://frontend/src/context/ws-client-provider.tsx#L164-L256)

`handleAssistantMessage` routes by shape. Actions update the Redux slices: LLM metrics into `metrics`, command input into the terminal, IPython code into Jupyter, and actions with a `security_risk` into the security analyzer's list. Observations update the matching slices with output. Status updates set the status message, and an `info` update carrying `conversation_title` renames the conversation.

Sources: [frontend/src/services/actions.ts:17-77](repo://frontend/src/services/actions.ts#L17-L77)

## Redux state

The Redux store combines one slice per live view: `agent` (agent state), `browser`, `code`, `cmd` (terminal), `jupyter`, `fileState`, `securityAnalyzer`, `status`, `metrics`, `conversation`, `eventMessage`, `initialQuery` and `microagentManagement`. These hold what the server pushes over the socket, while TanStack Query holds what the frontend fetches.

Sources: [frontend/src/store.ts:1-40](repo://frontend/src/store.ts#L1-L40)

## Background subscriptions

`ConversationSubscriptionsProvider` can open extra Socket.IO connections to conversations other than the one on screen. Its handler shows a toast when such a conversation starts its runtime, errors, or changes state, so the user hears about it without opening it.

Sources: [frontend/src/context/conversation-subscriptions-provider.tsx:180-262](repo://frontend/src/context/conversation-subscriptions-provider.tsx#L180-L262)
