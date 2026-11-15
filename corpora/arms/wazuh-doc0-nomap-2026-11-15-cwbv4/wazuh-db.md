---
title: "Wazuh DB"
---
## Overview

`wazuh-db` is the manager's state store. It owns a set of SQLite databases under `queue/db`: one `global.db` with the agent registry and groups, one database per agent (`<id>.db`) with that agent's inventory, FIM, SCA and rootcheck state, and a `tasks.db` for the [[Agent Upgrades and Task Manager]]. No other daemon opens these files; remoted, authd, the modules and the Python framework all send text queries to `queue/db/wdb` and receive text answers. Serializing access through one process lets it keep databases open, batch writes into transactions, and run schema upgrades and vacuums without coordination.

Sources: [src/wazuh_db/main.c:317-372](repo://src/wazuh_db/main.c#L317-L372), [src/headers/defs.h:146-149](repo://src/headers/defs.h#L146-L149)

## Process and threads

`main` reads the `wazuh_db.*` internal options (worker pool size, commit times, open database limit, fragmentation thresholds), the `<wdb>` backup settings, drops privileges, and starts:

Sources: [src/wazuh_db/main.c:95-130](repo://src/wazuh_db/main.c#L95-L130)

| Thread | Role |
| --- | --- |
| `run_dealer` | Accepts connections on `queue/db/wdb` and hands readable peers to the workers |
| `run_worker` × `worker_pool_size` | Read a query, run it, write the answer |
| `run_gc` | Every second: commit idle transactions, vacuum fragmented databases, close databases over the limit |
| `run_up` | At start, opens every agent database once so pending schema upgrades run early |
| `run_backup` | Periodic snapshots of `global.db` when backups are enabled |

Sources: [src/wazuh_db/main.c:238-290](repo://src/wazuh_db/main.c#L238-L290), [src/wazuh_db/main.c:376-480](repo://src/wazuh_db/main.c#L376-L480), [src/wazuh_db/main.c:480-560](repo://src/wazuh_db/main.c#L480-L560)

It also creates three router providers (`wdb-agent-events`, `wdb-fim-events`, `wdb-inventory-events`) to publish changes, and registers HTTP endpoints on `wdb-http.sock` through the router module (`/v1/agents/ids`, `/v1/agents/summary`, `/v1/agents/sync`, `/v1/agents/restartinfo` and others) that the framework uses for bulk agent queries. Those endpoints are described on [[Router Publish/Subscribe Module]].

Sources: [src/wazuh_db/main.c:208-258](repo://src/wazuh_db/main.c#L208-L258)

## The query protocol

### Framing and dispatch

Each request is a length-prefixed message on the stream socket. A worker reads it and, if it begins with `{`, passes it to `wdbcom_dispatch` (JSON commands such as `getstats` and `getconfig`); otherwise to `wdb_parse`. The answer is written back with the same framing, with a trailing newline when the request had one.

Sources: [src/wazuh_db/main.c:376-468](repo://src/wazuh_db/main.c#L376-L468), [src/wazuh_db/wdb_com.c:71-95](repo://src/wazuh_db/wdb_com.c#L71-L95)

### Query syntax

A text query is `<actor> [<id>] <command> [<arguments>]`, and the answer starts with `ok`, `due` (more data follows), or `err <reason>`:

Sources: [src/wazuh_db/wdb_parser.c:300-340](repo://src/wazuh_db/wdb_parser.c#L300-L340)

| Actor | Example | Target |
| --- | --- | --- |
| `agent <id>` | `agent 001 syscollector_packages ...`, `agent 001 sca query 2500`, `agent 001 sql SELECT ...` | That agent's database |
| `global` | `global insert-agent {...}`, `global update-keepalive {...}`, `global sync-agent-groups-get {...}` | `global.db` |
| `task` | `task upgrade {...}`, `task set_timeout {...}` | `tasks.db` |
| `wazuhdb` | `wazuhdb remove 001 002` | Database files themselves |

Sources: [src/wazuh_db/wdb_parser.c:341-410](repo://src/wazuh_db/wdb_parser.c#L341-L410), [src/wazuh_db/wdb_parser.c:872-910](repo://src/wazuh_db/wdb_parser.c#L872-L910), [src/wazuh_db/wdb_parser.c:1461-1470](repo://src/wazuh_db/wdb_parser.c#L1461-L1470)

For an `agent` query, `wdb_parse` first checks in `global.db` that the agent exists (except for the manager, `000`), opens the agent database, and then dispatches on the command: `syscheck`, `fim_file`, `fim_registry*`, `sca`, the `syscollector`/`dbsync` families, `rootcheck`, `ciscat`, plus maintenance commands `begin`, `commit`, `close`, `remove`, `vacuum` and `get_fragmentation`. The raw `sql` command runs the given statement with `wdb_exec` and returns the rows as JSON after `ok`.

Sources: [src/wazuh_db/wdb_parser.c:341-440](repo://src/wazuh_db/wdb_parser.c#L341-L440), [src/wazuh_db/wdb_parser.c:664-690](repo://src/wazuh_db/wdb_parser.c#L664-L690)

## Database lifecycle

### The pool

Open databases live in a pool: a red-black tree from name to `wdb_t`, each with its own mutex and reference count. `wdb_pool_get_or_create` returns the node locked and with its count incremented; `wdb_pool_leave` unlocks it and records the time of last use. Two queries for the same agent therefore serialize, while queries for different agents run in parallel on different workers.

Sources: [src/wazuh_db/wdb_pool.c:11-61](repo://src/wazuh_db/wdb_pool.c#L11-L61)

### Opening and creating

`wdb_open_agent2` gets the pool node and opens `queue/db/<id>.db`. If the file does not exist, `wdb_create_agent_db2` copies a template database (`.template.db`, created on first use from `schema_agents.sql`) to `<id>.db.new` and renames it, which is faster than running the schema for each new agent. Every open runs `wdb_upgrade`.

Sources: [src/wazuh_db/wdb.c:397-438](repo://src/wazuh_db/wdb.c#L397-L438), [src/wazuh_db/wdb.c:474-520](repo://src/wazuh_db/wdb.c#L474-L520), [src/wazuh_db/wdb.c:615-617](repo://src/wazuh_db/wdb.c#L615-L617), [src/headers/defs.h:224-225](repo://src/headers/defs.h#L224-L225)

### Transactions and closing

Write commands open a transaction and leave it open. `run_gc` calls `wdb_commit_old` every second, which commits a database when no query arrived for `commit_time_min` seconds or the transaction has been open for `commit_time_max`. This turns thousands of small inserts into a few commits. `wdb_close_old` then closes the least-used agent databases until the number of open ones is below `open_db_limit`; `global.db` is never closed. When `check_fragmentation_interval` elapses, `wdb_check_fragmentation` vacuums databases whose fragmentation passes the configured thresholds.

Sources: [src/wazuh_db/main.c:470-480](repo://src/wazuh_db/main.c#L470-L480), [src/wazuh_db/wdb.c:892-940](repo://src/wazuh_db/wdb.c#L892-L940), [src/wazuh_db/wdb.c:1086-1104](repo://src/wazuh_db/wdb.c#L1086-L1104)

## Schemas and upgrades

The agent schema lists the per-agent tables: `fim_entry`, `pm_event` (rootcheck), `sys_osinfo`, `sys_hwinfo`, `sys_netiface`, `sys_netproto`, `sys_netaddr`, `sys_ports`, `sys_programs`, `sys_hotfixes`, `sys_processes`, `sys_users`, `sys_groups`, the `sca_*` tables, `ciscat_results`, `scan_info`, `sync_info` and `metadata`. The global schema holds `agent`, `labels`, `group`, `belongs` (agent-group membership), `info` and `metadata`.

Sources: [src/wazuh_db/schema_agents.sql:9-120](repo://src/wazuh_db/schema_agents.sql#L9-L120), [src/wazuh_db/schema_agents.sql:120-235](repo://src/wazuh_db/schema_agents.sql#L120-L235), [src/wazuh_db/schema_agents.sql:235-345](repo://src/wazuh_db/schema_agents.sql#L235-L345), [src/wazuh_db/schema_agents.sql:345-390](repo://src/wazuh_db/schema_agents.sql#L345-L390), [src/wazuh_db/schema_global.sql:13-87](repo://src/wazuh_db/schema_global.sql#L13-L87)

The `agent` table carries each agent's identity, OS, version, `config_sum` and `merged_sum`, `last_keepalive`, group and group hash, and three status columns: `connection_status` (`pending`, `never_connected`, `active`, `disconnected`), `sync_status` for cluster replication, and `group_config_status`. Row `0` is the manager itself.

Sources: [src/wazuh_db/schema_global.sql:13-50](repo://src/wazuh_db/schema_global.sql#L13-L50)

`wdb_upgrade` reads `db_version` from `metadata` and applies each `schema_upgrade_vN.sql` above it in order. If a step fails, `wdb_backup` closes the database, saves a backup copy, deletes the file and recreates it from the template, so a broken upgrade costs that agent's history rather than stopping the daemon. A successful upgrade publishes an `upgradeAgentDB` event on the agent-events topic. `global.db` follows the same scheme with its own upgrade list.

Sources: [src/wazuh_db/wdb_upgrade.c:34-110](repo://src/wazuh_db/wdb_upgrade.c#L34-L110), [src/wazuh_db/wdb_upgrade.c:114-130](repo://src/wazuh_db/wdb_upgrade.c#L114-L130), [src/wazuh_db/wdb_upgrade.c:210-243](repo://src/wazuh_db/wdb_upgrade.c#L210-L243)

## Integrity synchronization

Agent modules keep the manager's copy of their state consistent with checksums rather than full transfers ([[DBSync and RSync]] covers the agent side). For each component (FIM files and registry, each syscollector table), the agent sends `integrity_check_global` with the first and last item and a checksum of its whole range, and `integrity_check_left`/`right` for halves when they differ. `wdbi_query_checksum` computes the SHA-1 over the same range on the manager:

Sources: [src/wazuh_db/wdb_integrity.c:262-320](repo://src/wazuh_db/wdb_integrity.c#L262-L320), [src/wazuh_db/wdb_integrity.c:369-430](repo://src/wazuh_db/wdb_integrity.c#L369-L430)

| Result | Meaning | Action |
| --- | --- | --- |
| `INTEGRITY_SYNC_CKS_OK` | Checksums match | Record completion; nothing to send |
| `INTEGRITY_SYNC_CKS_FAIL` | Checksums differ | Record attempt; the agent splits the range or sends rows |
| `INTEGRITY_SYNC_NO_DATA` | Manager has no rows in range | Record attempt; the agent sends rows |

Sources: [src/wazuh_db/wdb_integrity.c:590-668](repo://src/wazuh_db/wdb_integrity.c#L590-L668)

A global check also deletes manager rows outside the agent's `[begin, end]`, and a left check deletes rows between `end` and `tail`, which is how deletions on the agent reach the manager. If the agent's checksum equals the last checksum the manager stored, the range computation is skipped. Removed rows are reported on the router so indexed state can be cleaned too.

Sources: [src/wazuh_db/wdb_integrity.c:431-500](repo://src/wazuh_db/wdb_integrity.c#L431-L500), [src/wazuh_db/wdb_integrity.c:612-620](repo://src/wazuh_db/wdb_integrity.c#L612-L620), [src/wazuh_db/wdb_integrity.c:61-100](repo://src/wazuh_db/wdb_integrity.c#L61-L100)
