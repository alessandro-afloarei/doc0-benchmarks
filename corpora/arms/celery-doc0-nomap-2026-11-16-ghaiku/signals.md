---
title: "Signals"
---
## Overview

A signal is a named point in the lifecycle where the package calls every function a program has registered for it. `celery/signals.py` declares the signals, the dispatcher in `celery/utils/dispatch/signal.py` runs the receivers, and the code at each point sends the signal with the values the receivers need. Signals are the way to observe or extend behaviour without subclassing the classes that do the work. The events that are published to the broker are a separate mechanism, described in [[Events]].

Sources: [celery/signals.py:31-46](repo://celery/signals.py#L31-L46), [celery/utils/dispatch/signal.py:73-104](repo://celery/utils/dispatch/signal.py#L73-L104)

## The declared signals

The task signals are declared first: `before_task_publish` and `after_task_publish` on the sending side, then `task_received`, `task_prerun`, `task_postrun`, `task_success`, `task_retry`, `task_failure`, `task_internal_error`, `task_revoked`, `task_rejected`, `task_unknown` and `task_sent`. Each declaration gives the signal a name and the names of the arguments it provides.

Sources: [celery/signals.py:31-96](repo://celery/signals.py#L31-L96)

The worker, beat and setup signals follow: `celeryd_init`, `import_modules`, `worker_init`, `worker_process_init`, `worker_ready`, `worker_shutdown`, `heartbeat_sent`, `beat_init` and `beat_embedded_init`, along with the logging setup signals and the eventlet pool signals.

Sources: [celery/signals.py:97-152](repo://celery/signals.py#L97-L152)

## Where a signal is sent

The tracer keeps the send functions for `task_prerun` and `task_postrun` as module-level names, so the tracer calls them directly on each run. The check for receivers happens before the call, as [[Task Execution Tracing]] describes.

Sources: [celery/app/trace.py:104-105](repo://celery/app/trace.py#L104-L105), [celery/app/trace.py:568-572](repo://celery/app/trace.py#L568-L572)

The strategy sends `task_received` after it has built the request and checked for expiry and revocation, and before any ETA or rate-limit decision. The request module keeps `task_revoked` as a module-level send function in the same way.

Sources: [celery/worker/strategy.py:160-166](repo://celery/worker/strategy.py#L160-L166), [celery/worker/request.py:58](repo://celery/worker/request.py#L58)

`before_task_publish` is sent from the publish helper in the AMQP module, with the exchange, routing key and headers, and `after_task_publish` follows the publish.

Sources: [celery/app/amqp.py:485-500](repo://celery/app/amqp.py#L485-L500), [celery/app/amqp.py:557-566](repo://celery/app/amqp.py#L557-L566)

`worker_ready` is sent from the worker application once the consumer is ready, and `beat_init` is sent from the beat service before its loop starts.

Sources: [celery/apps/worker.py:181](repo://celery/apps/worker.py#L181), [celery/beat.py:633-641](repo://celery/beat.py#L633-L641)

## Connecting a receiver

`Signal.connect` takes a function and an optional sender. It stores the receiver with a weak reference by default, so a receiver that goes out of scope is dropped. A receiver connected with a sender runs only for sends with that sender. Bound methods are kept with a weak method reference.

Sources: [celery/utils/dispatch/signal.py:110-146](repo://celery/utils/dispatch/signal.py#L110-L146)

Sources: [celery/utils/dispatch/signal.py:110-146](repo://celery/utils/dispatch/signal.py#L110-L146), [celery/utils/dispatch/signal.py:32-40](repo://celery/utils/dispatch/signal.py#L32-L40)

`Signal.send` calls each live receiver with the signal, the sender and the named values, and returns a list of pairs with each receiver's response. A receiver that raises does not stop the others: the exception is logged, and it is returned in the pair. `send_robust` is the same method under another name.

Sources: [celery/utils/dispatch/signal.py:258-289](repo://celery/utils/dispatch/signal.py#L258-L289)

```python
        for receiver in self._live_receivers(sender):
            try:
                response = receiver(signal=self, sender=sender, **named)
            except Exception as exc:  # pylint: disable=broad-except
                if not hasattr(exc, '__traceback__'):
                    exc.__traceback__ = sys.exc_info()[2]
                logger.exception(
                    'Signal handler %r raised: %r', receiver, exc)
                responses.append((receiver, exc))
            else:
                responses.append((receiver, response))
        return responses
```

Sources: [celery/utils/dispatch/signal.py:258-290](repo://celery/utils/dispatch/signal.py#L258-L290)

`_live_receivers` filters the connected receivers for the sender and resolves the weak references, returning only those still alive. `disconnect` removes a receiver, and `has_listeners` answers whether any receiver is connected for a sender.

Sources: [celery/utils/dispatch/signal.py:303-318](repo://celery/utils/dispatch/signal.py#L303-L318), [celery/utils/dispatch/signal.py:218-257](repo://celery/utils/dispatch/signal.py#L218-L257)
