---
title: "Python Framework"
---
## Overview

The `wazuh` Python package in `framework/` is the manager's management layer. The REST API ([[Server REST API]]) and the cluster daemon ([[Cluster]]) both call it, and it in turn talks to the C daemons through their Unix sockets: [[Wazuh DB]] for agent and inventory data, authd for keys, remoted and execd queues for commands. It is organized in two layers, a public function layer that the API exposes and a core layer that does the work, plus a distributed API (DAPI) that decides on which cluster node a function runs.

Sources: [framework/wazuh/agent.py:54-60](repo://framework/wazuh/agent.py#L54-L60), [framework/wazuh/core/common.py:234-242](repo://framework/wazuh/core/common.py#L234-L242)

## Two layers

### Public functions

Modules at the top of the package (`framework/wazuh/agent.py`, `rule.py`, `syscheck.py`, `manager.py`, `security.py`, ...) contain one function per API operation. Each is decorated with `expose_resources`, which declares the RBAC action and the resource pattern it needs (for example `agent:read` on `agent:id:{agent_list}`) and filters its arguments to the resources the caller may access before the body runs; [[RBAC and Security]] explains the decorator. The body validates inputs, calls core classes, and builds a result object.

Sources: [framework/wazuh/agent.py:54-60](repo://framework/wazuh/agent.py#L54-L60), [framework/wazuh/agent.py:203-240](repo://framework/wazuh/agent.py#L203-L240)

`reconnect_agents` is typical: it creates an `AffectedItemsWazuhResult` with the three summary messages, loads the known agents, and for each requested ID either sends the reconnect command through the active-response queue or records a failed item with the exception (agent not found, or the manager itself).

Sources: [framework/wazuh/agent.py:205-224](repo://framework/wazuh/agent.py#L205-L224)

```python
for agent_id in agent_list:
    try:
        if agent_id not in system_agents:
            raise WazuhResourceNotFound(1701)
        if agent_id == "000":
            raise WazuhError(1703)
        Agent(agent_id).reconnect(wq)
        result.affected_items.append(agent_id)
    except WazuhException as e:
        result.add_failed_item(id_=agent_id, error=e)
```

Sources: [framework/wazuh/agent.py:218-240](repo://framework/wazuh/agent.py#L218-L240)

### Core

`framework/wazuh/core/` holds the implementation: domain classes such as `core.agent.Agent` (with `get_basic_information`, `reconnect`, ...), the `WazuhDBQuery` family that builds paginated, filtered, sorted queries, socket and queue clients, configuration readers, and the cluster package. Core code raises exceptions and returns plain data; it does not know about RBAC or HTTP.

Sources: [framework/wazuh/core/agent.py:46-60](repo://framework/wazuh/core/agent.py#L46-L60), [framework/wazuh/core/agent.py:470-560](repo://framework/wazuh/core/agent.py#L470-L560), [framework/wazuh/core/agent.py:560-620](repo://framework/wazuh/core/agent.py#L560-L620), [framework/wazuh/core/utils.py:1452-1560](repo://framework/wazuh/core/utils.py#L1452-L1560)

## Results

### WazuhResult and AffectedItemsWazuhResult

All public functions return a subclass of `AbstractWazuhResult`, a mutable mapping that knows how to merge itself with another result (`__or__`), sort, paginate, and serialize. `WazuhResult` wraps a plain dictionary. `AffectedItemsWazuhResult` models bulk operations: `affected_items`, `failed_items` grouped by error, `total_affected_items`, `total_failed_items`, and the `all_msg`/`some_msg`/`none_msg` texts that the API picks from depending on how many items failed.

Sources: [framework/wazuh/core/results.py:20-70](repo://framework/wazuh/core/results.py#L20-L70), [framework/wazuh/core/results.py:270-300](repo://framework/wazuh/core/results.py#L270-L300), [framework/wazuh/core/results.py:337-400](repo://framework/wazuh/core/results.py#L337-L400)

Merging is what makes cluster-wide calls work: when DAPI runs a function on several nodes, the partial results are combined with `|`. For `AffectedItemsWazuhResult` that merges the failed items, merges the affected items in the result's sort order, and adds the totals; merging a `WazuhError` that carries IDs turns those IDs into failed items.

Sources: [framework/wazuh/core/results.py:447-481](repo://framework/wazuh/core/results.py#L447-L481)

### Exceptions

`WazuhException` carries a numeric code whose message comes from the `ERRORS` table (`1000` internal error, `1701` agent does not exist, `2003` wazuh-db request error, ...). Subclasses separate kinds of failure: `WazuhError` for problems with the request, with the more specific `WazuhPermissionError`, `WazuhResourceNotFound`, `WazuhTooManyRequests`, and `WazuhInternalError` with its `WazuhClusterError`, `WazuhHAPHelperError` and `WazuhEngineError` subtypes for server-side failures.

Sources: [framework/wazuh/core/exception.py:14-30](repo://framework/wazuh/core/exception.py#L14-L30), [framework/wazuh/core/exception.py:756-870](repo://framework/wazuh/core/exception.py#L756-L870), [framework/wazuh/core/exception.py:870-905](repo://framework/wazuh/core/exception.py#L870-L905)

## Talking to the daemons

| Client | Module | Target |
| --- | --- | --- |
| `WazuhDBConnection` | `core/wdb.py` | `queue/db/wdb`, text queries with paging |
| `AsyncWazuhDBConnection` | `core/wdb.py` | Same socket, asyncio |
| `WazuhDBHTTPClient` | `core/wdb_http.py` | wazuh-db HTTP API over `wdb-http.sock` |
| `WazuhSocket`, `WazuhSocketJSON` | `core/wazuh_socket.py` | Length-prefixed requests to daemon sockets (authd, remoted, ...) |
| `WazuhQueue` | `core/wazuh_queue.py` | Datagrams to `queue/alerts/ar` (active response, reconnect, restart) |
| `Engine` | `core/engine` | Engine management API ([[Engine API and Command-Line Tools]]) |

Sources: [framework/wazuh/core/wdb.py:21-35](repo://framework/wazuh/core/wdb.py#L21-L35), [framework/wazuh/core/wdb.py:131-150](repo://framework/wazuh/core/wdb.py#L131-L150), [framework/wazuh/core/wdb_http.py:68-110](repo://framework/wazuh/core/wdb_http.py#L68-L110), [framework/wazuh/core/wazuh_socket.py:17-85](repo://framework/wazuh/core/wazuh_socket.py#L17-L85)

`WazuhDBConnection._send` frames each query with a 4-byte little-endian length, reads the length-prefixed answer, raises `WazuhError(2003)` for an `err` answer, and refuses answers at the 64 KiB socket limit (`WazuhInternalError(2009)`). `execute` hides that limit: for a `SELECT` with `limit`/`offset` it rewrites the query and fetches it in slices of `request_slice` rows, so callers can ask for more rows than fit in one message.

Sources: [framework/wazuh/core/wdb.py:207-250](repo://framework/wazuh/core/wdb.py#L207-L250), [framework/wazuh/core/wdb.py:363-430](repo://framework/wazuh/core/wdb.py#L363-L430)

## The distributed API

### Choosing where to run

Every API call goes through `DistributedAPI(f, f_kwargs, request_type, ...)`. `distribute_function` decides where `f` runs:

Sources: [framework/wazuh/core/cluster/dapi/dapi.py:51-110](repo://framework/wazuh/core/cluster/dapi/dapi.py#L51-L110), [api/api/controllers/agent_controller.py:186-194](repo://api/api/controllers/agent_controller.py#L186-L194)

| Situation | Action |
| --- | --- |
| DAPI disabled, cluster disabled, or `request_type == 'local_any'` | Run locally |
| `local_master` on the master | Run locally |
| `distributed_master` forwarded from the master | Run locally |
| `distributed_master` on the master | Forward to the nodes involved and merge the results |
| Anything else on a worker | Send to the master and return its answer |

Sources: [framework/wazuh/core/cluster/dapi/dapi.py:139-180](repo://framework/wazuh/core/cluster/dapi/dapi.py#L139-L180)

### Running locally

`execute_local_request` checks that the daemons are running, then calls `run_local` in a pool: a thread pool if configured, a dedicated pool for authentication and for events functions, otherwise a process pool so CPU-heavy framework code does not block the API's event loop. `run_local` sets the request's context variables (`rbac`, `current_user`, `broadcast`, `cluster_nodes`, `origin_module`) before calling `f`, which is how the RBAC decorator and the result builders know who is calling. The call is bounded by the API request timeout unless `wait_for_complete` is set. Results and exceptions are returned, not raised, so the API can turn them into responses.

Sources: [framework/wazuh/core/cluster/dapi/dapi.py:243-300](repo://framework/wazuh/core/cluster/dapi/dapi.py#L243-L300), [framework/wazuh/core/common.py:150-155](repo://framework/wazuh/core/common.py#L150-L155), [framework/wazuh/core/cluster/dapi/dapi.py:180-212](repo://framework/wazuh/core/cluster/dapi/dapi.py#L180-L212)

The `context_cached` decorator in `common.py` caches function results per request context and returns deep copies, so repeated lookups inside one request (for example, the list of existing agents) are computed once.

Sources: [framework/wazuh/core/common.py:70-106](repo://framework/wazuh/core/common.py#L70-L106)
