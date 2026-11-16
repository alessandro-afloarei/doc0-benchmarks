---
type: subsystem
title: Web Frontend and UI Component Library
description: Structure of the OpenHands React single-page app in frontend/ — React Router routes, axios API services, Socket.IO event handling, TanStack Query and Redux state, i18n, mock mode, build/serving, and tests — plus the separately published @openhands/ui component library in openhands-ui/.
tags: [frontend, react, socket-io, redux, react-query, i18n, ui-library]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-593fb470f78e2e063a120a84
    resource: repo://.github/workflows/npm-publish-ui.yml
  - id: openwiki-source-1047363cf615000e4c9bb694
    resource: repo://frontend/package.json
  - id: openwiki-source-b18e9242e8b5eda6fb47c473
    resource: repo://frontend/react-router.config.ts
  - id: openwiki-source-571eb0348e196846a3ce876a
    resource: repo://frontend/scripts/make-i18n-translations.cjs
  - id: openwiki-source-c25e6721ceef43d48fb22c35
    resource: repo://frontend/src/context/ws-client-provider.tsx
  - id: openwiki-source-088a015993b157b0efaacaf3
    resource: repo://frontend/src/entry.client.tsx
  - id: openwiki-source-71cade68435ab3546fa87680
    resource: repo://frontend/src/routes.ts
  - id: openwiki-source-088038e212593056e5081d6c
    resource: repo://frontend/src/store.ts
  - id: openwiki-source-613b4c79970bb0ed7f1ea285
    resource: repo://openhands-ui/package.json
  - id: openwiki-source-50d13a3f8c24f3a49234fd56
    resource: repo://openhands/server/config/server_config.py
  - id: openwiki-source-c959928a0c3c7ad69fd438cc
    resource: repo://openhands/server/listen.py
  - id: openwiki-source-0ca1a35d28761767a1061a66
    resource: repo://openhands/server/routes/public.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Web Frontend and UI Component Library

## Overview

`frontend/` (`openhands-frontend`, same version as the backend) is a React + TypeScript **single-page app** built with React Router v7 in SPA mode (`react-router.config.ts`: `appDirectory: "src"`, `ssr: false`), Vite, Tailwind CSS, and HeroUI. The production build in `frontend/build` is served by the backend: `openhands/server/listen.py` mounts `SPAStaticFiles(directory='./frontend/build')` at `/` unless `SERVE_FRONTEND=false` ([Web Server](../server/web-server.md)).

## Routes

`frontend/src/routes.ts` defines the route tree under `routes/root-layout.tsx`:

| Path | Purpose |
| --- | --- |
| `/` (`home.tsx`) | Start a conversation: repository/branch selection, suggested tasks, recent conversations |
| `/conversations/:conversationId` | The conversation workspace (chat, terminal, editor/changes, browser, Jupyter, VS Code) |
| `/settings` (+ `mcp`, `user`, `integrations`, `app`, `billing`, `secrets`, `api-keys`) | LLM settings by default; MCP servers, git provider tokens, app preferences, custom secrets; billing and API keys in SaaS mode |
| `/microagent-management` | Browse and create repository microagents ([Microagents](../concepts/microagents.md)) |
| `/accept-tos` | Terms-of-service acceptance (SaaS) |

## Talking to the backend

