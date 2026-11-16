---
title: "Web Frontend"
---
## Overview

The web UI in `frontend/` is a React single-page app routed with React Router. It talks to the backend in two ways: REST calls through an axios instance, cached and refreshed with TanStack Query, and one Socket.IO connection per open conversation that delivers `oh_event` messages and carries the user's actions back. Server-pushed events are stored in React state and mirrored into a Redux store that drives the terminal, Jupyter, browser and metrics panels. The backend side is described in [[Server, Conversations and Sessions]]; the event shapes come from [[Events and the Event Stream]].

Sources: [frontend/src/api/open-hands-axios.ts:1-5](repo://frontend/src/api/open-hands-axios.ts#L1-L5), [frontend/src/context/ws-client-provider.tsx:130-157](repo://frontend/src/context/ws-client-provider.tsx#L130-L157), [frontend/src/store.ts:16-40](repo://frontend/src/store.ts#L16-L40)

## Routes

`routes.ts` declares one layout, `root-layout.tsx`, wrapping every page: the home screen, `accept-tos`, a `settings` group (LLM settings as the index, then `mcp`, `user`, `integrations`, `app`, `billing`, `secrets` and `api-keys`), `conversations/:conversationId` and `microagent-management`.

Sources: [frontend/src/routes.ts:8-25](repo://frontend/src/routes.ts#L8-L25)

The root layout (`MainApp`) runs the app-wide effects. It reads settings, config and authentication state with queries, starts auto-login and the auth callback hooks, sets the UI language from the settings, redirects to `/` when a billing request fails with HTTP 402, and renders an authentication modal when the user is not logged in (except on the terms page).

Sources: [frontend/src/routes/root-layout.tsx:65-135](repo://frontend/src/routes/root-layout.tsx#L65-L135), [frontend/src/routes/root-layout.tsx:140-190](repo://frontend/src/routes/root-layout.tsx#L140-L190)

## Talking to the REST API

`openHands` is an axios instance whose base URL is `VITE_BACKEND_BASE_URL` or the page's own host. A response interceptor reloads the page on a 403 that carries an email-verification error (unless already on `/settings/user`). The `OpenHands` class in `api/open-hands.ts` wraps the endpoints as static methods, for example `createConversation` posting to `/api/conversations` with the repository, provider, branch, initial message, suggested task, instructions and microagent request, `startConversation` posting to `/api/conversations/{id}/start`, and trajectory, git-changes, file and feedback calls. Settings use `/api/settings`.

Sources: [frontend/src/api/open-hands-axios.ts:1-60](repo://frontend/src/api/open-hands-axios.ts#L1-L60), [frontend/src/api/open-hands.ts:257-312](repo://frontend/src/api/open-hands.ts#L257-L312), [frontend/src/settings-service/settings-service.api.ts:11-24](repo://frontend/src/settings-service/settings-service.api.ts#L11-L24)

Components do not call these directly. Hooks under `hooks/query` and `hooks/mutation` wrap each call; for example `useSettings` caches settings under the query key `settings` for five minutes and does not retry a 404, which means "no settings saved yet". The shared `QueryClient` invalidates the authentication query on any 401 and shows an error toast once per distinct message.

Sources: [frontend/src/hooks/query/use-settings.ts:10-56](repo://frontend/src/hooks/query/use-settings.ts#L10-L56), [frontend/src/query-client-config.ts:8-30](repo://frontend/src/query-client-config.ts#L8-L30)

## The conversation page

The `conversations/:conversationId` route renders `AppContent`. It loads the conversation, redirects home with a toast if it does not exist, and if the conversation's status is `STOPPED` it calls `startConversation` and refetches. On every conversation change it clears the terminal and Jupyter slices, resets conversation state and sets the agent state to `LOADING`. It then nests `WsClientProvider`, `ConversationSubscriptionsProvider` and `EventHandler` around the layout: the conversation name, tabs and `ConversationMain`.

Sources: [frontend/src/routes/conversation.tsx:32-97](repo://frontend/src/routes/conversation.tsx#L32-L97)

`ConversationMain` shows the chat on its own, or in a resizable panel next to the right-hand tab area (editor changes, browser, Jupyter, served app, VS Code and terminal) when `isRightPanelShown` is set.

Sources: [frontend/src/components/features/conversation/conversation-main.tsx:9-60](repo://frontend/src/components/features/conversation/conversation-main.tsx#L9-L60), [frontend/src/components/features/conversation/conversation-tabs/conversation-tab-content.tsx:11-34](repo://frontend/src/components/features/conversation/conversation-tabs/conversation-tab-content.tsx#L11-L34)

## The WebSocket client

`WsClientProvider` owns the socket. It waits until the conversation is `RUNNING` (or has a `runtime_status`), then connects with `socket.io-client` using only the `websocket` transport and a query string of `latest_event_id`, `conversation_id`, `providers_set` and `session_api_key`. The key goes in the query because the comments say Socket.IO has no custom header support. If the conversation has its own absolute URL, the socket connects to that host with a path prefix, which is how a nested runtime is reached.

Sources: [frontend/src/context/ws-client-provider.tsx:295-362](repo://frontend/src/context/ws-client-provider.tsx#L295-L362)

These query parameters are what the server reads in its `connect` handler: `latest_event_id` makes the server replay only the events after the last one the client has seen ([[Server, Conversations and Sessions]]). The client keeps that value current: on disconnect it stores the id of the last numeric-id event in the socket's options so a reconnect resumes where it stopped.

Sources: [frontend/src/context/ws-client-provider.tsx:258-269](repo://frontend/src/context/ws-client-provider.tsx#L258-L269), [openhands/server/listen_socket.py:35-60](repo://openhands/server/listen_socket.py#L35-L60)

`handleMessage` is the `oh_event` handler, and works through five steps.

Sources: [frontend/src/context/ws-client-provider.tsx:164-170](repo://frontend/src/context/ws-client-provider.tsx#L164-L170)

1. Passes the event to `handleAssistantMessage` (see below).
2. For an event with id, source, message and timestamp, treats a status-update error or an agent state change to `error` as a chat error, shows it, and stops processing.
3. Otherwise appends actions and observations to `parsedEvents`, clears the displayed error, removes the optimistic copy of a user message when the server echoes it, and records message times for the loading-rate heuristic (`isLoadingMessages` is true while messages arrive faster than the 250 ms threshold, which is how history replay is detected).
4. When the event is a file edit, a file write or a command, invalidates the cached `file_changes` query and, for edits and writes, the cached diff of that file.
5. Appends the raw event to `events`.

Sources: [frontend/src/context/ws-client-provider.tsx:164-256](repo://frontend/src/context/ws-client-provider.tsx#L164-L256), [frontend/src/context/ws-client-provider.tsx:375-385](repo://frontend/src/context/ws-client-provider.tsx#L375-L385)

The provider exposes `webSocketStatus`, `isLoadingMessages`, `events`, `parsedEvents` and `send`. `send` emits `oh_user_action`; a client action such as a user message or a state change takes the same shape as the server's `event_from_dict` input. `useHandleWSEvents` watches the last event: a server error object shows a toast (a 401 says the session expired), and an error starting with `Agent reached maximum` makes the client send a `PAUSED` state change, so that resuming extends the limits ([[Agent Controller Loop]]).

Sources: [frontend/src/context/ws-client-provider.tsx:72-88](repo://frontend/src/context/ws-client-provider.tsx#L72-L88), [frontend/src/context/ws-client-provider.tsx:151-157](repo://frontend/src/context/ws-client-provider.tsx#L151-L157), [frontend/src/hooks/use-handle-ws-events.ts:15-46](repo://frontend/src/hooks/use-handle-ws-events.ts#L15-L46), [frontend/src/services/agent-state-service.ts:4-7](repo://frontend/src/services/agent-state-service.ts#L4-L7)

## Redux state

`store.ts` combines slices for the agent state, browser, code, terminal command, Jupyter, security analyzer, status, metrics, conversation UI, file state, initial query, microagent management and event messages. Incoming events update them through two service modules. `handleActionMessage` stores LLM metrics (cost, budget, token usage) in the metrics slice, appends a `run` action's command to the terminal and an IPython action's code to Jupyter, and records actions that carry a `security_risk` in the security analyzer slice; it ignores hidden actions. `handleObservationMessage` appends command output (truncating anything over 5,000 characters to its first and last 2,500), Jupyter output with images, browser URL and screenshot, and sets the agent state from `agent_state_changed`. Status messages with a `conversation_title` invalidate the conversation query so the new title appears.

Sources: [frontend/src/store.ts:16-30](repo://frontend/src/store.ts#L16-L30), [frontend/src/services/actions.ts:17-77](repo://frontend/src/services/actions.ts#L17-L77), [frontend/src/services/observations.ts:9-59](repo://frontend/src/services/observations.ts#L9-L59)

## Chat rendering

`ChatInterface` reads `parsedEvents` from the WebSocket context and filters them with `shouldRenderEvent`, which hides system messages, agent-state changes, recall actions, think observations and any command or command output with source `user`. The remaining events are shown by `Messages`; a typing indicator is shown while the agent state is `RUNNING`, and `Messages` is told when the state is `AWAITING_USER_CONFIRMATION` (the state described in [[Agent Controller Loop]]).

Sources: [frontend/src/components/features/chat/chat-interface.tsx:44-80](repo://frontend/src/components/features/chat/chat-interface.tsx#L44-L80), [frontend/src/components/features/chat/event-content-helpers/should-render-event.ts:10-47](repo://frontend/src/components/features/chat/event-content-helpers/should-render-event.ts#L10-L47), [frontend/src/components/features/chat/chat-interface.tsx:195-225](repo://frontend/src/components/features/chat/chat-interface.tsx#L195-L225)

`handleSendMessage` validates the attached files, converts images to base64 data URLs, uploads the other files through the upload endpoint, appends the uploaded paths to the prompt text, and calls `send(createChatMessage(prompt, imageUrls, uploadedFiles, timestamp))`. It stores an optimistic copy of the message first, so the chat shows it at once. The stop button sends a `STOPPED` state change.

Sources: [frontend/src/components/features/chat/chat-interface.tsx:90-147](repo://frontend/src/components/features/chat/chat-interface.tsx#L90-L147)

## Development

`npm run dev` runs `react-router dev` with the mock API off; `dev:mock` and `dev:mock:saas` run it against mocked responses. `npm run build` produces the static build that the backend serves from `./frontend/build` when `SERVE_FRONTEND` is true ([[Quickstart]]). Tests run with `vitest` and end-to-end tests with Playwright.

Sources: [frontend/package.json:62-73](repo://frontend/package.json#L62-L73), [openhands/server/listen.py:15-18](repo://openhands/server/listen.py#L15-L18)
