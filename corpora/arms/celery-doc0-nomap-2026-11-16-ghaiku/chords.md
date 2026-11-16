---
title: "Chords"
---
## Overview

A chord runs a header group and then a body task once every member of the header has finished. The body receives the list of header results. Two parts make this work: the `_chord` signature in `celery/canvas.py`, which starts the header and records the body, and the completion step, which is either the backend's own counter or the `celery.chord_unlock` task. Group results and the join they use are described in [[AsyncResult and Result Sets]]; the storage the counter lives in is in [[Result Backend Contract]].

Sources: [celery/canvas.py:1971-1998](repo://celery/canvas.py#L1971-L1998), [celery/app/builtins.py:37-45](repo://celery/app/builtins.py#L37-L45)

## Starting a chord

`_chord.__init__` takes the header and the body, and names the `celery.chord` task. Calling a chord with a body passes that body to `apply_async`.

Sources: [celery/canvas.py:2059-2076](repo://celery/canvas.py#L2059-L2076)

`apply_async` on a chord hands its header and body to `run`. The `apply` path runs the chord in the same process when the app is eager.

Sources: [celery/canvas.py:2153-2178](repo://celery/canvas.py#L2153-L2178)

`run` chooses a group id for the header and freezes the body with that id, so every header result carries the group id that the body is waiting on. Options that must not reach the header, `chain` and `chord`, are removed before the header is sent, so that deeply nested chords do not carry their parents into the members.

Sources: [celery/canvas.py:2226-2265](repo://celery/canvas.py#L2226-L2265)

Before the header is sent, `run` calls `apply_chord` on the backend with the header results and the body. The order matters: the backend knows the chord before any member can finish. A header with no members is the exception: `run` then calls the body directly with an empty list, because no member would ever trigger it.

Sources: [celery/canvas.py:2267-2284](repo://celery/canvas.py#L2267-L2284)

The body's result is returned with the header group's result as its parent, so a caller that waits on the body can reach the header results through `parent`.

Sources: [celery/canvas.py:2285-2286](repo://celery/canvas.py#L2285-L2286)

## Counting in the backend

The key-value backends count completions in `on_chord_part_return`. Each finished member increments a counter under the chord key. The member whose increment makes the count equal to the chord size sends the body.

Sources: [celery/backends/base.py:1188-1215](repo://celery/backends/base.py#L1188-L1215)

The chord size comes from the request's `chord_size` when it is set. Otherwise the size is the number of members the stored group result can see. A count below the size only refreshes the expiry of the chord key, and a count above the size logs a warning.

Sources: [celery/backends/base.py:1216-1223](repo://celery/backends/base.py#L1216-L1223)

When the count equals the size, the backend loads the group result and joins it with the configured join timeout. A failed join is turned into a chord error with its cause, and the error is passed to the body's callback through `chord_error_from_stack`. Otherwise the joined value is sent to the body. In a `finally` block the group result and the chord key are deleted.

Sources: [celery/backends/base.py:1224-1256](repo://celery/backends/base.py#L1224-L1256)

## The unlock task

A backend without native chord support uses `celery.chord_unlock` instead. That task polls the header group until it is ready, and it retries itself with the `interval` countdown until then. This is the path `fallback_chord_unlock` takes.

Sources: [celery/app/builtins.py:37-70](repo://celery/app/builtins.py#L37-L70), [celery/backends/base.py:838-867](repo://celery/backends/base.py#L838-L867)

When the group is ready, the task joins the header results with the configured join timeout and propagates a failure. A join failure is reported with the first failed dependency's id, and the body receives the chord error instead of a value.

Sources: [celery/app/builtins.py:72-90](repo://celery/app/builtins.py#L72-L90)

The body is then applied with the joined values as its argument. A failure in the body is turned into a callback error, and it is reported through `chord_error_from_stack`.

Sources: [celery/app/builtins.py:91-98](repo://celery/app/builtins.py#L91-L98)

## Failure behaviour

A failed join or a failed body callback is not sent to the body as a value. Both paths build a chord error with `_create_chord_error_with_cause` and pass it to `chord_error_from_stack`, which hands it to the body's callback.

Sources: [celery/backends/base.py:1232-1251](repo://celery/backends/base.py#L1232-L1251), [celery/backends/base.py:325-360](repo://celery/backends/base.py#L325-L360)
