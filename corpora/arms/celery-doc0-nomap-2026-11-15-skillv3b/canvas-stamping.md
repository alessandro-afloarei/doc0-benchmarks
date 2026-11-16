---
title: "Canvas Stamping"
---
## Overview

Stamping attaches custom key-value headers ("stamps") to every task in a workflow, including tasks created deep inside chains, groups, chords, callbacks and errbacks. The stamps travel in each task's message, are available to the running task as `self.request.stamps`, survive retries, and can be used to revoke every task carrying a given value. Typical uses are a monitoring id shared by a whole workflow, a tenant or user id for auditing, or a label used to cancel one branch of a running canvas. Stamping works on the signatures described on [[Signatures and Canvas Primitives]], before the workflow is sent.

Sources: [celery/canvas.py:119-128](repo://celery/canvas.py#L119-L128), [celery/canvas.py:614-634](repo://celery/canvas.py#L614-L634)

## Stamping a signature

`sig.stamp(visitor=None, append_stamps=False, **headers)` stamps the signature's links first, then asks the visitor (if any) for headers with `on_signature`, merges them with the keyword headers and with stamps already on the signature, and stores the result in the signature's options with `set`. The options then contain each stamp as a key plus `stamped_headers`, the list of keys that are stamps.

Sources: [celery/canvas.py:614-634](repo://celery/canvas.py#L614-L634)

```python
sig = add.s(2, 2)
sig.stamp(monitoring_id='abc123')
sig.options
# {'monitoring_id': 'abc123', 'stamped_headers': ['monitoring_id']}
```

Sources: [celery/canvas.py:554-612](repo://celery/canvas.py#L554-L612)

`_stamp_headers` does the merging. Keyword headers get a `stamped_headers` list if they do not have one; visitor headers are merged in, and on a key conflict the visitor's value wins (or both are kept in a list when `append_stamps=True`); finally the signature's existing stamps are merged in the same way. Stamping twice with different visitors therefore accumulates stamps instead of replacing them.

Sources: [celery/canvas.py:554-612](repo://celery/canvas.py#L554-L612), [celery/canvas.py:74-116](repo://celery/canvas.py#L74-L116)

Stamps are protected from accidental change: `_merge` treats `stamped_headers` and every key it lists as immutable options, so `apply_async(monitoring_id=...)` on a stamped signature does not overwrite the stamp.

Sources: [celery/canvas.py:285-289](repo://celery/canvas.py#L285-L289), [celery/canvas.py:424-433](repo://celery/canvas.py#L424-L433)

## Visitors

A `StampingVisitor` decides stamps per node of the canvas. Only `on_signature` is abstract; every other hook returns no headers by default. Each `on_*_start` and `on_*` hook returns a dict of headers for that node and everything inside it.

Sources: [celery/canvas.py:119-230](repo://celery/canvas.py#L119-L230)

| Hook | Called for |
| --- | --- |
| `on_signature(sig, **headers)` | Every task signature (required) |
| `on_chain_start(chain)`, `on_chain_end(chain)` | Each chain, around its tasks |
| `on_group_start(group)`, `on_group_end(group)` | Each group, around its members |
| `on_chord_header_start(chord)`, `on_chord_header_end(chord)` | The chord header; by default delegate to the group hooks |
| `on_chord_body(chord)` | The chord body |
| `on_callback(sig)`, `on_errback(sig)` | Each `link` and `link_error` signature |

Sources: [celery/canvas.py:125-230](repo://celery/canvas.py#L125-L230)

The repository's examples include a visitor that gives every task a fresh monitoring id.

Sources: [examples/stamping/visitors.py:1-19](repo://examples/stamping/visitors.py#L1-L19)

```python
from uuid import uuid4

from celery.canvas import Signature, StampingVisitor


class MonitoringIdStampingVisitor(StampingVisitor):
    def on_signature(self, sig: Signature, **headers) -> dict:
        mtask_id = str(uuid4())
        return {"mtask_id": mtask_id}
```

Sources: [examples/stamping/visitors.py:15-19](repo://examples/stamping/visitors.py#L15-L19)

## Walking a canvas

Each primitive overrides `stamp` to call its visitor hooks and recurse into its children.

Sources: [celery/canvas.py:1093-1102](repo://celery/canvas.py#L1093-L1102)

- A chain calls `on_chain_start`, stamps its own links, stamps each task with the combined headers, then calls `on_chain_end`.
- A group calls `on_group_start`, stamps its links and each member, then `on_group_end`. A lazy generator of members is stamped as it is consumed, through `regen.map`, so stamping does not exhaust it.
- A chord stamps its header with the header hooks, then asks `on_chord_body` for extra headers and stamps the body with them.
- `stamp_links` stamps callbacks and errbacks with `on_callback` and `on_errback`, without copying the parent signature's own stamps onto them.

Sources: [celery/canvas.py:1093-1102](repo://celery/canvas.py#L1093-L1102), [celery/canvas.py:1668-1689](repo://celery/canvas.py#L1668-L1689), [celery/canvas.py:2127-2151](repo://celery/canvas.py#L2127-L2151), [celery/canvas.py:636-683](repo://celery/canvas.py#L636-L683)

Headers returned by an outer hook flow down: a stamp added in `on_group_start` reaches every member, which may add its own in `on_signature`.

Sources: [celery/canvas.py:1668-1689](repo://celery/canvas.py#L1668-L1689)

```python
from celery import chain, group

s1 = chain(identity_task.si("foo11"), identity_task.si("foo12"))
s1.link(identity_task.si("link_foo1"))
s1.link_error(identity_task.si("link_error_foo1"))
s2 = chain(identity_task.si("foo21"), identity_task.si("foo22"))

canvas = group([s1, s2])
canvas.stamp(MonitoringIdStampingVisitor())
canvas.delay()
```

Sources: [examples/stamping/examples.py:7-18](repo://examples/stamping/examples.py#L7-L18)

## Stamps in messages and tasks

When a stamped signature is sent, `send_task` passes the options to `as_task_v2`, which writes `stamped_headers` and a `stamps` dict (each stamp key with its value) into the message headers, then removes the stamp keys from the publish options so they are not sent twice ([[Calling Tasks and the Message Protocol]]).

Sources: [celery/app/amqp.py:366-391](repo://celery/app/amqp.py#L366-L391), [celery/app/base.py:1019-1021](repo://celery/app/base.py#L1019-L1021)

In the worker the request exposes `stamped_headers` and `stamps`, and the task reads them from `self.request`. `Context.as_execution_options` puts the stamps back into the options, so a `retry` or `replace` keeps them. Eager calls with `apply` build the same two fields.

Sources: [celery/worker/request.py:322-335](repo://celery/worker/request.py#L322-L335), [celery/app/task.py:168-196](repo://celery/app/task.py#L168-L196), [celery/app/task.py:931-935](repo://celery/app/task.py#L931-L935)

```python
@app.task(bind=True)
def identity_task(self, x):
    stamps = self.request.stamps or {}
    logger.info('stamps: %r', stamps)
    return x
```

Sources: [examples/stamping/tasks.py:13-23](repo://examples/stamping/tasks.py#L13-L23)

A replaced task does not stamp its replacement automatically. A base task can do it in `on_replace`, as the `MonitoredTask` example does with `sig.stamp(MonitoringIdStampingVisitor())` before calling the base implementation.

Sources: [examples/stamping/tasks.py:39-56](repo://examples/stamping/tasks.py#L39-L56)

## Revoking by stamp

`result.revoke_by_stamped_headers({'mystamp': 'I am a stamp!'}, terminate=True)` broadcasts the `revoke_by_stamped_headers` control command ([[Remote Control and Inspection]]). Each worker adds the values to `worker_state.revoked_stamps`; with `terminate`, it also kills running requests whose stamps match. The client then revokes the matched ids by id, so workers that see those tasks later also skip them.

Sources: [celery/result.py:167-189](repo://celery/result.py#L167-L189), [celery/worker/control.py:156-212](repo://celery/worker/control.py#L156-L212), [celery/app/control.py:512-546](repo://celery/app/control.py#L512-L546)

When a stamped request arrives or is about to run, `Request.revoked()` compares each of its stamps with `revoked_stamps`, treating list values as sets of alternatives, and discards the task with `Discarding revoked task ... (revoked by header: ...)` on a match ([[Task Requests and Strategies]]). Stamps revoked this way are held in memory only and are not saved by `--statedb`.

Sources: [celery/worker/request.py:470-509](repo://celery/worker/request.py#L470-L509), [celery/worker/state.py:69-70](repo://celery/worker/state.py#L69-L70)

```python
canvas = (create_canvas(n=3) | wait_for_revoke.s())
canvas.stamp(MonitoringIdStampingVisitor())
result = canvas.delay()
result.revoke_by_stamped_headers({'mystamp': 'I am a stamp!'}, terminate=True)
```

Sources: [examples/stamping/revoke_example.py:22-60](repo://examples/stamping/revoke_example.py#L22-L60)
