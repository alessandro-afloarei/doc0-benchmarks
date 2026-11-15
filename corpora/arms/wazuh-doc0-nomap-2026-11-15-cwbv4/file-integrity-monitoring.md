---
title: "File Integrity Monitoring (Syscheck)"
---
## Overview

`wazuh-syscheckd` watches the files and directories listed in `<syscheck>` (and, on Windows, registry keys) and reports when one is added, modified or deleted. It keeps the last known state of every monitored entry in a local SQLite database managed by DBSync, so a change is detected by comparing a fresh read of the file with the stored row. Events go to the local queue with queue byte `8` (`SYSCHECK_MQ`) and reach the manager through [[Agent Daemon (agentd)]]. The same daemon also hosts the Rootcheck thread, covered on [[Security Configuration Assessment]].

Sources: [src/syscheckd/src/run_check.c:75-112](repo://src/syscheckd/src/run_check.c#L75-L112), [src/syscheckd/src/run_check.c:187-213](repo://src/syscheckd/src/run_check.c#L187-L213)

## Startup

`main` reads the configuration, initializes Rootcheck, opens the queue socket, and calls `fim_initialize`, which opens the FIM database. `DB::init` creates a `DBSync` handle of host type `AGENT` on SQLite, at `queue/fim/db/fim.db` when storage is on disk or `:memory:` otherwise, with the table schema for the current OS and the file and registry entry limits.

Sources: [src/syscheckd/src/main.c:130-200](repo://src/syscheckd/src/main.c#L130-L200), [src/syscheckd/src/main.c:280-290](repo://src/syscheckd/src/main.c#L280-L290), [src/syscheckd/src/syscheck.c:82-100](repo://src/syscheckd/src/syscheck.c#L82-L100), [src/syscheckd/src/db/src/db.cpp:26-39](repo://src/syscheckd/src/db/src/db.cpp#L26-L39), [src/syscheckd/src/db/include/db.h:41-42](repo://src/syscheckd/src/db/include/db.h#L41-L42)

`start_daemon` then lowers the process priority (`process_priority`), starts the Rootcheck thread, clears the `report_changes` diff directories left from the previous run, and runs the first scan, which builds the baseline. After it, it starts the real-time thread, the symlink checker, the synchronization thread when enabled, and the who-data provider (Linux audit or eBPF). It then loops every `SYSCHECK_WAIT` seconds and starts a new scan when `frequency` seconds have passed, when `scan_time`/`scan_day` match, or when a restart was requested.

Sources: [src/syscheckd/src/run_check.c:187-300](repo://src/syscheckd/src/run_check.c#L187-L300), [src/syscheckd/src/run_check.c:340-400](repo://src/syscheckd/src/run_check.c#L340-L400)

## Scheduled scans

### Scan flow

`fim_scan` measures the diff folder, re-expands wildcard directories, and calls `fim_file_scan` (and `fim_registry_scan` on Windows). `fim_file_scan` opens one DBSync transaction on the file table, walks every configured directory through `fim_checker`, adds real-time watches as it goes, and finally calls `fim_db_transaction_deleted_rows`: every row that the scan did not touch is reported as deleted.

Sources: [src/syscheckd/src/fim_scan.c:44-138](repo://src/syscheckd/src/fim_scan.c#L44-L138), [src/syscheckd/src/file/file.c:908-944](repo://src/syscheckd/src/file/file.c#L908-L944)

```mermaid
sequenceDiagram
  participant Loop as start_daemon
  participant Scan as fim_file_scan
  participant Check as fim_checker
  participant DB as DBSync transaction
  participant CB as transaction_callback
  Loop->>Scan: fim_scan()
  Scan->>DB: fim_db_transaction_start(file table)
  loop each configured directory
    Scan->>Check: fim_checker(path)
    Check->>DB: fim_db_transaction_sync_row(entry)
    DB-->>CB: INSERTED / MODIFIED
  end
  Scan->>DB: fim_db_transaction_deleted_rows()
  DB-->>CB: DELETED for rows not seen
  CB->>CB: build event, send_syscheck_msg()
```

Sources: [src/syscheckd/src/file/file.c:51-120](repo://src/syscheckd/src/file/file.c#L51-L120), [src/syscheckd/src/file/file.c:762-810](repo://src/syscheckd/src/file/file.c#L762-L810), [src/syscheckd/src/file/file.c:908-944](repo://src/syscheckd/src/file/file.c#L908-L944)

### Checking one path

`fim_checker` finds the configuration that owns the path (`fim_configuration_directory`). In a scheduled scan a path that belongs to a more specific configuration is skipped, so it is scanned with its own options; an event from real-time or who-data is only accepted when the path's configured mode matches the event's mode. It then enforces the recursion level, skips ignored paths and excluded filesystems, applies `restrict`, and recurses into directories. Regular files and links go to `fim_file`.

Sources: [src/syscheckd/src/file/file.c:589-694](repo://src/syscheckd/src/file/file.c#L589-L694)

`fim_file` throttles with `check_max_fps`, collects the attributes the configuration asks for with `fim_get_data` (size, permissions, owner, inode, mtime, hashes), and hands the row to DBSync: inside a scan as a transaction row, outside a scan with `fim_db_file_update`, which calls the same callback for a single row.

Sources: [src/syscheckd/src/file/file.c:762-810](repo://src/syscheckd/src/file/file.c#L762-L810), [src/syscheckd/src/file/file.c:490-588](repo://src/syscheckd/src/file/file.c#L490-L588)

## Building events

DBSync compares the new row with the stored one and calls `transaction_callback` with `INSERTED`, `MODIFIED` or `DELETED`. The callback maps that to `added`, `modified` or `deleted` and builds two documents:

Sources: [src/syscheckd/src/file/file.c:51-100](repo://src/syscheckd/src/file/file.c#L51-L100)

| Document | Content | Destination |
| --- | --- | --- |
| Stateless event | `collector: file`, `module: fim`, `data.event` with `created`, `type` and `changed_fields`, and `data.file` with the attributes, `previous` values, `mode`, `content_changes`, `audit` and `tags` | `send_syscheck_msg` to the queue |
| Stateful document | The same file attributes plus `checksum.hash.sha1` | `persist_syscheck_msg` |

Sources: [src/syscheckd/src/file/file.c:100-216](repo://src/syscheckd/src/file/file.c#L100-L216)

A modification whose changed attribute list is empty is dropped, so a touch that changes nothing monitored produces no event. Nothing is sent during the first scan (`notify_scan` is still 0), which keeps the baseline from flooding the manager. `send_syscheck_msg` sleeps one second after each `max_eps` messages. A `MAX_ROWS` result means the entry limit was reached: the file is not stored and only a debug message is written.

Sources: [src/syscheckd/src/file/file.c:96-100](repo://src/syscheckd/src/file/file.c#L96-L100), [src/syscheckd/src/file/file.c:160-195](repo://src/syscheckd/src/file/file.c#L160-L195), [src/syscheckd/src/run_check.c:94-112](repo://src/syscheckd/src/run_check.c#L94-L112), [src/syscheckd/src/fim_scan.c:118-121](repo://src/syscheckd/src/fim_scan.c#L118-L121)

When `report_changes` is set for the directory, `fim_file_diff` keeps a gzip copy of the file under the diff directory and returns the textual diff, added to the event as `content_changes`. The first time a file is seen there is nothing to compare, and a file over `file_size` or a full `disk_quota` gets an explanatory text instead of a diff. Deleting the file removes its copy.

Sources: [src/syscheckd/src/file/file.c:80-95](repo://src/syscheckd/src/file/file.c#L80-L95), [src/syscheckd/src/fim_diff_changes.c:406-440](repo://src/syscheckd/src/fim_diff_changes.c#L406-L440)

## Real-time and who-data

### Real-time (inotify)

On Linux, directories with `realtime="yes"` get inotify watches during each scan. `realtime_process` reads a batch of inotify events, de-duplicates the paths in a red-black tree, drops the watch of a directory that was moved or deleted, and calls `fim_realtime_event` for each path. That function waits `rt_delay` milliseconds (`fim_rt_delay`) (so an editor's save-by-rename is seen as one change), then runs `fim_checker` on the path, or `fim_process_missing_entry` when it no longer exists. A kernel queue overflow is reported as an event, and the next scheduled scan repairs the watch map.

Sources: [src/syscheckd/src/run_realtime.c:203-290](repo://src/syscheckd/src/run_realtime.c#L203-L290), [src/syscheckd/src/fim_scan.c:140-158](repo://src/syscheckd/src/fim_scan.c#L140-L158), [src/syscheckd/src/fim_scan.c:96-106](repo://src/syscheckd/src/fim_scan.c#L96-L106), [src/syscheckd/src/fim_scan.c:440-449](repo://src/syscheckd/src/fim_scan.c#L440-L449)

### Who-data

With `whodata="yes"` the change also carries who made it. On Linux the provider is either the audit subsystem (`fim_whodata_initialize` adds audit rules and parses the audit socket) or eBPF (`ebpf_whodata`); on Windows it uses SACLs and the security event log. Each provider produces a `whodata_evt` that `fim_whodata_event` checks like a real-time event and attaches as `audit` to the event. When the path is gone, it also looks up other paths sharing the inode and device, so a hard-link deletion is reported for every name.

Sources: [src/syscheckd/src/run_check.c:298-312](repo://src/syscheckd/src/run_check.c#L298-L312), [src/syscheckd/src/fim_scan.c:160-195](repo://src/syscheckd/src/fim_scan.c#L160-L195)

## Limits and database state

When `file_limit` is enabled the scan counts the stored entries, runs a second pass when the limit was reached (so entries freed by deletions get refilled), and `fim_check_db_state` tracks whether the database is below 80%, above 80%, above 90% or full, and sends a message when that state changes. On Windows the same applies to registry keys and values.

Sources: [src/syscheckd/src/fim_scan.c:66-96](repo://src/syscheckd/src/fim_scan.c#L66-L96), [src/syscheckd/src/fim_scan.c:197-296](repo://src/syscheckd/src/fim_scan.c#L197-L296)

## Synchronization

The stateful documents and the periodic synchronization are being rebuilt in this branch: `persist_syscheck_msg` only logs the document, and `fim_run_integrity` sleeps `sync_interval` seconds between runs with the call to `fim_synchronize` commented out. The manager-side consumers of FIM data are described on [[Inventory Harvester]], and the DBSync engine behind the transactions on [[DBSync and RSync]].

Sources: [src/syscheckd/src/run_check.c:115-128](repo://src/syscheckd/src/run_check.c#L115-L128), [src/syscheckd/src/run_check.c:520-538](repo://src/syscheckd/src/run_check.c#L520-L538)
