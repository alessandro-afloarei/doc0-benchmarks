---
title: "System Inventory (Syscollector and Data Provider)"
---
## Overview

Syscollector is the `wazuh-modulesd` module that inventories the host: hardware, operating system, network interfaces and addresses, installed packages, hotfixes, open ports, running processes, users and groups. It is split in three layers: the C module `wm_syscollector.c` that the modules daemon starts and that sends messages; the C++ `Syscollector` class that schedules scans and diffs each result against a local DBSync database; and the `sysinfo` data provider library that knows how to read each kind of data on each operating system. The manager-side consumers of the resulting deltas are [[Inventory Harvester]] and [[Vulnerability Scanner]].

Sources: [src/wazuh_modules/wm_syscollector.c:149-260](repo://src/wazuh_modules/wm_syscollector.c#L149-L260), [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:997-1030](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L997-L1030), [src/data_provider/include/sysInfo.hpp:39-69](repo://src/data_provider/include/sysInfo.hpp#L39-L69)

## Module startup

`wm_sys_main` runs in its own modulesd thread (the module framework is on [[Modules Daemon (modulesd)]]). It connects to the queue socket, loads the `syscollector` shared library with `so_get_module_handle` and resolves `syscollector_start` and `syscollector_stop`. On a manager it also loads the `router` library and creates a router provider named `deltas-syscollector`, unless `vulnerability-detection.disable_scan_manager` is set. It starts the synchronization thread when enabled and then calls `syscollector_start` with the scan interval, two callbacks, the database and normalizer paths, and one flag per data type.

Sources: [src/wazuh_modules/wm_syscollector.c:149-268](repo://src/wazuh_modules/wm_syscollector.c#L149-L268)

`syscollector_start` does not return until the module stops: `Syscollector::init` creates the DBSync handle (host type `AGENT`, SQLite, persistent, with the `CREATE TABLE` statements for every inventory table) and the normalizer, then enters `syncLoop`.

Sources: [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:238-306](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L238-L306)

## Scan cycle

### Scheduling

`syncLoop` scans once at start when `scan_on_start` is set, then waits on a condition variable for `interval` seconds between scans, so a stop request wakes it immediately. `scan` runs one function per data type, each wrapped in `TRY_CATCH_TASK` so a failing collector does not stop the others, in this order: hardware, OS, network, packages, hotfixes, ports, processes, groups, users. At the end it sets `m_notify`, so deltas are reported from the second scan on unless `notify_first_scan` asked for the first one too.

Sources: [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:997-1030](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L997-L1030), [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:257-286](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L257-L286)

```mermaid
sequenceDiagram
  participant Loop as syncLoop
  participant Scan as scanPackages
  participant Info as SysInfo
  participant Txn as DBSyncTxn
  participant Notify as notifyChange
  participant Wm as wm_sys_send_diff_message
  Loop->>Scan: scan()
  Scan->>Txn: open transaction on packages table
  Scan->>Info: packages(callback)
  Info-->>Scan: one package JSON per call
  Scan->>Txn: syncTxnRow(normalized package)
  Txn-->>Notify: INSERTED / MODIFIED
  Scan->>Txn: getDeletedRows()
  Txn-->>Notify: DELETED
  Notify->>Wm: stateless delta JSON
```

Sources: [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:761-804](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L761-L804), [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:134-192](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L134-L192)

### Streaming collectors

Packages and processes can be large, so the data provider streams them: `scanPackages` opens a DBSync transaction on the packages table and passes a callback to `SysInfo::packages`, which calls it once per package. Each package is sanitized, given a `checksum` of its fields, normalized, filtered by the exclusion list, and synced as one row. After the provider finishes, `getDeletedRows` reports every stored package that was not seen.

Sources: [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:761-804](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L761-L804)

### Batch collectors

Smaller data types (hotfixes, OS, hardware, users, groups) are read in one call and passed to `updateChanges`, which syncs the whole array in one transaction with `return_old_data` enabled, then collects deleted rows the same way.

Sources: [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:194-236](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L194-L236), [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:806-827](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L806-L827)

## Deltas

DBSync calls `notifyChange` with the result type and the row (for `MODIFIED`, both `new` and `old`). `processEvent` converts the row with `ecsData` into nested ECS-style fields (`package.name`, `package.version`, and so on, plus `checksum.hash.sha1`) and hands it to the persist callback. When notifications are on, it also builds the stateless delta, whose `collector` is the table name; an abbreviated example for a package update follows.

Sources: [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:156-192](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L156-L192), [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:316-372](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L316-L372)

```json
{
  "collector": "dbsync_packages",
  "module": "inventory",
  "data": {
    "package": { "name": "openssl", "version": "3.0.2" },
    "event": { "type": "modified", "created": "2025-01-01T00:00:00Z", "changed_fields": ["package.version"] }
  }
}
```

Sources: [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:168-190](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L168-L190), [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:420-440](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L420-L440), [src/wazuh_modules/syscollector/src/syscollectorTablesDef.hpp:209-214](repo://src/wazuh_modules/syscollector/src/syscollectorTablesDef.hpp#L209-L214)

The event types are `created`, `modified` and `deleted`; for a modification `addPreviousFields` stores the old values and lists which fields changed. `wm_sys_send_diff_message` writes the delta to the queue with queue byte `d` (`SYSCOLLECTOR_MQ`), rate-limited to `max_eps` with `wm_sendmsg_ex`, and reconnects under a mutex if the queue is gone. On a manager it also adapts the delta for agent `000` and publishes it on the `deltas-syscollector` router topic, so the manager's own inventory reaches the server modules without going through remoted.

Sources: [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:49-56](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L49-L56), [src/wazuh_modules/wm_syscollector.c:81-118](repo://src/wazuh_modules/wm_syscollector.c#L81-L118)

Each table has a primary key used for the row identity and for `calculateHashId`: OS name, hardware serial number, hotfix name, `name:version:architecture:type:path` for packages, PID for processes, `inode:transport:ip:port` for ports, and user or group names.

Sources: [src/wazuh_modules/syscollector/src/syscollectorImp.cpp:1032-1097](repo://src/wazuh_modules/syscollector/src/syscollectorImp.cpp#L1032-L1097)

## Normalization

`SysNormalizer` reads `norm_config.json`. Its `exclusions` drop items whose field matches a pattern for a given OS and data type (for example macOS packages named `Siri` or `iCloud`), and its `dictionary` adds or rewrites fields (for example setting `vendor` to `Microsoft` for macOS packages whose name matches `.*Microsoft.*`).

Sources: [src/wazuh_modules/syscollector/norm_config.json:1-40](repo://src/wazuh_modules/syscollector/norm_config.json#L1-L40), [src/wazuh_modules/syscollector/src/syscollectorNormalizer.cpp:24-140](repo://src/wazuh_modules/syscollector/src/syscollectorNormalizer.cpp#L24-L140)

## The data provider

`SysInfo` is a thin public class whose public methods call private virtual `get*` methods; each operating system has its own `sysInfo<OS>.cpp` that implements them, and the build picks the file for the target platform. This keeps the collectors free of `#ifdef`s and lets tests replace `ISysInfo` with a mock.

Sources: [src/data_provider/include/sysInfo.hpp:39-69](repo://src/data_provider/include/sysInfo.hpp#L39-L69), [src/data_provider/src/sysInfo.cpp:15-68](repo://src/data_provider/src/sysInfo.cpp#L15-L68)

On Linux, `getPackages` asks every package manager present on disk, by checking its database directory: dpkg, pacman, rpm, apk and snap. It then scans the default PyPI and npm locations, excluding Python packages already reported by the system package manager so they are not listed twice.

Sources: [src/data_provider/src/sysInfoLinux.cpp:588-602](repo://src/data_provider/src/sysInfoLinux.cpp#L588-L602), [src/data_provider/src/packages/packageLinuxDataRetriever.h:88-120](repo://src/data_provider/src/packages/packageLinuxDataRetriever.h#L88-L120)

Users and groups come from the `extended_sources` providers (`GroupsProvider`, `UserGroupsProvider`, and the user providers per OS). On Linux each group lists its member names joined by `:`; hotfixes are only collected on Windows.

Sources: [src/data_provider/src/sysInfoLinux.cpp:604-650](repo://src/data_provider/src/sysInfoLinux.cpp#L604-L650)

## Synchronization

As in [[File Integrity Monitoring (Syscheck)]], the stateful side is being rebuilt in this branch: the persist callback only logs the document, and `wm_sync_module` sleeps `sync_interval` seconds per round with the synchronization call commented out. `wm_sync_message`, which receives sync messages that agentd forwards from the manager, accepts them but does not process them yet.

Sources: [src/wazuh_modules/wm_syscollector.c:120-130](repo://src/wazuh_modules/wm_syscollector.c#L120-L130), [src/wazuh_modules/wm_syscollector.c:358-390](repo://src/wazuh_modules/wm_syscollector.c#L358-L390)
