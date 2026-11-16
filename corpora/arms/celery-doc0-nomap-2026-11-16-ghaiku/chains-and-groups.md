---
title: "Chains and Groups"
---
## Overview

A chain runs its steps one after another, each step's result feeding the next as a callback. A group starts all its members at once and returns a `GroupResult` for them. Both are `Signature` subclasses in `celery/canvas.py`, and each one runs itself: the builtin tasks that older versions used for this are kept only as compatibility stubs. The chords that combine a group with a body are on [[Chords]], and the `Signature` base class is on [[Signatures]].

Sources: [celery/canvas.py:935-960](repo://celery/canvas.py#L935-L960), [celery/app/builtins.py:134-162](repo://celery/app/builtins.py#L134-L162)

## Chains

`chain` takes its steps in `__init__` and stores them as its `tasks`. `apply_async` calls `apply` when the app runs tasks eagerly, and otherwise calls `run` with the chain's options.

Sources: [celery/canvas.py:947-955](repo://celery/canvas.py#L947-L955), [celery/canvas.py:1036-1046](repo://celery/canvas.py#L1036-L1046)

`run` merges the caller's arguments into the chain's own, then passes the steps to `prepare_steps`. The result of `prepare_steps` is the flat list of steps that will actually run, with nested chains, groups and chords unpacked. The code comment in `prepare_steps` gives the rewrites: a chain inside a chain is flattened, and a group followed by a task becomes a chord.

Sources: [celery/canvas.py:1048-1073](repo://celery/canvas.py#L1048-L1073), [celery/canvas.py:1120-1135](repo://celery/canvas.py#L1120-L1135)

For a chain of one step, `run` applies that step and returns its result object. For a longer chain it pops the last prepared step, builds the options with `_prepare_chain_from_options`, and applies that step with the rest of the chain attached as its callbacks, so each step starts the next one when it finishes.

Sources: [celery/canvas.py:1075-1093](repo://celery/canvas.py#L1075-L1093), [celery/canvas.py:877-892](repo://celery/canvas.py#L877-L892)

The `chain` name in the builtin tasks is registered only to refuse a direct call, with the message that chain is not a real task.

Sources: [celery/app/builtins.py:156-162](repo://celery/app/builtins.py#L156-L162)

## Groups

`group` stores its members in `__init__`, and `apply_async` is where they are sent. It refuses a link on the group itself, because a link belongs on a member or on a chord. The group id is frozen, the members are prepared with it, and the result set is created with a barrier that fires when every member is ready.

Sources: [celery/canvas.py:1580-1600](repo://celery/canvas.py#L1580-L1600), [celery/canvas.py:1616-1635](repo://celery/canvas.py#L1616-L1635)

The member loop is `_apply_tasks`, which sends each member with the group's partial arguments and options. After the send, `apply_async` returns a `GroupResult`, and a group with one chain whose last step is itself a group is returned as that inner group's result, so the caller sees the innermost set.

Sources: [celery/canvas.py:1633-1650](repo://celery/canvas.py#L1633-L1650)

If the caller is inside a worker task, the new result is added to that task's trail, so the group is among the children of its parent.

Sources: [celery/canvas.py:1647-1649](repo://celery/canvas.py#L1647-L1649)

When the app runs tasks eagerly, `apply` applies each member in the same process and returns a `GroupResult` built from those results.

Sources: [celery/canvas.py:1653-1662](repo://celery/canvas.py#L1653-L1662)

## Chunks and map

`chunks` splits an iterable into parts of size `n` and sends each part with `xstarmap`. Its `apply_async` builds a group from those parts, so a long input becomes a set of smaller calls. The part generator is evaluated when the group is built.

Sources: [celery/canvas.py:1437-1468](repo://celery/canvas.py#L1437-L1468)

`xmap` and `xstarmap` share the `_basemap` base. Each of them is a signature for the `map` or `starmap` builtin with the task and the iterable in its arguments, which applies the task to each item.

Sources: [celery/canvas.py:1385-1435](repo://celery/canvas.py#L1385-L1435)

`skew` spreads a group's members over time by setting a countdown on each member from a step range. The code notes that it may be used nowhere except its own tests.

Sources: [celery/canvas.py:1609-1614](repo://celery/canvas.py#L1609-L1614)
