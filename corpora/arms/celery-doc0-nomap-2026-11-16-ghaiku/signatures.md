---
title: "Signatures"
---
## Overview

A `Signature` is a task call that has not been sent yet. It holds the task name, the arguments and the execution options as a dictionary, so it can be stored, serialized, extended and sent later. Every canvas primitive, such as a chain, a group or a chord, is a `Signature` subclass, and the workflow in each one is built from signatures. This page covers the class itself: how it is built, how partial arguments and options are merged, how callbacks are attached, and how stamps are written onto it. The composition primitives are in [[Chains and Groups]] and [[Chords]].

Sources: [celery/canvas.py:233-250](repo://celery/canvas.py#L233-L250), [celery/canvas.py:935-945](repo://celery/canvas.py#L935-L945)

## Construction

`Signature.__init__` takes the task as a name, a task class or a task instance. A task object is stored by its name, and the object itself is kept on the signature for lookups. The arguments are stored as a tuple, the keyword arguments as a dictionary, and the execution options as a dictionary merged with any keyword options.

Sources: [celery/canvas.py:323-345](repo://celery/canvas.py#L323-L345)

`register_type` records a subclass under a name, and `from_dict` rebuilds a signature from a dictionary. When the dictionary's `subtask_type` names a registered subclass, `from_dict` uses that subclass; otherwise it builds a plain `Signature`.

Sources: [celery/canvas.py:297-321](repo://celery/canvas.py#L297-L321)

## Sending a signature

`apply_async` on a signature is a thin call. It drops `None` options, looks up the apply function of the task, and calls it with the stored arguments. For a callback, the extra arguments passed in are prepended to the stored arguments, and the options are merged.

Sources: [celery/canvas.py:370-401](repo://celery/canvas.py#L370-L401)

```python
        # Extra options set to None are dismissed
        options = {k: v for k, v in options.items() if v is not None}
        try:
            _apply = self._apply_async
        except IndexError:  # pragma: no cover
            # no tasks for chain, etc to find type
            return
        # For callbacks: extra args are prepended to the stored args.
        if args or kwargs or options:
            args, kwargs, options = self._merge(args, kwargs, options)
        else:
            args, kwargs, options = self.args, self.kwargs, self.options
        # pylint: disable=too-many-function-args
        #   Works on this, as it's a property
        return _apply(args, kwargs, **options)
```

Sources: [celery/canvas.py:370-401](repo://celery/canvas.py#L370-L401)

`_apply_async` is a property of the signature type. For a task it is the task's own `apply_async`, and for a name it is `send_task` with that name, so a signature built from a string needs no task object in the calling process.

Sources: [celery/canvas.py:859-864](repo://celery/canvas.py#L859-L864)

## Merging partial arguments

`_merge` adds partial arguments and options to the stored ones. When the signature is immutable and `force` is false, the stored arguments are kept and only the options change. Stamped headers are never merged, which keeps a stamp from being overwritten by a later call.

Sources: [celery/canvas.py:403-444](repo://celery/canvas.py#L403-L444)

`clone` makes a copy of the signature with the partial arguments and options merged into the copy, and `partial` is an alias of it. The original signature is not changed. `set` updates the options, and `set_immutable` changes the flag that stops new arguments from being merged.

Sources: [celery/canvas.py:445-472](repo://celery/canvas.py#L445-L472), [celery/canvas.py:539-553](repo://celery/canvas.py#L539-L553)

## Callbacks

`link` and `link_error` add a signature to the `link` or `link_error` list in the options. The list is created if it does not exist and the value is appended. The tracer dispatches the success callbacks before it stores the result, as [[Task Execution Tracing]] describes.

Sources: [celery/canvas.py:717-734](repo://celery/canvas.py#L717-L734), [celery/canvas.py:702-716](repo://celery/canvas.py#L702-L716)

## Stamping

`_stamp_headers` collects the stamps for a signature from the visitor, from the explicit headers and from the signature's own options. With `append_stamps` set, a repeated stamp becomes a list, and without it the last value replaces the earlier one.

Sources: [celery/canvas.py:554-578](repo://celery/canvas.py#L554-L578)

`stamp` writes those headers onto the signature. When a visitor is passed, the visitor decides the headers, and `stamp_links` applies the same visitor to the callbacks and errbacks. The `StampingVisitor` class has one method per canvas shape, such as `on_group_start`, `on_chain_start` and `on_signature`, each of which returns the headers for that shape.

Sources: [celery/canvas.py:614-650](repo://celery/canvas.py#L614-L650), [celery/canvas.py:119-175](repo://celery/canvas.py#L119-L175)

## Composition operators

`__or__` builds a chain from two signatures, so `sig1 | sig2` returns a chain. A group on the right-hand side is unrolled into the chain first.

Sources: [celery/canvas.py:759-780](repo://celery/canvas.py#L759-L780)

`reprcall` produces the readable form of the call, and `__json__` and `__reduce__` make a signature serializable. A signature is a dictionary, so the same serializer that sends the task message can carry it.

Sources: [celery/canvas.py:800-835](repo://celery/canvas.py#L800-L835)
