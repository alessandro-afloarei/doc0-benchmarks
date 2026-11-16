---
title: "Web Frontend"
---
## Overview

The web interface is a single-page React application in `frontend/`. It is built with Vite and React Router in SPA mode, so the server only has to serve one `index.html` and the static assets, and every page is rendered in the browser. It talks to the backend in two ways: HTTP requests through axios for settings, conversations and files, and one socket.io connection per open conversation for the live event stream. The server side of both is on [[Server Application]], and the socket protocol is on [[Socket Sessions]].

Sources: [frontend/react-router.config.ts:1-35](repo://frontend/react-router.config.ts#L1-L35), [frontend/package.json:42-56](repo://frontend/package.json#L42-L56)

## Pages

`routes.ts` defines the route tree. Under one root layout sit the home page, the terms-of-service acceptance page, the conversation page at `conversations/:conversationId`, and the microagent management page. The settings page is a parent route with eight child pages: language model, MCP, user, git integrations, application, billing, secrets and API keys.

Sources: [frontend/src/routes.ts:1-25](repo://frontend/src/routes.ts#L1-L25)

The root component renders only an outlet, and the toaster for notifications is mounted beside it. The root layout component renders the outlet inside the page's own chrome.

Sources: [frontend/src/root.tsx:1-40](repo://frontend/src/root.tsx#L1-L40), [frontend/src/routes/root-layout.tsx:200-220](repo://frontend/src/routes/root-layout.tsx#L200-L220)

## HTTP access

`openHands` is a single axios instance whose base URL is the page's own host, unless `VITE_BACKEND_BASE_URL` overrides it. The requests in `src/api` are built on this instance, so the base URL is set in one place.

Sources: [frontend/src/api/open-hands-axios.ts:1-10](repo://frontend/src/api/open-hands-axios.ts#L1-L10)

Server data is held by TanStack Query. On a 401 response the query client invalidates the authenticated-user query, so the session is checked again. It also shows a toast for each distinct error message once, unless the query opts out. The authentication query itself skips that toast handling.

Sources: [frontend/src/query-client-config.ts:1-48](repo://frontend/src/query-client-config.ts#L1-L48)

## Live conversation

The websocket provider opens one socket.io connection for the conversation, with the websocket transport only. Its query carries the conversation ID and the ID of the last event it has, or -1, which is what lets the server replay only what is missing. It listens for `oh_event` messages and sends user actions with `oh_user_action`, the same event names the server handles.

Sources: [frontend/src/context/ws-client-provider.tsx:325-345](repo://frontend/src/context/ws-client-provider.tsx#L325-L345), [frontend/src/context/ws-client-provider.tsx:149-160](repo://frontend/src/context/ws-client-provider.tsx#L149-L160)

Each incoming message goes through `handleMessage`, which first passes it to the assistant-message handler. Error status updates and error agent states are reported as the error message and tracked as errors. Actions and observations are appended to a list of parsed events that the provider keeps in its own state.

Sources: [frontend/src/context/ws-client-provider.tsx:164-196](repo://frontend/src/context/ws-client-provider.tsx#L164-L196)

The Redux store is created with `configureStore` from the slice reducers and exports the root state and dispatch types. Its slices hold the UI state of the app, such as the agent state, the metrics, the security analyser choice and the status, while the event list is kept by the socket provider.

Sources: [frontend/src/store.ts:1-40](repo://frontend/src/store.ts#L1-L40)

## Components library

`openhands-ui` is a separate package named `@openhands/ui`, a React component library in TypeScript and Tailwind CSS. Its index exports the shared components, such as buttons, inputs, dialogs, tabs, toasts and tooltips, from one entry file, and the package is meant to be installed by other projects.

Sources: [openhands-ui/package.json:1-12](repo://openhands-ui/package.json#L1-L12), [openhands-ui/index.ts:1-12](repo://openhands-ui/index.ts#L1-L12), [openhands-ui/README.md:1-12](repo://openhands-ui/README.md#L1-L12)

## Build and run

The `dev` and `build` scripts first generate the translation files, then run React Router's dev server or build. Tests use Vitest, and the frontend's README documents the package manager and the commands to start it against a running backend.

Sources: [frontend/package.json:60-72](repo://frontend/package.json#L60-L72), [frontend/README.md:1-30](repo://frontend/README.md#L1-L30)
