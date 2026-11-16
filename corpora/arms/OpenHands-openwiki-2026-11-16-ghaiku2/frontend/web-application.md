---
type: "Reference"
title: "Frontend Web Application"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-63117229de55feec7d3e110e
    resource: repo://frontend/src/api/open-hands-axios.ts
  - id: openwiki-source-c25e6721ceef43d48fb22c35
    resource: repo://frontend/src/context/ws-client-provider.tsx
  - id: openwiki-source-470d25dae21e01131abe8d48
    resource: repo://frontend/src/hooks/query/use-user-conversation.ts
  - id: openwiki-source-71cade68435ab3546fa87680
    resource: repo://frontend/src/routes.ts
  - id: openwiki-source-c46258d1e4d2d1b2d3099e02
    resource: repo://frontend/src/services/actions.ts
  - id: openwiki-source-088038e212593056e5081d6c
    resource: repo://frontend/src/store.ts
  - id: openwiki-source-613b4c79970bb0ed7f1ea285
    resource: repo://openhands-ui/package.json
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---


# Frontend Web Application

<!-- openwiki: broken internal link [/openwiki/architecture/server-sessions.md] link "/openwiki/architecture/server-sessions.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The web UI is a React single-page application in `frontend/`. It is built with Vite and React Router 7 in SPA mode, uses TanStack Query for server data, Redux Toolkit for live conversation state, and Socket.IO for the event stream. Its reusable primitives live in the separate `openhands-ui/` package (`@openhands/ui`). The backend it talks to is described in [Server, Sockets, and Conversation Sessions](/openwiki/architecture/server-sessions.md).

`frontend/README.md` and `.openhands/microagents/repo.md` give the setup commands (`npm install`, `npm run dev`, `npm run build`, `npm run test`) and the environment variables used for backend host selection (`VITE_BACKEND_HOST`, `VITE_USE_TLS`, `VITE_INSECURE_SKIP_VERIFY`, `VITE_FRONTEND_PORT`).

## Routes

Routes are declared in `frontend/src/routes.ts`. A root layout wraps the app and renders an `Outlet`:

- `index` is the home page (`routes/home.tsx`).
- `accept-tos` shows the terms-of-service acceptance page.
- `settings` is a nested section with sub-routes for LLM (the index), MCP, user, integrations (`git-settings`), app, billing, secrets, and API keys.
- `conversations/:conversationId` is the conversation view, which shows the agent's live events.
- `microagent-management` is the page for managing microagents.

Route modules live in `frontend/src/routes/`. Because the build is SPA mode, the backend serves the single `index.html` for every path, and the router resolves the path in the browser.

## Layered data access

The frontend keeps a strict direction of dependency, which the repository's microagent guide states explicitly: UI components call TanStack Query hooks, the hooks call the data-access layer in `frontend/src/api`, and that layer calls the REST endpoints. Components never call `api` directly.

1. **HTTP client**: `frontend/src/api/open-hands-axios.ts` creates a shared `axios` instance whose base URL is the page's protocol and host, or `VITE_BACKEND_BASE_URL` when set.
2. **API classes**: `frontend/src/api/open-hands.ts` defines the `OpenHands` class, which holds the current conversation and builds conversation URLs and headers, together with service modules under `api/auth-service`, `api/git-service`, `api/option-service`, `api/suggestions-service`, `api/user-service`, plus `api-keys.ts`, `secrets-service.ts`, and `invariant-service.ts`. Types are in `open-hands.types.ts` and the matching `*.types.ts` files.
3. **Query hooks**: `frontend/src/hooks/query/` contains about 40 `use…` hooks, named for the resource they read. Examples are `use-user-conversation`, `use-settings`, `use-git-repositories`, `use-search-conversations`, `use-balance`, and `use-subscription-access`. Each wraps `useQuery` with a key that includes the resource and its ID (for example `["user", "conversation", cid]`).
4. **Mutation hooks**: `frontend/src/hooks/mutation/` contains about 30 hooks named for the action, such as `use-create-conversation`, `use-start-conversation`, `use-stop-conversation`, `use-delete-conversation`, `use-save-settings`, and `use-create-api-key`. They invalidate the affected query keys on success.
5. **Components** in `frontend/src/components/` (about 300 files) and routes use these hooks.

## Live conversation state

