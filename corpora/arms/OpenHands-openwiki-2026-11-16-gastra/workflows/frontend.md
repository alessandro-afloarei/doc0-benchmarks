---
type: workflow
title: Frontend conversation workflow
description: React routing, REST mutations, Socket.IO replay and live events, state ownership, cache invalidation, and the separate reusable UI package.
tags: [frontend, react, websocket, conversations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:14:39.912Z
sources:
  - id: openwiki-source-1047363cf615000e4c9bb694
    resource: repo://frontend/package.json
  - id: openwiki-source-b18e9242e8b5eda6fb47c473
    resource: repo://frontend/react-router.config.ts
  - id: openwiki-source-9187b2942d20e9bda777d7ad
    resource: repo://frontend/src/api/open-hands.ts
  - id: openwiki-source-c25e6721ceef43d48fb22c35
    resource: repo://frontend/src/context/ws-client-provider.tsx
  - id: openwiki-source-3179d3ce3d08ff9bfc0fceb8
    resource: repo://frontend/src/hooks/mutation/use-create-conversation.ts
  - id: openwiki-source-85badec3163ca8ed74ecf00f
    resource: repo://frontend/src/routes/conversation.tsx
  - id: openwiki-source-c46258d1e4d2d1b2d3099e02
    resource: repo://frontend/src/services/actions.ts
  - id: openwiki-source-f574b65dfc2f0f277a05ce1f
    resource: repo://frontend/src/services/observations.ts
  - id: openwiki-source-613b4c79970bb0ed7f1ea285
    resource: repo://openhands-ui/package.json
generated: { by: "codex", at: "2026-11-16T08:14:39.912Z" }
---

# Frontend conversation workflow

The application in `frontend/` is a React Router SPA. REST requests create and manage conversations; Socket.IO carries user actions and streamed events. Redux stores environment/display state, React Query caches server resources, and socket providers maintain event lists and connection state.

## Routes and build

`src/routes.ts` defines home, settings, conversation, terms, and microagent-management routes. The conversation route is `conversations/:conversationId`. `react-router.config.ts` disables SSR and moves the built client output into `frontend/build`, which the Python server can serve.

Use current package scripts: `npm run dev` explicitly disables mock APIs; `dev:mock` and `dev:mock:saas` enable the mock layer. Build generates translations before React Router compilation. Older README wording that describes plain `dev` as mocked does not match these scripts.

## Creating and entering a conversation

`useCreateConversation` calls `OpenHands.createConversation` with the user query, repository/provider/branch, optional instructions, and task/microagent options. The API client posts the corresponding fields to `/api/conversations`. Success invalidates the cached conversation list and records analytics metadata.

The conversation route loads the active conversation. A fetched, unavailable conversation for an authenticated user displays an error and redirects home. A stopped conversation can be started through the start endpoint and then refetched. Changing the conversation ID clears terminal, Jupyter, and conversation state and sets the displayed agent state to loading.

The route wraps its content in `WsClientProvider`, a secondary conversation-subscriptions provider, and event handlers. See [sessions and APIs](../architecture/sessions-api.md) for the server half.

## Socket connection and reconnect

The primary provider waits for sufficient conversation status/runtime information before opening a websocket-only Socket.IO connection. Its query includes:

- Conversation ID and selected providers.
- Session API key from conversation metadata.
- Latest received event ID, initially -1.

An absolute conversation URL can supply a different host and a prefixed socket path; otherwise the provider uses `VITE_BACKEND_BASE_URL` or the current browser host. When disconnected, it updates the next connection's cursor from the latest numeric event ID. Changing conversations resets the cursor and event arrays.

`send` emits `oh_user_action`; incoming messages arrive on `oh_event`. The backend replays events after the cursor, then joins live conversation traffic. This is a display-recovery mechanism, not proof that the sandbox or controller was restarted successfully.

The secondary `ConversationSubscriptionsProvider` maintains separate sockets/event lists for additional conversations, shows completion/error notifications, and unsubscribes completed conversations. Its behavior is distinct from the main conversation cursor/replay path.

## Event processing and state ownership

Incoming primary socket events first pass through `handleAssistantMessage`, which dispatches action, observation, or status handlers. Those handlers update Redux slices for terminal/Jupyter activity, browser URLs/screenshots, agent state, metrics, status, and risk input.

The socket provider also keeps raw events and parsed action/observation lists. User-message echoes remove optimistic messages. File edit/write and command actions invalidate the conversation's file-change query; edit/write actions additionally normalize the workspace/repository path and invalidate the affected file diff.

| State | Owner |
| --- | --- |
| Connection status, raw/parsed event arrays, reconnect cursor | Socket provider |
| Conversation metadata, settings, file changes/diffs | React Query |
| Terminal, Jupyter, browser, agent status, metrics | Redux slices |
| Durable conversation history and execution truth | Backend event stream/controller |

Presentation can transform data: the observation handler truncates long terminal output to its first and last 2,500 characters. Hidden actions are skipped by the action-display handler. These are UI projections; they do not rewrite persisted events.

Status errors and agent error states are surfaced through error tracking/chat feedback. `useHandleWSEvents` also recognizes maximum-limit messages and can send a paused-state action. When investigating an unexpected pause, inspect both this client reaction and controller limit handling.

## Adding an event or UI feature

Trace a new event through backend serialization, TypeScript types/guards, socket parsing, action/observation handlers, relevant slices/query invalidations, and rendering. Test reconnect and conversation switching so state from one conversation does not appear in another.

Representative checks include `frontend/__tests__/components/event-message.test.tsx`, conversation components, and `frontend/src/services/__tests__/actions.test.ts`. [Testing](../testing/validation.md) distinguishes Vitest, mocked Playwright, and live Python browser tests.

## The reusable component package

`openhands-ui/` is a separate publishable `@openhands/ui` package with JavaScript/type exports and a separate CSS export. It has its own Bun lockfile, Vite build, and Storybook development workflow. The application manifest does not currently declare it as a package dependency, so editing it should not be assumed to update every application component. Choose the actual consuming source when making UI changes.

For debugging incomplete history, follow [events and storage](../architecture/events-storage.md) after confirming the frontend cursor and query state.
