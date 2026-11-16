---
title: "Signatures"
---
## Overview

A `Signature` is a call that has been written down but not yet sent: the task name, the positional and keyword arguments, the execution options, and whether it is immutable. It is a `dict` subclass, so it serializes into a message as plain data, and every workflow in [[Chains, Groups and Chords]] is built from signatures. Sending a signature uses the same path as a task call, described in [[Sending Tasks]].

Sources: [celery/canvas.py:233-240](repo://celery/canvas.py#L233-L240)

Sources: [celery/canvas.py:323-345](repo://celery/canvas.py#L323-L345)

## Construction

The constructor accepts either a task name or a task object. A task object contributes its name, and the object itself is kept as the signature's type so that `apply_async` can call the task directly. Keyword arguments passed to the constructor are stored in the signature's `options`, next to any `options` dictionary.

Sources: [celery/canvas.py:323-345](repo://celery/canvas.py#L323-L345)

`signature(varies, ...)` is the public factory. A dictionary becomes a signature through `from_dict`; a signature passed to it is cloned, and anything else is passed to the constructor. `maybe_signature` does the same conversion but leaves a signature alone unless `clone` is set. The trace module binds `signature` to `maybe_signature` and uses it to turn each stored callback into a signature before it applies it.

Sources: [celery/canvas.py:2395-2412](repo://celery/canvas.py#L2395-L2412)

Sources: [celery/canvas.py:2415-2440](repo://celery/canvas.py#L2415-L2440)

Sources: [celery/app/trace.py:415-416](repo://celery/app/trace.py#L415-L416)

## Applying a signature

`apply_async` drops options whose value is `None`, then merges any new positional arguments, keyword arguments and options into the stored ones. When nothing new is passed, the stored values are used as they are. The merge is what makes partial application work: a signature built with some arguments takes the rest at call time.

Sources: [celery/canvas.py:370-402](repo://celery/canvas.py#L370-L402)

The merge in `_merge` prepends new positional arguments to the stored ones and merges keyword arguments and options. An immutable signature keeps its stored arguments and merges only options, unless `force` is set. Stamped headers are never merged.

Sources: [celery/canvas.py:403-444](repo://celery/canvas.py#L403-L444)

The function that does the sending is the `apply_async` of the task type when the name resolves in the app's registry; otherwise it is `app.send_task` with the task name bound.

Sources: [celery/canvas.py:859-865](repo://celery/canvas.py#L859-L865)

`~sig` applies the signature and waits for its result, through `apply_async().get()`.

Sources: [celery/canvas.py:820-821](repo://celery/canvas.py#L820-L821)

## Cloning and immutability

`clone` makes a new signature with the same task and options. The options are deep-copied so that a link or a stamp added to the clone does not change the original. Passing arguments to `clone` merges them the same way `apply_async` does.

Sources: [celery/canvas.py:445-472](repo://celery/canvas.py#L445-L472)

`set_immutable(True)` sets the `immutable` flag. An immutable signature ignores the arguments of a later call, so a result can be passed to it in a chain without changing its own arguments.

Sources: [celery/canvas.py:551-552](repo://celery/canvas.py#L551-L552)

Sources: [celery/canvas.py:438-440](repo://celery/canvas.py#L438-L440)

## Links and error callbacks

`link` adds a callback signature to the `link` option and `link_error` adds to `link_error`. Each one appends to a list and skips a callback already in the list, so linking the same signature twice does not send it twice.

Sources: [celery/canvas.py:717-726](repo://celery/canvas.py#L717-L726)

Sources: [celery/canvas.py:702-708](repo://celery/canvas.py#L702-L708)

The trace sends the link callbacks when the task succeeds and the error callbacks when it fails; the ordering is described in [[Task Execution]].

Sources: [celery/app/trace.py:426-449](repo://celery/app/trace.py#L426-L449)

Sources: [celery/app/trace.py:415-416](repo://celery/app/trace.py#L415-L416)

## Stamping

`stamp` gives a visitor the chance to add headers to a signature and its links, then writes the headers into the options with `set`. `append_stamps` decides whether a repeated stamp is replaced by the last value or kept as a list. Stamped headers are listed in the message so the worker can read them back.

Sources: [celery/canvas.py:614-635](repo://celery/canvas.py#L614-L635)
