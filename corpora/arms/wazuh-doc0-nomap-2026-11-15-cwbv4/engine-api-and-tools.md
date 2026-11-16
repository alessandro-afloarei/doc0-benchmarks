---
title: "Engine API and Command-Line Tools"
---
## Overview

Everything that changes the engine at run time (uploading assets, loading policies, adding routes, running tests, filling KVDBs) goes through its management API: HTTP over a Unix socket, `queue/sockets/analysis` by default. Each endpoint takes and returns a JSON-encoded protobuf message. Two clients use it: the `engine-suite` Python command-line tools for developers and content authors, and the Python framework of the manager. This page covers the server, the message format, the endpoint groups, those clients, and the archiver, which the API switches on and off.

Sources: [src/engine/source/main.cpp:548-593](repo://src/engine/source/main.cpp#L548-L593), [src/engine/source/conf/src/conf.cpp:68-71](repo://src/engine/source/conf/src/conf.cpp#L68-L71)

## The HTTP server

`httpsrv::Server` wraps a cpp-httplib server. `start(socketPath)` checks that the socket's directory exists, sets the address family to `AF_UNIX`, removes a stale socket file, and listens in its own thread, waiting until the server is ready before returning. Handlers are added with `addRoute(method, path, handler)`, and an exception handler logs any exception a handler throws and answers 500. Every route the engine registers on the API socket is `POST`. The same class serves the enriched-events endpoint on a second socket ([[Engine Architecture and Startup]]).

Sources: [src/engine/source/httpsrv/src/server.cpp:15-60](repo://src/engine/source/httpsrv/src/server.cpp#L15-L60), [src/engine/source/httpsrv/src/server.cpp:69-110](repo://src/engine/source/httpsrv/src/server.cpp#L69-L110)

## Message format

### Protobuf over JSON

Requests and responses are protobuf messages defined in `src/engine/source/proto/src/*.proto` (one file per group: `catalog`, `policy`, `router`, `tester`, `kvdb`, `geo`, `archiver`, plus shared `engine.proto`). The generated C++ code lives next to them and must be regenerated with `generateCode.sh`, never edited. On the wire the body is the message's JSON form; every response carries a `status` (`OK` or `ERROR`) and an optional `error` string.

Sources: [src/engine/source/proto/include/eMessages/readme.md:1-2](repo://src/engine/source/proto/include/eMessages/readme.md#L1-L2), [src/engine/source/proto/src/tester.proto:137-153](repo://src/engine/source/proto/src/tester.proto#L137-L153)

### The adapter

`api::adapter` turns handlers into routes. `parseRequest<Req, Res>` converts the body into the request message (an empty body gives a default message) and, on failure, produces a 400 response of type `Res` with "Failed to parse protobuff json request". `userResponse` serializes a response with status 200, and `userErrorResponse` builds an `ERROR` response with status 400. Handlers therefore never deal with JSON directly.

Sources: [src/engine/source/api/adapter/include/api/adapter/adapter.hpp:120-200](repo://src/engine/source/api/adapter/include/api/adapter/adapter.hpp#L120-L200)

## Endpoints

All endpoints are `POST`. Each group's handlers are registered in `main.cpp` against the module they drive:

Sources: [src/engine/source/main.cpp:562-589](repo://src/engine/source/main.cpp#L562-L589)

| Group | Endpoints | Backed by |
| --- | --- | --- |
| Catalog | `/catalog/resource/post`, `/get`, `/put`, `/delete`, `/validate`; `/catalog/namespaces/get` | Catalog over the store |
| Policy | `/policy/store/post`, `/get`, `/delete`; `/policy/asset/post`, `/get`, `/delete`, `/clean_deleted`; `/policy/default_parent/get`, `/post`, `/delete`; `/policy/list`; `/policy/namespaces/list` | Policy manager |
| Router | `/router/route/post`, `/get`, `/delete`, `/reload`; `/router/table/get`; `/router/eps/activate`, `/deactivate` | Orchestrator |
| Tester | `/tester/session/post`, `/get`, `/delete`, `/reload`; `/tester/table/get`; `/tester/run/post` | Orchestrator |
| KVDB | `/kvdb/manager/get`, `/post`, `/delete`, `/dump`; `/kvdb/db/get`, `/put`, `/delete`, `/search` | KVDB manager |
| Geo | `/geo/db/add`, `/geo/db/del`, `/geo/db/list` | Geo manager |
| Archiver | `/archiver/activate`, `/deactivate`, `/status` | Archiver |

Sources: [src/engine/source/api/catalog/include/api/catalog/handlers.hpp:22-27](repo://src/engine/source/api/catalog/include/api/catalog/handlers.hpp#L22-L27), [src/engine/source/api/policy/include/api/policy/handlers.hpp:34-48](repo://src/engine/source/api/policy/include/api/policy/handlers.hpp#L34-L48), [src/engine/source/api/router/include/api/router/handlers.hpp:30-41](repo://src/engine/source/api/router/include/api/router/handlers.hpp#L30-L41), [src/engine/source/api/tester/include/api/tester/handlers.hpp:31-39](repo://src/engine/source/api/tester/include/api/tester/handlers.hpp#L31-L39), [src/engine/source/api/kvdb/include/api/kvdb/handlers.hpp:31-39](repo://src/engine/source/api/kvdb/include/api/kvdb/handlers.hpp#L31-L39), [src/engine/source/api/geo/include/api/geo/handlers.hpp:18-21](repo://src/engine/source/api/geo/include/api/geo/handlers.hpp#L18-L21), [src/engine/source/api/archiver/include/api/archiver/handlers.hpp:19-21](repo://src/engine/source/api/archiver/include/api/archiver/handlers.hpp#L19-L21)

Catalog writes validate content with the builder first ([[Engine Store, KVDB, Schema and Geo]]). Router and tester calls map one to one onto orchestrator methods ([[Engine Router, Orchestrator and Test Sessions]]); for example `/tester/run/post` takes a session name, an event, a trace level and the assets to trace, waits for the worker's answer, and returns the processed event with its traces.

Sources: [src/engine/source/api/tester/src/handlers.cpp:425-458](repo://src/engine/source/api/tester/src/handlers.cpp#L425-L458)

The service script uses the API as a readiness probe: after starting the engine it calls `/router/route/get` for the `default` route until it gets an answer ([[Service Control and Monitord]]).

Sources: [src/init/wazuh-server.sh:265-297](repo://src/init/wazuh-server.sh#L265-L297)

## The archiver

The archiver appends every raw event received on the enriched-events endpoint to `analysisd.archiver_path` (`logs/archives/archives.json`), one line per request body, when it is active. It is off unless `analysisd.archiver_enabled` is set, and `/archiver/activate` and `/archiver/deactivate` flip an atomic flag, so archiving can be turned on for troubleshooting without a restart. Writes are serialized by a mutex and flushed after every line.

Sources: [src/engine/source/archiver/include/archiver/archiver.hpp:18-99](repo://src/engine/source/archiver/include/archiver/archiver.hpp#L18-L99), [src/engine/source/api/event/src/handlers.cpp:28-28](repo://src/engine/source/api/event/src/handlers.cpp#L28-L28), [src/engine/source/conf/src/conf.cpp:93-96](repo://src/engine/source/conf/src/conf.cpp#L93-L96)

## Clients

### engine-suite

`src/engine/tools/engine-suite` is a Python package that installs one command per area:

Sources: [src/engine/tools/engine-suite/setup.cfg:31-43](repo://src/engine/tools/engine-suite/setup.cfg#L31-L43)

| Command | Purpose |
| --- | --- |
| `engine-catalog` | List, get, create, update, delete and validate assets |
| `engine-policy` | Build policies and manage their assets and default parents |
| `engine-router` | Manage routes and EPS |
| `engine-test` | Create test sessions and send events interactively, simulating an agent's metadata |
| `engine-integration` | Create and manage integrations |
| `engine-kvdb`, `engine-geo`, `engine-archiver` | Manage KVDBs, MaxMind databases, the archiver |
| `engine-decoder`, `engine-schema`, `engine-diff`, `engine-clear` | Rename helpers in bulk, generate schemas, compare, delete content |

Sources: [src/engine/tools/engine-suite/README.md:14-60](repo://src/engine/tools/engine-suite/README.md#L14-L60), [src/engine/tools/engine-suite/src/engine_test/README.md:14-22](repo://src/engine/tools/engine-suite/src/engine_test/README.md#L14-L22)

The commands share the `api-communication` package, whose `APIClient.send_recv(message)` converts a protobuf message to a dictionary, picks the endpoint from the message type, and posts it with `httpx` over the Unix socket.

Sources: [src/engine/tools/api-communication/src/api_communication/client.py:18-110](repo://src/engine/tools/api-communication/src/api_communication/client.py#L18-L110)

### The framework

The manager's Python framework has an asynchronous client in `wazuh.core.engine`: `Engine` creates an `httpx.AsyncClient` over a Unix-socket transport with retries, and `BaseModule.send(path, data)` posts JSON and maps connection, HTTP and decoding errors to `WazuhEngineError` codes 2800 to 2805. Its default socket path is `queue/sockets/engine-api`, which differs from the engine's default `queue/sockets/analysis`, and no engine modules are registered on it yet in this branch. How the framework is organized is on [[Python Framework]].

Sources: [framework/wazuh/core/engine/__init__.py:10-40](repo://framework/wazuh/core/engine/__init__.py#L10-L40), [framework/wazuh/core/engine/base.py:10-54](repo://framework/wazuh/core/engine/base.py#L10-L54)