A conversation is live over Socket.IO, not only over REST.

- `frontend/src/context/ws-client-provider.tsx` opens the connection with `io(...)` from `socket.io-client`. It attaches handlers for `connect`, `oh_event`, `connect_error`, `connect_failed`, and `disconnect`, and tracks a connection status (`CONNECTING`, `CONNECTED`, `DISCONNECTED`).
<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Each `oh_event` payload goes to `handleAssistantMessage` in `frontend/src/services/actions.ts`, which routes it into the store. These are the same events the backend replays and streams (see [Event Stream, Actions, and Observations](/openwiki/architecture/event-stream.md)).
- `frontend/src/context/conversation-subscriptions-provider.tsx` manages subscriptions to conversations for the connection.
- `frontend/src/store.ts` configures a Redux store with `combineReducers` and `configureStore` from Redux Toolkit. Its slices in `frontend/src/state/` include agent state (`agent-slice`), chat events (`event-message-slice`), the conversation (`conversation-slice`), browser and command output (`browser-slice`, `command-slice`), code (`code-slice`), files (`file-state-slice`), Jupyter output (`jupyter-slice`), metrics (`metrics-slice`), and the initial query (`initial-query-slice`).

A conversation view therefore has two sources: TanStack Query for metadata, settings, and lists, and the socket-fed Redux store for the agent's live activity.

## Internationalization

`frontend/src/i18n/` provides translations. `translation.json` holds the strings, and `declaration.ts` is generated: it exports the `I18nKey` enum from the keys in the translation file. The file's header says it is generated and must not be edited by hand. `npm run make-i18n` regenerates it.

## Shared UI library

`openhands-ui/` is the package `@openhands/ui` (version 1.0.0-beta.9 at this revision). It exports about 18 components from `components/` (for example `Button`, `Checkbox`, `Chip`, `Input`, `Select`, `RadioGroup`, `Scrollable`) through `index.ts`, plus shared styles (`tokens.css`, `index.css`). Its scripts are `build` (Vite library build to `dist/`) and `build:sb` / `dev` (Storybook). Its `PUBLISHING.md` describes the release steps. The main application imports from the package to keep its components consistent.

## Styling

Tailwind CSS 4 (`tailwind.config.js`, `tailwind.css`) supplies utility classes. Global styles are in `index.css`.

## Testing

- Unit tests use Vitest (`vitest.config.ts`, `vitest.setup.ts`) and React Testing Library. Tests live in `frontend/__tests__/` (about 98 files across `api`, `components`, `context`, `hooks`, `i18n`, `routes`, `services`, and `utils`) and in `frontend/src/**/__tests__/`.
- Mocks for the API and the socket are in `frontend/src/mocks/`, including `handlers.ws.ts` and `mock-ws-helpers.ts` for socket events.
- End-to-end tests use Playwright (`playwright.config.ts`, `frontend/tests/`, six files).

## Build and deployment

`vite.config.ts` builds the app. `react-router.config.ts` includes a build hook that unpacks the `client` output directory into the build root, as its own comment explains for SPA-mode builds. The build output is served by the backend from `./frontend/build`. The `ui-build.yml` and `fe-unit-tests.yml` workflows build and test the frontend in CI, and `npm-publish-ui.yml` publishes `@openhands/ui`.

## Invariants and failure behavior

- Components never call the API layer directly; all server calls go through a TanStack Query hook.
- The socket is the source of live agent events. On disconnect the status is set to `DISCONNECTED`. The server's connect handler replays stored events from a supplied `latest_event_id`.
- Translation keys are typed through the generated `I18nKey` enum.

## Extension seams

- A new REST resource: add a service module in `frontend/src/api/`, a query or mutation hook, and a component.
- A new live event type: handle it in `frontend/src/services/actions.ts` and add a slice reducer.
- A new shared component: add it to `openhands-ui/components` and export it from `index.ts`.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/server-sessions.md] link "/openwiki/architecture/server-sessions.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Server, Sockets, and Conversation Sessions](/openwiki/architecture/server-sessions.md)
<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Event Stream, Actions, and Observations](/openwiki/architecture/event-stream.md)
<!-- openwiki: broken internal link [/openwiki/operations/development-and-testing.md] link "/openwiki/operations/development-and-testing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Development, Testing, and Quality Gates](/openwiki/operations/development-and-testing.md)
