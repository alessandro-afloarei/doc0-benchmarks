---
title: "Web Frontend"
---
## Overview

The web frontend is a React application in `frontend/`. It has two channels to the backend. REST calls over axios create conversations, start and stop them, and read their metadata. A Socket.IO connection carries the events of one conversation in each direction. The pages are the routes of the application, and the state they show is kept in Redux slices that the socket events update.

Sources: [frontend/src/api/open-hands-axios.ts:1-5](repo://frontend/src/api/open-hands-axios.ts#L1-L5), [frontend/src/context/ws-client-provider.tsx:130-160](repo://frontend/src/context/ws-client-provider.tsx#L130-L160)

## Routes

The route table is a single layout with a home page, the terms page, the settings pages, the conversation page and the microagent management page. The settings pages are nested under `settings` and are the LLM, MCP, user, integrations, app, billing, secrets and API key pages. The conversation page takes the conversation id from the URL.

Sources: [frontend/src/routes.ts:1-25](repo://frontend/src/routes.ts#L1-L25)

## REST calls

`OpenHands` is a class of static methods, and each method calls one endpoint on the shared axios instance. `createConversation` posts to `/api/conversations`, and `startConversation` and `stopConversation` post to the start and stop endpoints for one conversation. `getConversation` reads one conversation.

Sources: [frontend/src/api/open-hands.ts:257-313](repo://frontend/src/api/open-hands.ts#L257-L313)

The axios instance takes its base URL from `VITE_BACKEND_BASE_URL`, and falls back to the page's own host. This lets the same build talk to a backend on another host.

Sources: [frontend/src/api/open-hands-axios.ts:1-5](repo://frontend/src/api/open-hands-axios.ts#L1-L5)

## Socket connection

`WsClientProvider` opens the Socket.IO connection. It passes `conversation_id`, the id of the last event it has, the provider list and the session key in the query string. The last event id lets the server replay only what the page has not seen. The socket uses the websocket transport only.

Sources: [frontend/src/context/ws-client-provider.tsx:305-318](repo://frontend/src/context/ws-client-provider.tsx#L305-L318), [frontend/src/context/ws-client-provider.tsx:321-338](repo://frontend/src/context/ws-client-provider.tsx#L321-L338)

The provider sets the socket path to `/socket.io`, or to a path under the backend's `api` prefix when the base URL has one. It listens for `connect`, `oh_event`, `connect_error`, `connect_failed` and `disconnect`, and removes those listeners when it unmounts.

Sources: [frontend/src/context/ws-client-provider.tsx:321-358](repo://frontend/src/context/ws-client-provider.tsx#L321-L358)

The `oh_event` handler passes each event to `handleAssistantMessage` and then checks for error states. A status update of type `error`, or an agent state change to `error`, is treated as an error and handled by the error path of the provider.

Sources: [frontend/src/context/ws-client-provider.tsx:164-185](repo://frontend/src/context/ws-client-provider.tsx#L164-L185)

Sending works the other way. The provider emits each user action as `oh_user_action`, which the server's socket handler accepts. The server side is in [[Client Sessions and Socket.IO]].

Sources: [frontend/src/context/ws-client-provider.tsx:150-158](repo://frontend/src/context/ws-client-provider.tsx#L150-L158)

## Events into state

`handleAssistantMessage` routes an event by its shape. An event with an `action` field goes to `handleActionMessage`, which updates the metrics when the message carries them. An event with an `observation` field goes to `handleObservationMessage`. An event with a `status_update` field goes to `handleStatusMessage`.

Sources: [frontend/src/services/actions.ts:69-77](repo://frontend/src/services/actions.ts#L69-L77), [frontend/src/services/actions.ts:17-44](repo://frontend/src/services/actions.ts#L17-L44)

`handleObservationMessage` switches on the observation type. A command result dispatches its output to the store, and browser results dispatch the screenshot and URL updates. Hidden observations are skipped.

Sources: [frontend/src/services/observations.ts:9-41](repo://frontend/src/services/observations.ts#L9-L41)

The store combines the slices in one root reducer. The slices are file state, initial query, browser, code, command, agent, Jupyter, security analyzer, status, metrics, microagent management, conversation and event message.

Sources: [frontend/src/store.ts:1-40](repo://frontend/src/store.ts#L1-L40)

The conversation slice is created with Redux Toolkit's `createSlice`, as are the other slices in the state folder.

Sources: [frontend/src/state/conversation-slice.tsx:1-30](repo://frontend/src/state/conversation-slice.tsx#L1-L30)

The meaning of the events the frontend renders is described in [[Events and the Event Stream]], and the backend that sends them is described in [[Conversation Lifecycle]].

Sources: [openhands/events/stream.py:163-204](repo://openhands/events/stream.py#L163-L204), [openhands/server/routes/manage_conversations.py:473-508](repo://openhands/server/routes/manage_conversations.py#L473-L508)
