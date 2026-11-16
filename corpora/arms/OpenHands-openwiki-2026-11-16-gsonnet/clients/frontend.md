---
type: component
title: Frontend Web App
description: Structure of the React 19 / React Router 7 SPA in frontend/ — routes, Redux and React Query state, the Socket.IO client that mirrors the backend event stream, API access, tests and tooling — plus the separate openhands-ui component library.
tags: [frontend, react, socket-io, redux, react-query, ui]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-1047363cf615000e4c9bb694
    resource: repo://frontend/package.json
  - id: openwiki-source-b18e9242e8b5eda6fb47c473
    resource: repo://frontend/react-router.config.ts
  - id: openwiki-source-c25e6721ceef43d48fb22c35
    resource: repo://frontend/src/context/ws-client-provider.tsx
  - id: openwiki-source-af898eae99ee0b960afe34e3
    resource: repo://frontend/src/hooks/use-handle-ws-events.ts
  - id: openwiki-source-c46258d1e4d2d1b2d3099e02
    resource: repo://frontend/src/services/actions.ts
  - id: openwiki-source-613b4c79970bb0ed7f1ea285
    resource: repo://openhands-ui/package.json
  - id: openwiki-source-c959928a0c3c7ad69fd438cc
    resource: repo://openhands/server/listen.py
  - id: openwiki-source-1f185811d1f94a91335562ed
    resource: repo://openhands/server/static.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Frontend Web App

`frontend/` (package `openhands-frontend`) is a single-page app that renders a conversation with an agent: chat, terminal, code/diff viewer, browser, Jupyter, VS Code, served-app tabs, plus settings and billing pages. It talks to the [server](../server/server-and-sessions.md) over REST (axios) and Socket.IO.

## Stack and build

- React 19, **React Router 7 in SPA mode** (`react-router.config.ts`: `appDirectory: "src"`, `ssr: false`; a `buildEnd` hook moves `build/client/*` up into `build/` so the Python server can serve static files from `frontend/build`), Vite 7, Tailwind 4, HeroUI components, i18next.
- State: **Redux Toolkit** slices for the live conversation view and **TanStack React Query** for server data.
- Scripts (`package.json`): `dev` (real backend), `dev:mock` / `dev:mock:saas` (MSW mock API, optionally SaaS mode, via `VITE_MOCK_API`/`VITE_MOCK_SAAS`), `build`, `start` (sirv), `test` (vitest), `test:e2e` (Playwright), `lint`, `typecheck`, `make-i18n` (compiles translations; run before dev/build/lint) and `check-translation-completeness`. Node ≥ 22.
- `VITE_BACKEND_BASE_URL` overrides the backend host used by both the axios client and the Socket.IO URL; otherwise `window.location.host` is used (the backend serves the built SPA itself).

## Routes (`src/routes.ts`)

A root layout (`root-layout.tsx`) wraps: `/` (home: start a conversation, pick repo/branch, suggested tasks), `/accept-tos`, `/conversations/:conversationId` (`conversation.tsx`; the changes, browser, Jupyter, VS Code and served-app tabs are rendered inside it from `components/features/conversation/conversation-tabs/`, not as separate router entries), `/microagent-management`, and `/settings/*` with children for LLM (index), `mcp`, `user`, `integrations` (git providers), `app`, `billing`, `secrets` and `api-keys`.

## Live conversation data flow

`src/context/ws-client-provider.tsx` (`WsClientProvider`) owns the Socket.IO connection for the active conversation:

1. It waits until the conversation (fetched via React Query `useActiveConversation`) is `RUNNING` or has a `runtime_status`.
2. It connects with query params `latest_event_id` (last event it has seen, else `-1`), `conversation_id`, `providers_set` and `session_api_key` (passed in the query because Socket.IO cannot set custom headers). If the conversation `url` is absolute, the socket host and path are derived from it (path prefix before `/api/conversations` + `/socket.io`), supporting per-conversation runtime URLs; otherwise the backend base URL and `/socket.io` are used.
3. Server → client: `oh_event` messages carrying serialized [events](../architecture/event-stream.md) (the server first replays stored events newer than `latest_event_id`). Client → server: `send()` emits `oh_user_action`.
4. On disconnect it stores `lastEvent.id` in the socket query so a reconnect resumes without duplicates; errors set a banner and refetch the conversation.

`handleMessage` forwards each event to `services/actions.ts::handleAssistantMessage`, which dispatches to the Redux slices: command input for `run` actions (terminal), Jupyter input, LLM metrics (`llm_metrics` → `metrics-slice`), security-analyzer input when `security_risk` is present, and observation handling (`services/observations.ts`) which feeds terminal output, browser screenshots, agent state, etc. Status updates with a `conversation_title` invalidate the conversation query so the title refreshes. The provider also keeps `events` and `parsedEvents` lists, tracks errors (error observations and `AgentStateChangedObservation` with `agent_state == "error"` become banners/telemetry), clears optimistic user messages when the server echoes a user message, and **invalidates React Query caches** (`file_changes`, `file_diff`) when file edit/write or command actions arrive, without cancelling an in-flight refetch so bulk replays do not thrash.

`hooks/use-handle-ws-events.ts` reacts to the latest event: server errors become toasts (401 → "Session expired"), and an `Agent reached maximum ...` error causes the client to send a `PAUSED` agent-state change; resuming then lets the backend extend the iteration limit (see limits in [AgentController](../architecture/agent-controller.md)).

Redux slices (`src/state/`): `agent`, `browser`, `code`, `cmd`, `jupyter`, `securityAnalyzer`, `status`, `metrics`, `microagentManagement`, `conversation`, `eventMessage`, `fileState`, `initialQuery`, combined in `store.ts`.

## REST access

`api/open-hands-axios.ts` creates the shared axios instance and a response interceptor (e.g. special handling of a 403 `EmailNotVerifiedError`). `api/open-hands.ts` and the sub-folders (`auth-service`, `git-service`, `secrets-service`, `option-service`, `suggestions-service`, `user-service`, `api-keys`) wrap the server routes for conversations, settings, secrets, git providers, feedback, trajectories, VS Code URL and so on. Query hooks live in `hooks/query/` and mutations in `hooks/mutation/`. Many features adapt to SaaS vs OSS mode using the server config (billing, API keys, integrations; see [Enterprise](../enterprise/enterprise-saas.md)).

## Tests

- Unit/component tests: `frontend/__tests__/` (vitest + Testing Library + MSW; `@mswjs/socket.io-binding` mocks the websocket) covering api, components, context, hooks, routes, services, i18n and utils.
- `frontend/tests/` holds Playwright/e2e and some component tests; `playwright.config.ts` configures them. CI runs them from `.github/workflows/fe-unit-tests.yml` and `e2e-tests.yml` (see [Testing](../operations/testing-and-evaluation.md)).

## `openhands-ui` component library

`openhands-ui/` is a separate package `@openhands/ui` (React, TypeScript, Tailwind, built with Vite, bun lockfile) with design tokens (`tokens.css`) and components such as accordion, button, checkbox, chip, dialog, divider, icon, input, interactive-chip, radio-group, scrollable, select, spinner and tabs. It is published to npm via `.github/workflows/npm-publish-ui.yml` (see `PUBLISHING.md`) and is independent of the app's own `src/ui` and `components/shared`.

Related: [Server and sessions](../server/server-and-sessions.md), [Build and containers](../operations/build-and-containers.md).
