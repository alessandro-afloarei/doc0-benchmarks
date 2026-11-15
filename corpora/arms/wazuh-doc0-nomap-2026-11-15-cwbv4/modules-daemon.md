---
title: "Modules Daemon (modulesd)"
---
## Overview

`wazuh-modulesd` is a host process for "wodles" (Wazuh modules). Each module is a C structure with a function table and a configuration blob; the daemon reads all modules from the configuration, starts one thread per module, and then only waits for them. The same binary runs on agents and managers, but the set of modules differs: managers add the database synchronizer, the download helper, the router, the content manager, the inventory harvester and the vulnerability scanner. This page covers the framework and the helpers modules share; each module has its own page, listed in the catalogue below.

Sources: [src/wazuh_modules/main.c:27-121](repo://src/wazuh_modules/main.c#L27-L121), [src/wazuh_modules/wmodules.c:58-108](repo://src/wazuh_modules/wmodules.c#L58-L108)

## The module contract

### wm_context and wmodule

Every module provides a constant `wm_context` with its name and function pointers, and each configured instance is a `wmodule` node in a linked list:

Sources: [src/wazuh_modules/wmodules_def.h:35-53](repo://src/wazuh_modules/wmodules_def.h#L35-L53)

```c
typedef struct wm_context {
    const char *name;                           // Name for module
    wm_routine start;                           // Main function
    void (*destroy)(void *);                    // Configuration destructor
    cJSON *(* dump)(const void *);              // Dump current configuration
    int (* sync)(const char*);                  // Sync
    void (*stop)(void *);                       // Module destructor
    size_t (*query)(void *, char *, char **);   // Run a query
} wm_context;

typedef struct wmodule {
    pthread_t thread;                   // Thread ID
    const wm_context *context;          // Context (common structure)
    char *tag;                          // Module tag
    void *data;                         // Data (module-dependent structure)
    struct wmodule *next;               // Pointer to next module
} wmodule;
```

Sources: [src/wazuh_modules/wmodules_def.h:35-53](repo://src/wazuh_modules/wmodules_def.h#L35-L53)

`start` receives `data` and runs for the life of the process. `dump` serves `getconfig`, `sync` receives synchronization messages addressed to the module, and `query` answers ad-hoc requests. Unused entries are `NULL`, as in the database module's context.

Sources: [src/wazuh_modules/wm_database.c:95-104](repo://src/wazuh_modules/wm_database.c#L95-L104)

### Loading modules

`wm_config` reads the module internal options (`task_nice`, `max_eps`, `kill_timeout`), adds the default modules that run even without a configuration block (`agent-upgrade`, and `task-manager` on managers), and calls `ReadConfig(CWMODULE, ...)` on `ossec.conf`. On agents it then reads the `agent.conf` modules; on managers it appends the router, content manager, database, download and inventory harvester modules. On Unix-like systems the control module is always added.

Sources: [src/wazuh_modules/wmodules.c:30-36](repo://src/wazuh_modules/wmodules.c#L30-L36), [src/wazuh_modules/wmodules.c:58-108](repo://src/wazuh_modules/wmodules.c#L58-L108)

`wm_check` then removes nodes whose reader produced no context (a disabled or empty block) and, when a module tag appears twice, keeps only the last definition, so `agent.conf` overrides `ossec.conf`. If no module is left the daemon logs "No configuration defined" and exits successfully.

Sources: [src/wazuh_modules/wmodules.c:120-170](repo://src/wazuh_modules/wmodules.c#L120-L170), [src/wazuh_modules/main.c:163-166](repo://src/wazuh_modules/main.c#L163-L166)

## Process lifecycle

`main` reads `wazuh_modules.debug`, raises the open file limit to `wazuh_modules.rlimit_nofile`, and calls `wm_setup`, which loads the configuration, daemonizes, resolves the `wazuh` group, writes the PID file, and initializes the child process pool. With `-t` it stops after loading the configuration. It then creates one joinable thread per module with `context->start`, starts the `wmcom` request thread, installs the signal handlers, and joins the module threads.

Sources: [src/wazuh_modules/main.c:27-121](repo://src/wazuh_modules/main.c#L27-L121), [src/wazuh_modules/main.c:141-178](repo://src/wazuh_modules/main.c#L141-L178)

At exit, `wm_cleanup` kills every child process started through `wm_exec` and deletes the PID file, so an integration script never outlives the daemon.

Sources: [src/wazuh_modules/main.c:182-192](repo://src/wazuh_modules/main.c#L182-L192)

## Shared helpers

### Running external programs

`wm_exec(command, &output, &exitcode, secs, add_path)` is how modules run scripts such as the cloud wodles. On Unix it forks; the child prepends `add_path` to `PATH`, starts a new session with `setsid`, redirects stdout and stderr to a pipe, applies `wazuh_modules.task_nice`, and calls `execvp`. The parent registers the child's session for cleanup, reads the pipe in a reader thread, and waits on a condition variable for at most `secs` seconds; on timeout it sends `SIGTERM` to the whole process group and returns `WM_ERROR_TIMEOUT`.

Sources: [src/wazuh_modules/wm_exec.c:316-430](repo://src/wazuh_modules/wm_exec.c#L316-L430), [src/wazuh_modules/wm_exec.c:430-470](repo://src/wazuh_modules/wm_exec.c#L430-L470)

### Sending events

Modules write events with `wm_sendmsg` or `wm_sendmsg_ex`, which sleep `usec` microseconds before each `SendMSG` to enforce the module's events-per-second limit (`wazuh_modules.max_eps` by default). The predicate version stops early when the module is shutting down.

Sources: [src/wazuh_modules/wmodules.c:427-443](repo://src/wazuh_modules/wmodules.c#L427-L443)

### Scheduling

Scheduled modules (SCA, command, the cloud integrations) embed a `sched_scan_config` read by `sched_scan_read` from four tags. `interval` accepts the suffixes `s`, `m`, `h`, `d`, `w`, and `M` for months; `day` is a day of the month, `wday` a weekday, and `time` an `hh:mm` time. `sched_scan_get_time_until_next_scan` returns 0 on the first call when `run_on_start` is set, and otherwise computes the wait from the most specific option: day of month, then weekday, then time of day, then the plain interval. Daylight-saving changes are corrected with `check_daylight`.

Sources: [src/shared/schedule_scan.c:21-120](repo://src/shared/schedule_scan.c#L21-L120), [src/shared/schedule_scan.c:122-162](repo://src/shared/schedule_scan.c#L122-L162)

## The command module

`<wodle name="command">` runs a command on a schedule and turns each output line into an event. If the command came from the shared `agent.conf`, it only runs when `wazuh_command.remote_commands` is enabled on the agent. When `verify_md5`, `verify_sha1` or `verify_sha256` is set, the binary is hashed first and the module refuses to run it on a mismatch unless `skip_verification` is set. Each run uses `wm_exec` with the configured timeout; unless `ignore_output` is set, every line is sent with queue byte `1` and location `command_<tag>`.

Sources: [src/wazuh_modules/wm_command.c:40-140](repo://src/wazuh_modules/wm_command.c#L40-L140), [src/wazuh_modules/wm_command.c:166-230](repo://src/wazuh_modules/wm_command.c#L166-L230)

## Request socket

`wmcom` listens on `queue/sockets/wmodules`. It answers `getconfig wmodules` (every module's `dump`), `getconfig internal_options`, `query <module> <args>` (routed to the module's `query`), and passes sync messages such as `syscollector_sync` to the matching module's `sync`. The manager reaches it through the agent request channel on [[Agent Daemon (agentd)]].

Sources: [src/wazuh_modules/wmcom.c:16-85](repo://src/wazuh_modules/wmcom.c#L16-L85), [src/headers/defs.h:132-132](repo://src/headers/defs.h#L132-L132)

## Module catalogue

| Module | Runs on | Purpose | Page |
| --- | --- | --- | --- |
| `syscollector` | Both | Hardware, OS, packages, ports, processes inventory | [[System Inventory (Syscollector and Data Provider)]] |
| `sca` | Both | Policy-based configuration checks | [[Security Configuration Assessment]] |
| `command` | Both | Scheduled commands whose output becomes events | This page |
| `aws-s3`, `azure-logs`, `gcp-pubsub`, `gcp-bucket`, `github`, `office365`, `ms-graph`, `docker-listener` | Both | Pull logs from cloud and SaaS services | [[Cloud and Service Integrations]] |
| `agent-upgrade`, `task-manager` | Both / manager | Remote WPK upgrades and task tracking | [[Agent Upgrades and Task Manager]] |
| `control` | Both (Unix) | Answers the agent's primary IP on `queue/sockets/control` | This page |
| `database` | Manager | Keeps `global.db` in sync with `client.keys` and group files | [[Wazuh DB]] |
| `download` | Manager | Downloads a URL to a file on request (`download` command) | This page |
| `router` | Manager | Starts the publish/subscribe broker | [[Router Publish/Subscribe Module]] |
| `content_manager` | Manager | Content download orchestration | [[Content Manager]] |
| `inventory-harvester` | Manager | Indexes FIM and inventory state | [[Inventory Harvester]] |
| `vulnerability-detection` | Manager | CVE matching on inventory | [[Vulnerability Scanner]] |

Sources: [src/wazuh_modules/wmodules.c:58-108](repo://src/wazuh_modules/wmodules.c#L58-L108), [src/wazuh_modules/wmodules.h:24-40](repo://src/wazuh_modules/wmodules.h#L24-L40), [src/wazuh_modules/wm_control.c:168-230](repo://src/wazuh_modules/wm_control.c#L168-L230), [src/wazuh_modules/wm_download.c:117-150](repo://src/wazuh_modules/wm_download.c#L117-L150), [src/wazuh_modules/wm_database.c:107-130](repo://src/wazuh_modules/wm_database.c#L107-L130)
