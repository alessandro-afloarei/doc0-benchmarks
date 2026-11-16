---
title: "Message Format and Serialization"
---
## Overview

A task call is sent as one broker message with two parts: a body that carries the arguments and the callback links, and headers that carry the task name, the id, the retry count and the timing fields. This page describes the two message layouts the sender can produce, how the worker reads either one, and how the body is serialized. The send path that calls the builders is in [[Sending a Task Message]], and the signing of the serialized body is in [[Message Security]].

Sources: [celery/app/amqp.py:32-33](repo://celery/app/amqp.py#L32-L33), [celery/app/amqp.py:326-418](repo://celery/app/amqp.py#L326-L418)

## Two protocols

`AMQP` keeps a table from protocol number to builder: `1` maps to `as_task_v1` and `2` maps to `as_task_v2`. `create_task_message` picks the builder from the `task_protocol` setting, which defaults to `2`.

Sources: [celery/app/amqp.py:259-262](repo://celery/app/amqp.py#L259-L262), [celery/app/amqp.py:266-267](repo://celery/app/amqp.py#L266-L267), [celery/app/defaults.py:294-295](repo://celery/app/defaults.py#L294-L295)

```python
self.task_protocols = {
    1: self.as_task_v1,
    2: self.as_task_v2,
}
```

Sources: [celery/app/amqp.py:259-262](repo://celery/app/amqp.py#L259-L262), [celery/app/amqp.py:266-267](repo://celery/app/amqp.py#L266-L267), [celery/app/defaults.py:294-295](repo://celery/app/defaults.py#L294-L295)

The protocol 1 builder returns a single dictionary as the body. Every field, including `task`, `id`, `args`, `kwargs`, `callbacks` and `timelimit`, sits at the top level of that dictionary, and the headers are empty.

Sources: [celery/app/amqp.py:420-478](repo://celery/app/amqp.py#L420-L478)

## The protocol 2 layout

The protocol 2 builder puts the routing and tracking fields in the headers: `task`, `id`, `eta`, `expires`, `group`, `retries`, `timelimit`, `root_id`, `parent_id`, `origin` and the stamped headers. The language is `py`, and the argument representations are cut at `argsrepr_maxsize`, which is 1024 characters.

Sources: [celery/app/amqp.py:371-391](repo://celery/app/amqp.py#L371-L391), [celery/app/amqp.py:252-255](repo://celery/app/amqp.py#L252-L255)

The body is a three-item tuple, `(args, kwargs, extras)`. The extras are the callbacks, error callbacks, chain and chord. The correlation id is the task id, and `reply_to` is set when the caller gives one.

Sources: [celery/app/amqp.py:393-406](repo://celery/app/amqp.py#L393-L406)

The `eta` and `expires` values are written as ISO 8601 strings, and an `expires` given as a number of seconds is first turned into an absolute time.

Sources: [celery/app/amqp.py:350-360](repo://celery/app/amqp.py#L350-L360)

## Reading a message in the worker

The worker's strategy looks at the payload before it builds a request. A payload with an `args` key is a protocol 2 message and goes through `hybrid_to_proto2`. Anything else is a protocol 1 message and goes through `proto1_to_proto2`. The task message handler then receives the converted body and headers.

Sources: [celery/worker/strategy.py:132-146](repo://celery/worker/strategy.py#L132-L146)

`hybrid_to_proto2` takes the arguments from the body, rejects a message without them or with non-mapping keyword arguments, and copies the header fields from the body into a headers dictionary. The message's own headers are merged over those, so a header set by the sender wins. The embedded callbacks, error callbacks, chord and chain are returned as the extras, and the chain is always `None` in this path.

Sources: [celery/worker/strategy.py:25-63](repo://celery/worker/strategy.py#L25-L63)

```python
headers = {
    'lang': body.get('lang'),
    'task': body.get('task'),
    'id': body.get('id'),
    'root_id': body.get('root_id'),
    'parent_id': body.get('parent_id'),
    'retries': body.get('retries', 0),
    'timelimit': body.get('timelimit', (None, None)),
}
headers.update(message.headers or {})
```

Sources: [celery/worker/strategy.py:25-63](repo://celery/worker/strategy.py#L25-L63)

`proto1_to_proto2` does the same job for the dictionary body. It adds `argsrepr` and `kwargsrepr` computed with `saferepr`, uses the message's headers as the headers, and maps the protocol 1 `taskset` field to `group`.

Sources: [celery/worker/strategy.py:65-96](repo://celery/worker/strategy.py#L65-L96)

## Serializers and content types

The body is encoded with the serializer named by the task's `serializer` option, which defaults to `json`. The publish step passes the serializer and the compression setting to the producer, so the content type of the message follows the serializer.

Sources: [celery/app/defaults.py:312-315](repo://celery/app/defaults.py#L312-L315), [celery/app/amqp.py:565-571](repo://celery/app/amqp.py#L565-L571)

The worker accepts only the content types in `accept_content`, which defaults to `json`. `TaskConsumer` passes that list to the kombu consumer, so a message with another content type is not decoded, unless the setting is changed.

Sources: [celery/app/defaults.py:13](repo://celery/app/defaults.py#L13), [celery/app/defaults.py:66-67](repo://celery/app/defaults.py#L66-L67), [celery/app/amqp.py:317-322](repo://celery/app/amqp.py#L317-L322)

Message compression is set by the `task_compression` setting. It is applied in the same publish call as the serializer, and it is empty by default.

Sources: [celery/app/defaults.py:276-277](repo://celery/app/defaults.py#L276-L277), [celery/app/amqp.py:504-505](repo://celery/app/amqp.py#L504-L505)
