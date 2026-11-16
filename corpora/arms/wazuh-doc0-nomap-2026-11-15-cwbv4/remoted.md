---
title: "Remoted: Agent Connections"
---
## Overview

`wazuh-remoted` is the manager's network front door. It accepts agent connections on TCP or UDP port 1514 (by default), decrypts each message with the agent's key, and splits the traffic in two: events go to the engine through the local queue socket and, for inventory and FIM, to the router; control messages (startup, keep-alive, shutdown, request answers) update the agent's state in [[Wazuh DB]] and may trigger a push of shared configuration. In the other direction it delivers active-response commands, shared files and requests to agents. A separate remoted process can also receive plain syslog from network devices.

Sources: [src/remoted/remoted.c:30-146](repo://src/remoted/remoted.c#L30-L146), [src/remoted/secure.c:178-296](repo://src/remoted/secure.c#L178-L296), [src/headers/defs.h:344-345](repo://src/headers/defs.h#L344-L345)

## Process layout

`main` reads the `<remote>` blocks and forks one child per block; each child runs `HandleRemote` for its position. `HandleRemote` binds the TCP socket (with keepalive and receive timeout options for secure connections) and/or the UDP socket, drops to the `wazuh` user, writes the PID file, and branches: a `secure` connection runs `HandleSecure`, a `syslog` connection runs `HandleSyslog` (UDP) or `HandleSyslogTCP`. A syslog block without `allowed-ips` exits immediately.

Sources: [src/remoted/main.c:210-231](repo://src/remoted/main.c#L210-L231), [src/remoted/remoted.c:30-146](repo://src/remoted/remoted.c#L30-L146)

## Secure connections

### Threads

`HandleSecure` starts a set of threads before entering its event loop:

Sources: [src/remoted/secure.c:178-245](repo://src/remoted/secure.c#L178-L245)

| Thread | Role |
| --- | --- |
| `rem_handler_main` × `remoted.worker_pool` | Decrypt and dispatch received messages |
| `save_control_thread` | Write control messages to wazuh-db |
| `wait_for_msgs` × `remoted.sender_pool` | Send shared files to agents that need them |
| `update_shared_files` | Rebuild group bundles every `remoted.shared_reload` seconds |
| `AR_Forward`, `SCFGA_Forward` | Relay active-response and SCA dump requests to agents |
| `remcom_main` | Local socket `queue/sockets/remote` |
| `rem_keyupdate_main`, `close_fp_main` | Reload `client.keys`; close idle counter files |
| `key_request_thread` | Ask for keys of unknown agents |

Sources: [src/remoted/secure.c:213-285](repo://src/remoted/secure.c#L213-L285), [src/remoted/secure.c:300-303](repo://src/remoted/secure.c#L300-L303)

It also resets every agent's connection status in wazuh-db, creates the router providers `deltas-syscollector`, `deltas-syscheck` and `rsync`, opens the queue socket for writing, and loads the keys in encryption mode.

Sources: [src/remoted/secure.c:249-299](repo://src/remoted/secure.c#L249-L299)

### The event loop

The loop waits on an epoll/kqueue set (`wnotify`) containing the listening sockets and every TCP client. A readable listening TCP socket is accepted and its client added to the set; UDP datagrams are pushed straight into the message queue; readable TCP clients are drained with `nb_recv`; writable clients are flushed with `nb_send`. Messages are not processed in this thread: `rem_msgpush` puts them on a bounded queue (`remoted.queue_size`) that the worker pool consumes.

Sources: [src/remoted/secure.c:322-370](repo://src/remoted/secure.c#L322-L370), [src/remoted/secure.c:372-470](repo://src/remoted/secure.c#L372-L470)

### TCP framing

On TCP each message is prefixed by its length as a 4-byte integer. `nb_recv` appends incoming bytes to a per-socket buffer and pushes every complete frame; a frame larger than the maximum closes the connection. For sending, `nb_queue` appends a length-prefixed frame to the socket's send queue and switches the socket to read-write monitoring, so writes never block the event loop.

Sources: [src/remoted/netbuffer.c:59-110](repo://src/remoted/netbuffer.c#L59-L110), [src/remoted/netbuffer.c:187-225](repo://src/remoted/netbuffer.c#L187-L225)

## Handling a message

`HandleSecureMessage` runs in a worker thread for each frame.

Sources: [src/remoted/secure.c:555-600](repo://src/remoted/secure.c#L555-L600)

1. Identify the agent from the `!id!` prefix or the source IP, as [[Message Encryption and Client Keys]] describes. An unknown agent triggers a key request and the socket is closed.
2. If the agent already has another live TCP socket, the new one is refused with "Agent key already in use", unless the old socket was idle for longer than `connection_overtake_time`, in which case the old one is closed.
3. Decrypt with `ReadSecMSG`. A wrong key also triggers a key request; any failure closes the socket.
4. Record the receive time. A control message (`#!-` header) goes to control handling; anything else is an event.
5. For an event, write `[id] (name) ip` as location with `SendMSG(..., SECURE_MQ)` to the queue socket (reconnecting once on failure), then call `router_message_forward`.

Sources: [src/remoted/secure.c:699-760](repo://src/remoted/secure.c#L699-L760), [src/remoted/secure.c:762-790](repo://src/remoted/secure.c#L762-L790), [src/remoted/secure.c:909-948](repo://src/remoted/secure.c#L909-L948)

`router_message_forward` inspects the message prefix: syscollector deltas go to `deltas-syscollector`, syscheck deltas to `deltas-syscheck`, and DBSync/RSync integrity messages (FIM files, registry keys and values, syscollector sync) to `rsync`. Each is published as flatbuffer-ready JSON with the agent's ID, name, IP and version, which is how [[Inventory Harvester]] and [[Vulnerability Scanner]] see agent data. See [[Router Publish/Subscribe Module]].

Sources: [src/remoted/secure.c:954-1027](repo://src/remoted/secure.c#L954-L1027)

## Control messages

### Validation and queueing

For a control message the worker saves the agent's protocol, peer address and TCP socket in the keystore, then calls `validate_control_msg`. Request answers (`#!-req`) are handed to the request module at once. A startup message records the agent version in `agent_data_hash`; an agent newer than the manager is flagged unless `allow_higher_versions` is set. A shutdown message removes it and emits an "agent stopped" event. Keep-alives have their trailing random string stripped.

Sources: [src/remoted/secure.c:790-895](repo://src/remoted/secure.c#L790-L895), [src/remoted/manager.c:251-370](repo://src/remoted/manager.c#L251-L370)

Valid messages are put on `control_msg_queue` keyed by agent ID with an upsert, so if an agent sends several keep-alives before the database thread catches up only the latest is stored.

Sources: [src/remoted/secure.c:851-885](repo://src/remoted/secure.c#L851-L885)

### Saving to wazuh-db

`save_control_thread` pops entries and calls `save_controlmsg`. A startup sets the agent to `pending`, a shutdown to `disconnected`, and a keep-alive identical to the previous one only refreshes the timestamp and sets `active`. A changed keep-alive is parsed into OS, version, labels and the `merged.mg` checksum, and written in full. On a cluster worker the sync status is `syncreq` so the master receives the change; on the master it is `synced`. Agents with an incompatible version receive an error message and are recorded with that status.

Sources: [src/remoted/manager.c:384-480](repo://src/remoted/manager.c#L384-L480), [src/remoted/manager.c:480-597](repo://src/remoted/manager.c#L480-L597)

## Shared configuration

### Group bundles

Each group directory under `etc/shared` (and each multi-group combination) is merged into one `merged.mg` file with an MD5 checksum. `update_shared_files` re-scans the groups every `remoted.shared_reload` seconds, reloads the group definitions file if it changed, and rebuilds bundles whose files changed.

Sources: [src/remoted/manager.c:1780-1808](repo://src/remoted/manager.c#L1780-L1808), [src/remoted/manager.c:669-760](repo://src/remoted/manager.c#L669-L760), [src/remoted/manager.c:901-927](repo://src/remoted/manager.c#L901-L927)

### Pushing to agents

While saving a keep-alive, `save_controlmsg` looks up the agent's group (`lookfor_agent_group`) and compares the agent's reported `merged.mg` sum with the group's. When they differ the agent ID is queued on `pending_queue`. A `wait_for_msgs` thread then calls `send_file_toagent`, which sends `#!-up file <md5> merged.mg`, the file in 900-byte frames, and `#!-close file`. The agent side of this exchange is on [[Agent Daemon (agentd)]].

Sources: [src/remoted/manager.c:470-500](repo://src/remoted/manager.c#L470-L500), [src/remoted/manager.c:1717-1778](repo://src/remoted/manager.c#L1717-L1778), [src/remoted/manager.c:1635-1716](repo://src/remoted/manager.c#L1635-L1716)

## Sending to agents

### Encrypting and delivering

`send_msg(agent_id, msg, length)` refuses agents whose last message is older than `agents_disconnection_time`. It encrypts with `CreateSecMSG` and either sends a UDP datagram to the stored peer address or queues the frame on the agent's TCP socket through the netbuffer.

Sources: [src/remoted/sendmsg.c:60-144](repo://src/remoted/sendmsg.c#L60-L144)

### Requests

`queue/sockets/remote` is remoted's local API. A JSON message is a command for remoted itself (`getstats`, `getagentsstats`, `getconfig`). A plain message `<agent id> <target> <payload>` is a request for an agent: `req_sender` registers it under a counter, and a dispatcher thread sends `#!-req <counter> <target> <payload>` to the agent, retrying up to `remoted.max_attempts` times with `request_rto_sec`/`request_rto_msec` between tries, then waits for the agent's answer and writes it back to the caller. [[Agent Upgrades and Task Manager]] uses this to stream WPK files.

Sources: [src/remoted/remcom.c:210-285](repo://src/remoted/remcom.c#L210-L285), [src/remoted/request.c:49-70](repo://src/remoted/request.c#L49-L70), [src/remoted/request.c:118-200](repo://src/remoted/request.c#L118-L200)

## Syslog input

In syslog mode remoted receives datagrams (or TCP lines), drops senders not in `allowed-ips` or listed in `denied-ips`, and writes each message to the queue with queue byte `2` (`SYSLOG_MQ`) and the sender IP as location.

Sources: [src/remoted/syslog.c:40-121](repo://src/remoted/syslog.c#L40-L121)
