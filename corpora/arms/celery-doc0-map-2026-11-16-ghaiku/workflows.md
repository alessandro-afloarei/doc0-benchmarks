---
title: "Chains, Groups and Chords"
---
## Overview

`chain`, `group` and `chord` are subclasses of `Signature` that combine other signatures into a workflow. Applying one sends the first message or messages; the rest of the workflow moves along as the tasks finish. The shape of each is the same across the three: a chain sends one step at a time, a group sends all its members at once, and a chord sends a group and then a body that receives the group's results. The signature type is in [[Signatures]], and the trace code that moves a finished step on is in [[Task Execution]].

Sources: [celery/canvas.py:935-944](repo://celery/canvas.py#L935-L944)

Sources: [celery/canvas.py:1492-1500](repo://celery/canvas.py#L1492-L1500)

Sources: [celery/canvas.py:1971-1980](repo://celery/canvas.py#L1971-L1980)

## Chains

`chain.apply_async` runs the chain in the calling process when `task_always_eager` is set. Otherwise it calls `run`, passing the app and the chain's own options.

Sources: [celery/canvas.py:1036-1046](repo://celery/canvas.py#L1036-L1046)

`run` first unpacks the steps with `prepare_steps`. A nested chain is flattened into its parent, and a group followed by a task becomes a chord: `chain(group(a, b), c)` is upgraded to a chord whose body is `c`.

Sources: [celery/canvas.py:1120-1134](repo://celery/canvas.py#L1120-L1134)

The unpacked list is held with the next step at its end. `run` pops the last element, sends it with the remaining steps in its options, and returns that step's result. When the chain has one step, the step is sent directly and its own result object is returned, so a group inside it can fill its promise.

Sources: [celery/canvas.py:1048-1094](repo://celery/canvas.py#L1048-L1094)

When a step finishes, the trace takes the last remaining step, applies it with the step's return value as its argument, and passes the rest of the list as its `chain`. Each step therefore sends the one after it, and no process holds the whole chain.

Sources: [celery/app/trace.py:466-473](repo://celery/app/trace.py#L466-L473)

## Groups

`group.apply_async` returns the result immediately when `task_always_eager` is set. Otherwise it fixes the group id and the root id, prepares the member tasks, and applies them under one barrier, so the group's `GroupResult` can tell when all members are ready.

Sources: [celery/canvas.py:1616-1650](repo://celery/canvas.py#L1616-L1650)

`_prepared` builds the member signatures for this group id and root id, and `_apply_tasks` sends them under the barrier.

Sources: [celery/canvas.py:1714-1762](repo://celery/canvas.py#L1714-L1762)

Sources: [celery/canvas.py:1763-1790](repo://celery/canvas.py#L1763-L1790)

If the group holds a single item that is itself a group, that inner `GroupResult` is returned instead, so the caller gets one result object. The group is added to the parent task's trail when it is applied from inside a task.

Sources: [celery/canvas.py:1644-1651](repo://celery/canvas.py#L1644-L1651)

## Chords

`chord.apply_async` builds the header as a group, merges the chord's options into the call, and calls `run` with the body. Under eager mode it calls `apply` instead.

Sources: [celery/canvas.py:2153-2177](repo://celery/canvas.py#L2153-L2177)

`run` freezes the body first, so the body has its id before any header member finishes. It then tells the backend that the header is a chord with a counter, sends the header, and sets the body as the parent of the returned result.

Sources: [celery/canvas.py:2226-2286](repo://celery/canvas.py#L2226-L2286)

An empty header is a special case: the body is sent at once with an empty list, because no header member will ever finish and trigger it.

Sources: [celery/canvas.py:2271-2283](repo://celery/canvas.py#L2271-L2283)

## Counting header results

Each header member stores its result and then calls `on_chord_part_return` on the backend. The key-value base class restores the group, increments a counter stored under the chord's key, and waits until the counter reaches the size of the group.

Sources: [celery/backends/base.py:1188-1206](repo://celery/backends/base.py#L1188-L1206)

When the counter reaches the group size, the backend joins the group's results with `propagate=True` and sends the body with them. A join error is passed to `chord_error_from_stack` together with the body, and the group and counter are deleted in either case.

Sources: [celery/backends/base.py:1220-1256](repo://celery/backends/base.py#L1220-L1256)

Redis overrides the counting. It keeps the parts in keys derived from the group id with the suffixes `.j`, `.t` and `.s`, and does its work in a pipeline.

Sources: [celery/backends/redis.py:593-612](repo://celery/backends/redis.py#L593-L612)

The base backend's `apply_chord` does not count parts. It sends the `celery.chord_unlock` task with the header results, the body and a countdown, using the body's queue and priority.

Sources: [celery/backends/base.py:838-860](repo://celery/backends/base.py#L838-L860)

Sources: [celery/backends/base.py:864-867](repo://celery/backends/base.py#L864-L867)

Redis saves the header's group result when one of its members is itself a group, because the structure must be kept when the chord finishes and the results are passed to the body.

Sources: [celery/backends/redis.py:573-586](repo://celery/backends/redis.py#L573-L586)