- **REST:** `src/api/open-hands-axios.ts` creates the shared axios instance with base URL from `VITE_BACKEND_BASE_URL` or the current host, plus interceptors (e.g. email-verification errors). Service modules wrap endpoints: `open-hands.ts` (conversations, files, config, trajectory, feedback), `git-service/`, `auth-service/`, `user-service/`, `secrets-service.ts`, `api-keys.ts`, `suggestions-service/`, `invariant-service.ts` (security analyzer), `option-service/`.
- **Data fetching:** TanStack Query hooks under `src/hooks/query/` (e.g. `use-active-conversation`, `use-config`, `use-git-repositories`, `use-get-diff`, `use-get-microagents`) and `src/hooks/mutation/` for writes; `query-client-config.ts` configures caching.
- **Realtime events:** `src/context/ws-client-provider.tsx` opens a Socket.IO connection (`socket.io-client`, websocket transport) for the active conversation with query params `conversation_id`, `latest_event_id` (resume point, `-1` for all), `providers_set`, and `session_api_key` (passed as a query param because Socket.IO can't set custom headers). When the conversation has an absolute `url` (e.g. a nested runtime), it connects to that host with a matching `/socket.io` path prefix. On reconnect it updates `latest_event_id` to the last received event so the server replays only missed events.
  - Incoming `oh_event` messages are the serialized [events](../architecture/event-stream.md). The provider appends actions/observations to the parsed event list, surfaces status/agent-state errors, clears optimistic user messages when the real one arrives, and invalidates cached diffs/git changes when file edits or writes occur.
  - User input is sent with `emit("oh_user_action", event)` (e.g. `MessageAction`s and `ChangeAgentStateAction`s for pause/resume/stop, confirmations).
  - `conversation-subscriptions-provider.tsx` manages subscriptions to multiple conversations.

## State

- **Redux Toolkit** (`src/store.ts`) holds UI/session state in slices: `agent` (agent state), `browser`, `code`, `cmd` (terminal), `jupyter`, `fileState`, `initialQuery`, `securityAnalyzer`, `status`, `metrics` (cost/tokens from `llm_metrics`), `conversation`, `eventMessage`, `microagentManagement`.
- **Server state** lives in TanStack Query caches.
- `src/services/` converts events into UI updates (`actions.ts`, `observations.ts`, `agent-state-service.ts`, `terminal-service.ts`, `chat-service.ts`).
- Terminal rendering uses xterm.js; the editor uses Monaco; analytics use PostHog.

## Internationalization

All UI strings live in `src/i18n/translation.json` keyed by message id with per-language values. `npm run make-i18n` (run automatically by `dev`, `build`, `lint`, `test:coverage`) generates `public/locales/<lang>/translation.json` for `i18next-http-backend`; `src/i18n/declaration.ts` provides typed keys. `check-translation-completeness` validates coverage.

## Development modes

- `npm run dev` — Vite dev server against a real backend (`VITE_BACKEND_BASE_URL`, `VITE_BACKEND_HOST`; see `.env.sample`).
- `npm run dev:mock` / `dev:mock:saas` — **MSW mocks** (`src/mocks/` handlers for REST and websocket) enabled in `entry.client.tsx` when `VITE_MOCK_API=true`; `VITE_MOCK_SAAS` simulates SaaS mode.
- The backend's `/api/options/config` tells the UI its `APP_MODE` (OSS vs SAAS) and feature flags such as `ENABLE_BILLING` and `HIDE_LLM_SETTINGS`.

## Testing and quality

- **Unit/component tests:** Vitest + Testing Library under `frontend/__tests__/` (api, components, context, hooks, routes, services, utils) — `npm run test`.
- **E2E:** Playwright specs in `frontend/tests/` — `npm run test:e2e`.
- **Lint/typecheck:** `npm run lint` (React Router typegen + `tsc`, ESLint airbnb-typescript, Prettier); Husky pre-commit hooks.
- CI: `.github/workflows/fe-unit-tests.yml` and `lint.yml` ([Testing Guide](../testing/testing-guide.md)).

## `openhands-ui`: component library

`openhands-ui/` is a separate package, `@openhands/ui` (beta), with design tokens (`tokens.css`) and reusable components — accordion, button, checkbox, chip, dialog, divider, icon, input, interactive chip, radio group, scrollable, select, spinner, tabs, toast, toggle, tooltip, typography. It builds with Vite (`bun run build`), documents components in Storybook (`dev` on port 6006), and tests with Vitest. `.github/workflows/npm-publish-ui.yml` publishes it to npm on pushes to `main` that touch `openhands-ui/**` when the version changes. The main frontend does not currently depend on it in `package.json`.

## Related pages

- [Web Server, Sessions, and Conversation Management](../server/web-server.md)
- [Events and the Event Stream](../architecture/event-stream.md)
- [Testing Guide](../testing/testing-guide.md)
- [Build, Packaging, and Deployment](../operations/build-and-deploy.md)
