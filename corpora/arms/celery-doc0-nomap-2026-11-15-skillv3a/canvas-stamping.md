---
title: "Canvas Stamping"
---
## Overview

Stamping attaches custom key/value headers to every task of a workflow at once: each member of a group, every step of a chain, the header and body of a chord, and their callbacks and errbacks. Typical uses are tagging all tasks of a user request with a monitoring id, or labelling a batch so it can be revoked as a whole. Stamps travel in the task message headers, are visible on the worker's request, and can be matched by `revoke_by_stamped_headers` to cancel every task carrying a stamp. The feature was added in Celery 5.3.

Sources: [celery/canvas.py:119-123](repo://celery/canvas.py#L119-L123), [celery/canvas.py:614-634](repo://celery/canvas.py#L614-L634)

The workflow primitives being stamped are described in [[Signatures and Chains]] and [[Groups and Chords]].

Sources: [celery/canvas.py:1107-1118](repo://celery/canvas.py#L1107-L1118)

## Stamping a signature

### Direct stamps

`sig.stamp(**headers)` adds headers to the signature's options and records their names in `options['stamped_headers']`. Calling it on a chain, group or chord walks into every member, so one call stamps a whole canvas.

Sources: [celery/canvas.py:614-634](repo://celery/canvas.py#L614-L634)

```python
from celery import chain, group

workflow = chain(fetch.s(url), group(parse.s(), index.s()), notify.s())
workflow.stamp(request_id='a1b2', tenant='acme')
workflow.apply_async()
```

Sources: [celery/canvas.py:1107-1118](repo://celery/canvas.py#L1107-L1118), [celery/canvas.py:1668-1689](repo://celery/canvas.py#L1668-L1689)

### Visitors

For stamps that vary per task (for example a fresh id per signature), pass a `StampingVisitor`: `sig.stamp(visitor=MyVisitor())`. The visitor's methods are called as the canvas is walked, and each returns a dict of headers to add at that point. Only `on_signature` is abstract; the others default to adding nothing.

Sources: [celery/canvas.py:119-229](repo://celery/canvas.py#L119-L229)

| Method | Called for |
| --- | --- |
| `on_signature(sig, **headers)` | Every single task signature |
| `on_group_start(group)` / `on_group_end(group)` | Entering and leaving a group |
| `on_chain_start(chain)` / `on_chain_end(chain)` | Entering and leaving a chain |
| `on_chord_header_start(chord)` / `on_chord_header_end(chord)` | The chord header (by default treated as a group) |
| `on_chord_body(chord)` | Before stamping the chord body |
| `on_callback(sig)` | Each `link` callback |
| `on_errback(sig)` | Each `link_error` errback |

Sources: [celery/canvas.py:125-229](repo://celery/canvas.py#L125-L229)

```python
from uuid import uuid4
from celery.canvas import StampingVisitor

class MonitoringIdStampingVisitor(StampingVisitor):
    def on_signature(self, sig, **headers) -> dict:
        return {'mtask_id': str(uuid4())}
```

Sources: [examples/stamping/visitors.py:15-19](repo://examples/stamping/visitors.py#L15-L19)

## How stamps are merged

### Order of traversal

Each primitive's `stamp` method follows the same pattern: ask the visitor for the "start" headers, merge them with the incoming headers, stamp the primitive's own links, recurse into the members with the merged headers, then call the "end" method. A chord stamps its header tasks with the header stamps and then stamps its body with the headers returned by `on_chord_body` added. A group created from a generator is stamped lazily, task by task, as the generator is consumed.

Sources: [celery/canvas.py:1107-1118](repo://celery/canvas.py#L1107-L1118), [celery/canvas.py:1668-1689](repo://celery/canvas.py#L1668-L1689), [celery/canvas.py:2127-2151](repo://celery/canvas.py#L2127-L2151), [celery/canvas.py:65-71](repo://celery/canvas.py#L65-L71)

### _stamp_headers

`_stamp_headers(visitor_headers, append_stamps, self_headers, **headers)` computes the final stamps for one signature. It sets `stamped_headers` to the list of header names, merges in the visitor's headers, and then merges in stamps already present in the signature's own options, considering only keys listed in its existing `stamped_headers`. The merge is `_merge_dictionaries`, which merges nested dicts recursively.

Sources: [celery/canvas.py:554-612](repo://celery/canvas.py#L554-L612), [celery/canvas.py:74-116](repo://celery/canvas.py#L74-L116)

`append_stamps` decides what happens when the same key is stamped twice. With `False` (the default) the later value replaces the earlier one, with the visitor winning over plain headers. With `True` the values are collected into a list, so a task stamped by two passes keeps both values.

Sources: [celery/canvas.py:573-597](repo://celery/canvas.py#L573-L597), [celery/canvas.py:99-113](repo://celery/canvas.py#L99-L113)

### Links

`stamp_links` stamps callbacks and errbacks with the visitor's `on_callback`/`on_errback` headers plus the incoming headers, but with `self_headers=False`, so a callback does not copy the stamps of the task it is attached to. Each link is then stamped recursively, which reaches links of links.

Sources: [celery/canvas.py:636-683](repo://celery/canvas.py#L636-L683)

### Protected during merging

Stamped header keys are treated as immutable options: when a stamped signature is later called with extra options, `_merge` will not let those options overwrite an existing stamp. This keeps stamps stable through partial application, retries and chain steps.

Sources: [celery/canvas.py:424-436](repo://celery/canvas.py#L424-L436)

## Stamps in messages and requests

### In the message

Stamps are ordinary execution options until the message is built. `as_task_v2` copies each name in `stamped_headers` from the options into a `stamps` dict and puts both `stamped_headers` and `stamps` in the message headers. `send_task` then removes the individual stamp keys from the publish options so they are not sent again as AMQP properties.

Sources: [celery/app/amqp.py:363-391](repo://celery/app/amqp.py#L363-L391), [celery/app/base.py:1017-1019](repo://celery/app/base.py#L1017-L1019)

### On the worker

The worker's `Request` exposes `stamped_headers` and `stamps` (mapping each stamped name to its value), and the task's `self.request` has the same fields. Retries and `Task.replace` preserve them: `Context.as_execution_options` puts `stamped_headers` and every stamp back into the options of the re-sent task. In eager mode `Task.apply` builds the same two fields from the options.

Sources: [celery/worker/request.py:327-334](repo://celery/worker/request.py#L327-L334), [celery/app/task.py:168-195](repo://celery/app/task.py#L168-L195), [celery/app/task.py:931-935](repo://celery/app/task.py#L931-L935)

## Revoking by stamp

### Sending the command

`app.control.revoke_by_stamped_headers({'mtask_id': [id1, id2]}, terminate=False)` broadcasts the `revoke_by_stamped_headers` control command to workers. `AsyncResult.revoke_by_stamped_headers(headers)` is a shortcut through the result's app. All header keys given must match for a task to be revoked.

Sources: [celery/app/control.py:512-535](repo://celery/app/control.py#L512-L535), [celery/result.py:167-189](repo://celery/result.py#L167-L189)

### What the worker does

The worker handler appends the values to `worker_state.revoked_stamps[header]`. With `terminate=True` it also scans active requests and terminates those whose stamps intersect the revoked values, using the given signal (default `TERM`), and replies with the stamps that matched.

Sources: [celery/worker/control.py:160-211](repo://celery/worker/control.py#L160-L211), [celery/worker/state.py:70-71](repo://celery/worker/state.py#L70-L71)

Tasks that arrive or are taken from the reserved queue later are checked in `Request.revoked()`: if one of the request's stamped headers is in `revoked_stamps` and its value (or any element of a list value) is among the revoked values, the task is discarded, logged with the matching header, and marked revoked. [[Remote Control and Inspection]] covers the revoke mechanism in general.

Sources: [celery/worker/request.py:470-509](repo://celery/worker/request.py#L470-L509)

> [!NOTE]
> `revoked_stamps` lives only in worker memory. Unlike revoked task ids, which a worker started with `--statedb` saves and reloads, revoked stamps are not persisted, so a restarted worker, or one started after the command was sent, does not know about them.

Sources: [celery/worker/state.py:67-71](repo://celery/worker/state.py#L67-L71), [celery/worker/state.py:192-198](repo://celery/worker/state.py#L192-L198)
