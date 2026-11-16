---
title: "Signatures"
---
## Overview

A signature describes one task call without making it: the task name, positional and keyword arguments, and execution options. Signatures are the building blocks of every workflow — chains, groups and chords are signatures too — and they are how callbacks and errbacks travel inside task messages. Because `Signature` subclasses `dict`, a signature serializes with JSON like any other mapping and can be rebuilt on the other side.

Sources: [celery/canvas.py:233-290](repo://celery/canvas.py#L233-L290)

This page covers the `Signature` class itself: creation, partial application, freezing, links, and the `|` operator. The workflow primitives built on it are on [[Chains]], [[Groups and Chords]] and [[Stamping]].

Sources: [celery/canvas.py:759-786](repo://celery/canvas.py#L759-L786)

## Creating signatures

### Constructors

A task offers three constructors. `task.signature(args, kwargs, **options)` has the same shape as `apply_async`; `task.s(*args, **kwargs)` is the short form; `task.si(...)` creates an immutable signature. All bind the signature to the task's app. `celery.signature(name_or_task, ...)` does the same for a task by name, clones an existing signature, or rebuilds one from a dict.

Sources: [celery/app/task.py:962-986](repo://celery/app/task.py#L962-L986), [celery/canvas.py:2395-2412](repo://celery/canvas.py#L2395-L2412)

```python
add.s(2, 2)                                   # {'task': 'tasks.add', 'args': (2, 2), ...}
add.s(2, 2).set(countdown=10).set(expires=30)
signature('tasks.add', args=(2, 2), options={'queue': 'math'})
```

Sources: [celery/canvas.py:244-264](repo://celery/canvas.py#L244-L264)

The constructor stores the keys `task` (the name; the task object itself is kept separately as `_type`), `args` (a tuple), `kwargs`, `options` (extra keyword arguments are merged into it), `subtask_type` and `immutable`. Properties expose them, plus `id`, `parent_id` and `root_id` from the options. `type` resolves the task in the app's registry on first use, so a signature for a task the current process does not know can still be created and sent; `apply_async` then falls back to `app.send_task`.

Sources: [celery/canvas.py:323-345](repo://celery/canvas.py#L323-L345), [celery/canvas.py:838-874](repo://celery/canvas.py#L838-L874)

### Signature types

Subclasses register themselves with `@Signature.register_type()` under a name stored as `subtask_type` (`chain`, `group`, `chord`, `chunks`, `xmap`, `xstarmap`). `Signature.from_dict(d)` looks up that name and lets the subclass rebuild itself, so a chord embedded in a message comes back as a chord. `maybe_signature(d, app)` accepts `None`, a signature (optionally cloned) or a dict, and binds the result to an app; the tracer and backends use it on every callback they read from a message.

Sources: [celery/canvas.py:296-321](repo://celery/canvas.py#L296-L321), [celery/canvas.py:2415-2442](repo://celery/canvas.py#L2415-L2442)

Pickling a signature stores only its dict; the task type is looked up again when unpickled.

Sources: [celery/canvas.py:823-829](repo://celery/canvas.py#L823-L829)

## Partial application

`_merge(args, kwargs, options)` combines a call's arguments with the stored ones. Positional arguments given at call time are **prepended**, keyword arguments are merged over the stored ones, and options are merged with the new values winning — except for `group_id`, `stamped_headers` and the stamped header keys themselves, which keep the stored value because changing them "would stall tasks". For an immutable signature only the options are merged, unless `force=True`.

Sources: [celery/canvas.py:403-443](repo://celery/canvas.py#L403-L443), [celery/canvas.py:290-292](repo://celery/canvas.py#L290-L292)

Prepending is what makes callbacks work: when a task succeeds, its return value is passed as the first argument of each linked signature (see [[Task Execution and Tracing]]). An immutable signature (`.si()`) ignores that value.

Sources: [celery/canvas.py:356-401](repo://celery/canvas.py#L356-L401)

`clone(args, kwargs, **opts)` (alias `partial`) returns a new signature of the same type with merged arguments and a deep copy of the options, so links in the copy can change without touching the original. `replace(args, kwargs, options)` clones and replaces whole sections. `set(**options)` updates options in place and returns the signature for chaining; `set(immutable=True)` toggles immutability.

Sources: [celery/canvas.py:445-471](repo://celery/canvas.py#L445-L471), [celery/canvas.py:524-552](repo://celery/canvas.py#L524-L552)

## Calling a signature

| Call | Effect |
| --- | --- |
| `sig(*a, **kw)` | Calls the task function in this process |
| `sig.delay(*a, **kw)` | `apply_async(a, kw)` |
| `sig.apply_async(args, kwargs, **opts)` | Merges, then calls the task's `apply_async` (or `send_task`) |
| `sig.apply(args, kwargs, **opts)` | Merges, then runs `task.apply` eagerly |
| `~sig` | `sig.apply_async().get()` |

Sources: [celery/canvas.py:347-401](repo://celery/canvas.py#L347-L401), [celery/canvas.py:820-821](repo://celery/canvas.py#L820-L821)

`apply_async` and `apply` drop options whose value is `None` before merging. When nothing is passed, the stored arguments and options are used as they are.

Sources: [celery/canvas.py:370-401](repo://celery/canvas.py#L370-L401)

## Freezing

`freeze(_id=None, group_id=None, chord=None, root_id=None, parent_id=None, group_index=None)` gives a signature its identity before it is sent. It sets `task_id` (keeping an existing one, else `_id` or a new UUID), the root and parent ids, `reply_to` (the app's thread oid when missing), the group id if not already set, the chord body and the group index, and returns an `AsyncResult` for the id. The docstring warns that a frozen signature must not be called twice, as both messages would share the id.

Sources: [celery/canvas.py:473-522](repo://celery/canvas.py#L473-L522)

Workflows freeze their parts first so that results can be wired together — a chain's result knows its parent, a chord's body knows the group it waits for — before any message is published.

Sources: [celery/canvas.py:1096-1105](repo://celery/canvas.py#L1096-L1105)

## Links

`link(callback)` appends a signature to the `link` option, to run with the result when this task succeeds; `link_error(errback)` appends to `link_error`, to run when it fails. Both return the added signature. `on_error(errback)` does the same as `link_error` but returns the original signature, so `add.s(2, 2).on_error(handler.s()).delay()` sends `add`. The options are lists; `append_to_list_option` turns a single value into a list and skips duplicates.

Sources: [celery/canvas.py:685-746](repo://celery/canvas.py#L685-L746)

`apply_async` turns these options into the message's `callbacks` and `errbacks`, which the tracer and backend use on success and failure; the errback calling conventions are on [[Result Backend Interface]]. `flatten_links()` returns the signature followed by every linked signature, recursively.

Sources: [celery/canvas.py:748-757](repo://celery/canvas.py#L748-L757), [celery/app/amqp.py:384-391](repo://celery/app/amqp.py#L384-L391)

## Composing with |

`a | b` builds a chain. A signature followed by a chain becomes one chain with the signature in front; a signature followed by a group becomes a chain of the two (a group with a single member is first unrolled into that member); a signature followed by another signature becomes a two-step chain. `|=` behaves the same, overriding Python 3.9's dict-merge meaning of the operator. How chains then run is on [[Chains]].

Sources: [celery/canvas.py:759-786](repo://celery/canvas.py#L759-L786), [celery/canvas.py:43-58](repo://celery/canvas.py#L43-L58)

## Replacing a running task

`Task.replace(sig)` uses signatures to swap the current task for another call while keeping its id. It refuses a signature that is part of a chord and an empty chain; turns a group into a chord with the built-in `celery.accumulate` body; copies the current task's callbacks and errbacks onto the replacement (pushing links down to the last task of a chain); freezes it with the current task id; carries over the chord, group, group index and root id; increments `replaced_task_nesting`; and appends the rest of the current chain. Then `on_replace` sends it and raises `Ignore` (see [[Defining Tasks]]).

Sources: [celery/app/task.py:1029-1095](repo://celery/app/task.py#L1029-L1095)

`Task.add_to_chord(sig)` adds a signature to the chord the current task belongs to: it sets the group, group index, chord and root id, freezes it, tells the backend to expect one more result, and sends it unless `lazy=True`. The docstring notes that only the Redis backend supports this.

Sources: [celery/app/task.py:1097-1119](repo://celery/app/task.py#L1097-L1119)
