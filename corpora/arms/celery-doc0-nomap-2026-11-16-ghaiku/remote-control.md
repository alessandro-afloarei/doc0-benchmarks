---
title: "Remote Control and Revocation"
---
## Overview

A caller can send a command to running workers without a task: revoke a task, change a rate limit, grow the pool, or ask for statistics. The caller's side is `Control` and `Inspect` in `celery/app/control.py`. The worker's side is a mailbox, the `Pidbox` bootstep, that hands each command to a handler registered in `celery/worker/control.py`. Revocation is the command whose effect reaches the requests of [[Task Requests in the Worker]], and the revoked set survives a restart when the worker keeps a state database.

Sources: [celery/app/control.py:426-452](repo://celery/app/control.py#L426-L452), [celery/worker/pidbox.py:20-37](repo://celery/worker/pidbox.py#L20-L37), [celery/worker/control.py:69-72](repo://celery/worker/control.py#L69-L72)

## Sending a command

`Control.revoke` is a thin wrapper over `broadcast`. It passes the command name `revoke` with the task id, the `terminate` flag and the signal name as its arguments, and the destination and any extra keywords are forwarded unchanged.

Sources: [celery/app/control.py:488-510](repo://celery/app/control.py#L488-L510)

`broadcast` sends the command to the mailbox of the broker connection. It can wait for replies and collect them, and it names a destination list when only some workers should act. The reply, when asked for, comes back as the return value.

Sources: [celery/app/control.py:755-790](repo://celery/app/control.py#L755-L790)

## Receiving a command

`Pidbox.on_message` takes each mailbox message and passes it to the node's `handle_message`. The node was built with the `Panel` handler table, and the state it receives holds the app, the host name, the consumer and a set type that depends on the event-loop mode.

Sources: [celery/worker/pidbox.py:25-47](repo://celery/worker/pidbox.py#L25-L47), [celery/worker/pidbox.py:20-37](repo://celery/worker/pidbox.py#L20-L37)

Each command is a function registered with `control_command`, which adds it to the `control` panel. A command takes the state as its first argument, and the decorator records the variadic argument and the signature text for the command's help.

Sources: [celery/worker/control.py:69-72](repo://celery/worker/control.py#L69-L72), [celery/worker/control.py:134-137](repo://celery/worker/control.py#L134-L137)

## Revoking a task

The `revoke` command accepts one id or a list of ids, and it delegates to `_revoke`. `_revoke` adds the ids to the worker's revoked set, so any request for one of them is skipped when it reaches the pool.

Sources: [celery/worker/control.py:134-153](repo://celery/worker/control.py#L134-L153), [celery/worker/control.py:214-219](repo://celery/worker/control.py#L214-L219)

The same function records the revocation in the result backend with `mark_as_revoked`, so a caller that asks for the state of the task sees it as revoked. A backend failure is logged, and the revocation still takes effect in the worker.

Sources: [celery/worker/control.py:220-225](repo://celery/worker/control.py#L220-L225)

When `terminate` is set, `_revoke` looks for the active request with each id and calls `terminate` on it with the signal, which defaults to TERM. The request's own `terminate` decides whether the process is signalled now or when the job is accepted.

Sources: [celery/worker/control.py:226-238](repo://celery/worker/control.py#L226-L238), [celery/worker/request.py:416-428](repo://celery/worker/request.py#L416-L428)

The revoked set is checked when a message is received, and again before the pool gets the job, so an id revoked before either point is skipped. The check is the `revoked` method described in [[Task Requests in the Worker]].

Sources: [celery/worker/request.py:470-492](repo://celery/worker/request.py#L470-L492), [celery/worker/strategy.py:150-156](repo://celery/worker/strategy.py#L150-L156), [celery/worker/request.py:341-356](repo://celery/worker/request.py#L341-L356)

## Persistent revocations

`Persistent` is the worker's state database, enabled with the `statedb` option. It is a shelve file that stores the revoked ids with a clock value. When it opens, it merges the saved revoked ids into the worker's set and purges the entries that have expired.

Sources: [celery/worker/state.py:192-211](repo://celery/worker/state.py#L192-L211), [celery/worker/state.py:252-262](repo://celery/worker/state.py#L252-L262)

## Other commands

The rest of the control panel is a list of similar functions. `rate_limit` and `time_limit` change a task's limits in the worker. `enable_events` and `disable_events` switch the event dispatcher, which [[Events]] describes. The inspect commands such as `stats`, `active`, `scheduled`, `reserved`, `revoked` and `registered` read the state without changing it.

Sources: [celery/worker/control.py:245-262](repo://celery/worker/control.py#L245-L262), [celery/worker/control.py:295-305](repo://celery/worker/control.py#L295-L305), [celery/worker/control.py:344-362](repo://celery/worker/control.py#L344-L362), [celery/worker/control.py:406-462](repo://celery/worker/control.py#L406-L462)
