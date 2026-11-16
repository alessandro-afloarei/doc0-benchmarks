---
title: "Service Control and Monitord"
---
## Overview

Wazuh has no supervisor process: `wazuh-control` (the installed `wazuh-server.sh` or `wazuh-client.sh`) starts each daemon binary, and each daemon daemonizes itself, drops privileges and writes a PID file under `var/run`. The script then uses those PID files to report status and to stop the daemons. `wazuh-monitord` is the housekeeping daemon on the manager: it rotates and signs logs, and marks agents as disconnected when they stop sending keep-alives. This page follows both; the commands themselves are listed on [[Quickstart: Build and Install]].

Sources: [src/init/wazuh-server.sh:300-419](repo://src/init/wazuh-server.sh#L300-L419), [src/monitord/monitord.c:28-100](repo://src/monitord/monitord.c#L28-L100)

## Starting the daemons

### Order and checks

The manager script lists its daemons in `DAEMONS` and starts them in the reverse order (`SDAEMONS`), so the dependencies come up first: `wazuh-forwarder`, `wazuh-apid`, `wazuh-authd`, `wazuh-db`, `wazuh-execd`, `wazuh-analysisd`, then the collectors and `wazuh-remoted`, `wazuh-monitord`, `wazuh-modulesd`, and `wazuh-clusterd` last. Before anything starts, `testconfig` runs every daemon with `-t`.

Sources: [src/init/wazuh-server.sh:30-35](repo://src/init/wazuh-server.sh#L30-L35), [src/init/wazuh-server.sh:221-241](repo://src/init/wazuh-server.sh#L221-L241)

`start_service` then empties `tmp/`, kills daemons with deprecated names left from upgrades, and walks the list. `wazuh-clusterd` and `wazuh-authd` are skipped when their `<cluster>` or `<auth>` block is missing or says `<disabled>yes`, which the script checks with `grep` and `sed` on `ossec.conf`. A daemon that already has a live PID file is reported as already running.

Sources: [src/init/wazuh-server.sh:300-348](repo://src/init/wazuh-server.sh#L300-L348)

### Launch and confirmation

For each daemon the script creates `var/run/<daemon>.start`, runs the binary, and waits up to `MAX_ITERATION` (60) seconds for its PID file to appear, except for optional daemons such as `wazuh-clusterd`. Any failure writes `var/run/<daemon>.failed`, removes the start flags and aborts the whole start, so a partial start is visible and not left running silently.

Sources: [src/init/wazuh-server.sh:44-46](repo://src/init/wazuh-server.sh#L44-L46), [src/init/wazuh-server.sh:356-410](repo://src/init/wazuh-server.sh#L356-L410), [src/init/wazuh-server.sh:422-432](repo://src/init/wazuh-server.sh#L422-L432)

The engine needs one more check, because creating its PID file does not mean it can process events. `wait_for_wazuh_engine_ready` starts `wazuh-analysisd`, polls for its PID file, and then calls the engine API on `queue/sockets/analysis` (`POST /router/route/get` for the `default` route) up to ten times. If the engine dies or never answers, the script kills it and the start fails.

Sources: [src/init/wazuh-server.sh:243-297](repo://src/init/wazuh-server.sh#L243-L297)

## Status and stop

`pstatus` reads `var/run/<daemon>-*.pid`, removes PID files whose process no longer exists, and reports running when `kill -0` succeeds. `stop_service` walks `DAEMONS` (the reverse of the start order), sends `SIGTERM` to each running daemon, waits for it to exit, falls back to `SIGKILL`, and deletes its PID files. `reload` is a restart that leaves `wazuh-execd` running, so pending active-response timeouts survive.

Sources: [src/init/wazuh-server.sh:434-470](repo://src/init/wazuh-server.sh#L434-L470), [src/init/wazuh-server.sh:495-545](repo://src/init/wazuh-server.sh#L495-L545), [src/init/wazuh-server.sh:612-618](repo://src/init/wazuh-server.sh#L612-L618)

## What every daemon does at start

### Daemonizing

The C daemons follow the same steps. `goDaemon` forks, calls `setsid` to leave the controlling terminal, forks again so the process can never reacquire one, redirects standard input, output and error to `/dev/null`, and marks the process as a daemon so logging goes only to `ossec.log`. Running with `-f` skips this.

Sources: [src/shared/file_op.c:1219-1255](repo://src/shared/file_op.c#L1219-L1255)

### Dropping privileges

Daemons resolve the `wazuh` user and group with `Privsep_GetUser`/`Privsep_GetGroup` and switch with `Privsep_SetGroup` (which also resets supplementary groups with `setgroups`) and `Privsep_SetUser`. Each does it at the point where it no longer needs root: remoted after binding port 1514, agentd right after daemonizing, the engine after loading its configuration.

Sources: [src/shared/privsep_op.c:92-166](repo://src/shared/privsep_op.c#L92-L166), [src/remoted/remoted.c:100-108](repo://src/remoted/remoted.c#L100-L108), [src/client-agent/agentd.c:39-52](repo://src/client-agent/agentd.c#L39-L52)

### PID files

`CreatePID(name, pid)` writes `var/run/<name>-<pid>.pid` with mode 0640. The PID in the file name lets the scripts tell processes apart, and lets `pstatus` clean stale files left by a crash.

Sources: [src/shared/file_op.c:639-664](repo://src/shared/file_op.c#L639-L664)

## Monitord

### Main loop

`Monitord` waits ten seconds for the other daemons, connects to the queue socket, starts the `moncom` request thread, and loops once per second. On a manager each tick checks three agent triggers, then the log trigger:

Sources: [src/monitord/monitord.c:28-100](repo://src/monitord/monitord.c#L28-L100)

| Trigger | Action |
| --- | --- |
| Disconnection | `wdb_disconnect_agents` marks agents whose last keep-alive is older than `agents_disconnection_time` as `disconnected` |
| Alert | For agents still disconnected after `agents_disconnection_alert_time` more, sends an "agent disconnected" event to the queue |
| Deletion | With `delete_old_agents` set, removes agents disconnected that many minutes through authd and sends a deletion event |
| Logs | Daily: rotate `ossec.log`/`ossec.json`, then sign and compress the previous day's alerts and archives; otherwise rotate by size |

Sources: [src/monitord/monitor_actions.c:49-162](repo://src/monitord/monitor_actions.c#L49-L162), [src/monitord/monitor_actions.c:163-216](repo://src/monitord/monitor_actions.c#L163-L216)

Because it is the master's monitord that marks agents disconnected (the code notes that workers' state does not need synchronizing for this), a cluster has one consistent view of connection status; see [[Cluster]].

Sources: [src/monitord/monitor_actions.c:49-55](repo://src/monitord/monitor_actions.c#L49-L55)

### Log rotation and signing

`w_rotate_log` moves `ossec.log` and `ossec.json` into `logs/wazuh/<year>/<month>/` with a day suffix (and a counter for size-based rotations), compresses them when configured, and deletes rotated logs older than `keep_log_days`. `manage_files` handles yesterday's `archives` and `alerts` (`.log` and `.json`) and `firewall` logs: `OS_SignLog` writes a `.sum` file with the MD5, SHA-1 and SHA-256 of the file and of the previous day's file, chaining the days together so tampering with an old log is detectable; then `OS_CompressLog` gzips it.

Sources: [src/monitord/rotate_log.c:38-90](repo://src/monitord/rotate_log.c#L38-L90), [src/monitord/manage_files.c:20-59](repo://src/monitord/manage_files.c#L20-L59), [src/monitord/sign_log.c:20-60](repo://src/monitord/sign_log.c#L20-L60)

On agents there is no monitord; `wazuh-agentd` runs the same `w_rotate_log` in its own rotation thread when `monitord.rotate_log` is set, as [[Agent Daemon (agentd)]] shows.

Sources: [src/client-agent/agentd.c:115-119](repo://src/client-agent/agentd.c#L115-L119), [src/client-agent/rotate_log.c:26-70](repo://src/client-agent/rotate_log.c#L26-L70)
