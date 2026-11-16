---
title: "Web Frontend"
---
## Overview

The frontend is a React single-page app under `frontend/src`. The route table mounts every page under one layout, which loads the user's session and settings before it renders. A conversation page opens a Socket.IO connection to the server, sends the user's messages as `oh_user_action` events, and turns each `oh_event` it receives into actions and observations in Redux state. REST calls, made through an API client, cover everything that is not a live conversation.

Sources: [frontend/src/routes.ts:8-25](repo://frontend/src/routes.ts#L8-L25) [frontend/src/routes/root-layout.tsx:65-80](repo://frontend/src/routes/root-layout.tsx#L65-L80)

## Routes and layout

`routes.ts` nests every page under one `root-layout.tsx` layout. The settings pages sit under `settings`, and each one is a child route: LLM, MCP, user, integrations, app, billing, secrets and API keys. The conversation page is `conversations/:conversationId`, and the microagent manager is a page of its own.

Sources: [frontend/src/routes.ts:8-25](repo://frontend/src/routes.ts#L8-L25)

`MainApp` reads the server configuration and the authentication state, and it renders the child route through `Outlet`.

Sources: [frontend/src/routes/root-layout.tsx:65-80](repo://frontend/src/routes/root-layout.tsx#L65-L80) [frontend/src/routes/root-layout.tsx:217-217](repo://frontend/src/routes/root-layout.tsx#L217-L217)

## REST client

`OpenHands` is a class of static methods. They cover feedback, the workspace zip, web hosts, the VS Code URL, the runtime id, and the conversation list, search and delete. The class also keeps the current conversation in a static field.

Sources: [frontend/src/api/open-hands.ts:24-26](repo://frontend/src/api/open-hands.ts#L24-L26) [frontend/src/api/open-hands.ts:71-87](repo://frontend/src/api/open-hands.ts#L71-L87) [frontend/src/api/open-hands.ts:169-181](repo://frontend/src/api/open-hands.ts#L169-L181) [frontend/src/api/open-hands.ts:253-256](repo://frontend/src/api/open-hands.ts#L253-L256)

## Sending a message

`createChatMessage` builds an event with the `message` action type, the text, the image and file URLs, and a timestamp. The websocket provider's `send` emits that event on the `oh_user_action` channel of the open socket. If the socket is not connected, `send` logs an error and sends nothing.

Sources: [frontend/src/services/chat-service.ts:3-14](repo://frontend/src/services/chat-service.ts#L3-L14) [frontend/src/context/ws-client-provider.tsx:150-157](repo://frontend/src/context/ws-client-provider.tsx#L150-L157)

## Receiving events

The provider registers `handleMessage` for the `oh_event` channel. Each message goes first to `handleAssistantMessage`. Status updates and agent-state changes with an error state are shown as an error and stop the handler. Actions and observations are added to the parsed event list. An error observation is also tracked as an error.

Sources: [frontend/src/context/ws-client-provider.tsx:341-343](repo://frontend/src/context/ws-client-provider.tsx#L341-L343) [frontend/src/context/ws-client-provider.tsx:164-199](repo://frontend/src/context/ws-client-provider.tsx#L164-L199)

`handleAssistantMessage` routes a message to `handleActionMessage` or `handleObservationMessage` by its kind. `handleActionMessage` drops hidden actions and copies the LLM metrics into the metrics slice before it updates the rest of the state.

Sources: [frontend/src/services/actions.ts:69-75](repo://frontend/src/services/actions.ts#L69-L75) [frontend/src/services/actions.ts:17-30](repo://frontend/src/services/actions.ts#L17-L30)

## State

The store combines the reducers in `store.ts` into one root reducer and creates the store from it. The slices include agent, browser, code, command, conversation, event messages, metrics, security analyzer, status, and microagent management. The event-message slice exports `addSubmittedEventId` and `removeSubmittedEventId` to track the ids of events the user has submitted. The conversation slice defines the conversation tab type and the `IMessageToSend` type.

Sources: [frontend/src/store.ts:1-16](repo://frontend/src/store.ts#L1-L16) [frontend/src/store.ts:32-36](repo://frontend/src/store.ts#L32-L36) [frontend/src/state/event-message-slice.tsx:3-22](repo://frontend/src/state/event-message-slice.tsx#L3-L22) [frontend/src/state/conversation-slice.tsx:30-35](repo://frontend/src/state/conversation-slice.tsx#L30-L35)

The provider creates the socket with the server's base URL and the connection options, and it removes its `oh_event` listener during cleanup.

Sources: [frontend/src/context/ws-client-provider.tsx:335-352](repo://frontend/src/context/ws-client-provider.tsx#L335-L352)
