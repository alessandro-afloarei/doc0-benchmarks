---
title: "Signatures and Canvas Primitives"
---
## Overview

A signature describes one task call (the task name, arguments and execution options) without making it. Because a signature is a plain `dict`, it can be stored, sent inside another task's message, and called later. Celery's workflow primitives (`chain`, `group`, `chord`, `chunks`, `xmap`, `xstarmap`) are signatures too, whose arguments are other signatures, so workflows nest and serialize the same way as single tasks. This page covers how signatures are built, combined and serialized; how each primitive runs and how chords wait for their header is on [[Chains, Groups and Chords at Runtime]], and attaching headers to a whole workflow is on [[Canvas Stamping]].

Sources: [celery/canvas.py:233-295](repo://celery/canvas.py#L233-L295)

## Creating signatures

`Signature(task, args, kwargs, options, immutable=False, app=None, **ex)` stores five keys: `task` (the name; a task class or instance is reduced to its `name` and kept in `_type`), `args` as a tuple, `kwargs`, `options` (extra keyword arguments are merged into it), `subtask_type` and `immutable`. A dict passed as `task` is used as the whole content, which is how a signature is rebuilt from a message.

Sources: [celery/canvas.py:323-345](repo://celery/canvas.py#L323-L345)

Tasks provide shortcuts: `task.s(*args, **kwargs)`, `task.si(...)` for an immutable signature, `task.signature(args, kwargs, **options)`, and `task.map(it)`, `task.starmap(it)`, `task.chunks(it, n)` for the batch primitives. `celery.signature(x)` clones a signature, rebuilds one from a dict, or creates one from a task name.

Sources: [celery/app/task.py:962-1001](repo://celery/app/task.py#L962-L1001), [celery/canvas.py:2395-2412](repo://celery/canvas.py#L2395-L2412)

```python
from celery import signature

add.s(2, 2)                                  # add(2, 2)
add.si(2, 2)                                 # ignores parent results
add.s(2).set(countdown=10, queue='math')     # partial with options
signature('tasks.add', args=(2, 2), options={'priority': 5})
```

Sources: [celery/canvas.py:539-552](repo://celery/canvas.py#L539-L552), [celery/canvas.py:2395-2412](repo://celery/canvas.py#L2395-L2412)

The task type is resolved lazily: `sig.type` looks the name up in the app's registry on first use, and `sig.app` falls back to `current_app`. When the name is not registered locally, `apply_async` falls back to `app.send_task` with the name, so signatures for tasks defined in other code bases still work.

Sources: [celery/canvas.py:843-874](repo://celery/canvas.py#L843-L874)

## Partial arguments and immutability

Signatures are partials. Calling `sig.delay(*args, **kwargs)`, `sig.apply_async(args, kwargs, **options)` or `sig.clone(args, kwargs, **options)` merges with `_merge`: new positional arguments are prepended to the stored ones, new keyword arguments update a copy of the stored ones, and options are merged with the new values winning. This is how a callback receives its parent's result as its first argument.

Sources: [celery/canvas.py:347-443](repo://celery/canvas.py#L347-L443)

An immutable signature (`si`, or `set(immutable=True)`) ignores new arguments and only merges options, so a callback can run with fixed arguments regardless of what its parent returned. Some options can never be overwritten by a merge: `group_id`, `stamped_headers`, and the stamp keys listed in `stamped_headers`, because changing them would detach a task from the group or workflow it belongs to.

Sources: [celery/canvas.py:285-289](repo://celery/canvas.py#L285-L289), [celery/canvas.py:403-443](repo://celery/canvas.py#L403-L443)

`clone` returns a new signature with deep-copied options, `replace(args, kwargs, options)` returns a clone with sections swapped, and `set(**options)` updates the options in place and returns the same signature for chaining.

Sources: [celery/canvas.py:445-552](repo://celery/canvas.py#L445-L552)

## Running a signature

### Calling forms

| Call | Effect |
| --- | --- |
| `sig()` | Calls the task function in the current process |
| `sig.delay(*a, **kw)` | `apply_async` with partial arguments |
| `sig.apply_async(args, kwargs, **opts)` | Merges, then calls `Task.apply_async` (or `send_task`) |
| `sig.apply(args, kwargs, **opts)` | Runs the task locally through `Task.apply` |
| `~sig` | `apply_async().get()` |

Sources: [celery/canvas.py:347-401](repo://celery/canvas.py#L347-L401), [celery/canvas.py:820-821](repo://celery/canvas.py#L820-L821)

Options set to `None` are dropped before merging, so passing `countdown=None` does not erase a stored countdown. [[Calling Tasks and the Message Protocol]] describes what `apply_async` does next.

Sources: [celery/canvas.py:384-401](repo://celery/canvas.py#L384-L401)

### Freezing

`freeze(_id, group_id, chord, root_id, parent_id, group_index)` gives a signature its task id before it is sent and returns the `AsyncResult` for that id. An id already in the options is kept; otherwise `_id` or a new UUID is used. It also fills `reply_to` with the app's thread id and sets the group, chord and parent fields when given. Canvas primitives freeze their children first, so the caller holds a complete result tree (`GroupResult`, chained `parent` results) before any task runs. A frozen signature must not be sent twice, since both messages would share one id.

Sources: [celery/canvas.py:473-522](repo://celery/canvas.py#L473-L522)

## Callbacks and errbacks

`sig.link(callback)` appends to `options['link']` and `sig.link_error(errback)` to `options['link_error']`; both skip duplicates and return the argument. `on_error(errback)` does the same but returns the original signature, so `add.s(2, 2).on_error(log_error.s()).delay()` sends `add`. On success the worker sends each link with the return value prepended; on failure it calls each errback ([[Task Tracing and Execution]]).

Sources: [celery/canvas.py:685-746](repo://celery/canvas.py#L685-L746)

An errback task that accepts three arguments is called as `errback(request, exc, traceback)` in the worker that saw the failure; one that accepts a single argument is sent as a task with the failed task's id.

Sources: [celery/backends/base.py:253-300](repo://celery/backends/base.py#L253-L300)

## The primitives

| Primitive | Built by | Runs | Result |
| --- | --- | --- | --- |
| `chain(a, b, c)` or `a \| b \| c` | `celery.chain` | Each task after the previous one, receiving its return value | `AsyncResult` of the last task; `.parent` walks back |
| `group(a, b, c)` | `celery.group` | All tasks in parallel | `GroupResult` with the results in order |
| `chord(header, body)` | `celery.chord` | The header group, then the body with the list of header results | `AsyncResult` of the body |
| `task.chunks(it, n)` | `celery.chunks` | A group of `starmap` tasks, each over `n` items | `GroupResult` |
| `task.map(it)` | `celery.map` | One task that calls `task(x)` for each item, in sequence | List of results |
| `task.starmap(it)` | `celery.starmap` | One task that calls `task(*x)` for each item | List of results |

Sources: [celery/canvas.py:1322-1384](repo://celery/canvas.py#L1322-L1384), [celery/canvas.py:1385-1475](repo://celery/canvas.py#L1385-L1475), [celery/canvas.py:1491-1600](repo://celery/canvas.py#L1491-L1600), [celery/canvas.py:1970-2075](repo://celery/canvas.py#L1970-L2075)

`chain(*tasks)` accepts signatures or a single iterable, including a generator, and builds the chain by reducing with `|`, so `chain(x, y, z)` and `x | y | z` give the same structure. Calling a chain with arguments passes them to the first task.

Sources: [celery/canvas.py:1322-1383](repo://celery/canvas.py#L1322-L1383)

`group(*tasks)` accepts signatures or an iterable; a generator is wrapped in `regen` so it is evaluated once and can be iterated again. A group of a single signature clones it. `xmap`, `xstarmap` and `chunks` are immutable and store the task signature and the iterable in their kwargs; `map` and `starmap` run all items in a single task in one worker, which suits many tiny calls, while `chunks` splits the items into a group so batches run in parallel.

Sources: [celery/canvas.py:1385-1473](repo://celery/canvas.py#L1385-L1473), [celery/canvas.py:1580-1596](repo://celery/canvas.py#L1580-L1596)

`chord(header, body)` stores the header as a group and the body as a signature. Writing `chord(header)(body)` supplies the body at call time.

Sources: [celery/canvas.py:2059-2075](repo://celery/canvas.py#L2059-L2075), [celery/canvas.py:2386-2392](repo://celery/canvas.py#L2386-L2392)

```python
from celery import chain, chord, group

res = chain(fetch.s(url), parse.s(), store.s())()
res = group(resize.s(img, size) for size in (64, 128, 256))()
res = chord((fetch.s(u) for u in urls), merge.s())()
res = add.chunks(zip(range(100), range(100)), 10)()
```

Sources: [celery/canvas.py:1322-1371](repo://celery/canvas.py#L1322-L1371), [celery/canvas.py:1436-1473](repo://celery/canvas.py#L1436-L1473)

## Composition with |

The `|` operator normalizes combinations so that the result is the simplest structure that runs correctly. A group with one task is unrolled into that task first.

Sources: [celery/canvas.py:43-58](repo://celery/canvas.py#L43-L58)

| Left | Right | Result |
| --- | --- | --- |
| task | task or chord | `chain(left, right)` |
| task | chain | one chain with the task in front |
| task | group | `chain(task, group)` |
| group | anything but an empty group | `chord(group, body=right)` |
| chain ending in a group | task | the last group becomes a chord with the task as body |
| chain ending in a chord | task | the task is added to the chord's body |
| chain | chain | the chains are concatenated |
| chord | task, or group of one | the task is added to the body |

Sources: [celery/canvas.py:759-786](repo://celery/canvas.py#L759-L786), [celery/canvas.py:960-1020](repo://celery/canvas.py#L960-L1020), [celery/canvas.py:1598-1607](repo://celery/canvas.py#L1598-L1607), [celery/canvas.py:2077-2092](repo://celery/canvas.py#L2077-L2092)

The group-followed-by-task rule is the one to remember: `group(a, b) | c` is a chord, so `c` receives the list of results and waits for both. That needs a result backend that supports chords. `unchain_tasks` clones a chain's tasks for these operations, moving the chain's own links to its last task and its errbacks to every task, so error handling survives the rewrite.

Sources: [celery/canvas.py:1022-1045](repo://celery/canvas.py#L1022-L1045)

## Serialization

A signature pickles and serializes to JSON as its dict content; the task type is never stored. `__reduce__` rebuilds through `signature(dict)`, and `__json__` returns the dict. On the receiving side, `Signature.from_dict` reads `subtask_type` and dispatches to the subclass registered under that name with `@Signature.register_type()` (`chain`, `group`, `chord`, `chunks`, `xmap`, `xstarmap`), whose own `from_dict` turns nested dicts back into signatures.

Sources: [celery/canvas.py:296-321](repo://celery/canvas.py#L296-L321), [celery/canvas.py:823-829](repo://celery/canvas.py#L823-L829), [celery/canvas.py:938-945](repo://celery/canvas.py#L938-L945)

`maybe_signature(d, app, clone=False)` is the helper used wherever a value may be a signature or its dict form (callbacks, chain steps, chord bodies): it returns `None` unchanged, converts a dict, optionally clones an existing signature, and binds it to the app.

Sources: [celery/canvas.py:2415-2442](repo://celery/canvas.py#L2415-L2442)
