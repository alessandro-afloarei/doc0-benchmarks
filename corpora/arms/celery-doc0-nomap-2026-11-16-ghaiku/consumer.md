---
title: "Consumer and Message Strategy"
---
## Overview

The consumer is the part of the worker that reads from the broker. It is a second blueprint, nested in the worker's `Consumer` step, and its steps connect to the broker, take messages, and keep the connection healthy. Each received message is handed to a strategy that belongs to its task, and the strategy either runs it now, schedules it for its ETA, or waits for a rate-limit token. This page covers that path up to the point where a `Request` is created. [[Task Requests in the Worker]] takes it from there.

Sources: [celery/worker/consumer/consumer.py:145-170](repo://celery/worker/consumer/consumer.py#L145-L170), [celery/worker/consumer/consumer.py:171-190](repo://celery/worker/consumer/consumer.py#L171-L190)

## Consumer steps

The consumer blueprint's default steps are, in list order, `Connection`, `Mingle`, `Events`, `Gossip`, `Heart`, `Control`, `Tasks`, `DelayedDelivery`, `Evloop` and `Agent`. As in the worker blueprint, the order that matters is the one given by each step's `requires`. `Tasks` requires `Mingle`, `Heart` requires `Events`, and `Gossip` requires `Mingle`.

Sources: [celery/worker/consumer/consumer.py:175-186](repo://celery/worker/consumer/consumer.py#L175-L186), [celery/worker/consumer/tasks.py:20-24](repo://celery/worker/consumer/tasks.py#L20-L24), [celery/worker/consumer/heart.py:10-20](repo://celery/worker/consumer/heart.py#L10-L20), [celery/worker/consumer/gossip.py:23-31](repo://celery/worker/consumer/gossip.py#L23-L31)

`Tasks` is the step that starts taking messages. Its `start` refreshes the strategies, records whether QoS is global, sets the initial prefetch count with `basic_qos` on the connection's default channel, and then creates the task consumer with the app's AMQP helper.

Sources: [celery/worker/consumer/tasks.py:29-47](repo://celery/worker/consumer/tasks.py#L29-L47)

`DelayedDelivery` requires `Tasks` and is enabled only when its `include_if` check passes. Its `start` sets up the delayed-delivery queues for the configured broker URLs.

Sources: [celery/worker/consumer/delayed_delivery.py:39-66](repo://celery/worker/consumer/delayed_delivery.py#L39-L66), [celery/worker/consumer/delayed_delivery.py:112-130](repo://celery/worker/consumer/delayed_delivery.py#L112-L130)

## Strategies per task

`update_strategies` builds one strategy for each registered task. For each task it calls `task.start_strategy(app, consumer)`, which for the default task is `celery.worker.strategy:default`, and it stores the result under the task name. It also rebuilds the task's tracer with `build_tracer`, so the tracer uses this worker's host name.

Sources: [celery/worker/consumer/consumer.py:716-721](repo://celery/worker/consumer/consumer.py#L716-L721), [celery/app/task.py:221-222](repo://celery/app/task.py#L221-L222)

The default strategy is built once, with the consumer's timer, rate-limit buckets, event dispatcher and the request class. It returns the function that runs for each message, and the function closes over those objects so it does not look them up per message.

Sources: [celery/worker/strategy.py:99-131](repo://celery/worker/strategy.py#L99-L131)

## The message handler

`create_task_handler` returns the callback the broker calls for every message. It reads the task name from the header in protocol 2 or from the payload in protocol 1. An unknown name goes to `on_unknown_task`, an unknown message shape goes to `on_unknown_message`, and a decode error goes to `on_decode_error`. The valid case looks up the strategy by name and calls it with the ack and reject promises.

Sources: [celery/worker/consumer/consumer.py:723-786](repo://celery/worker/consumer/consumer.py#L723-L786)

The ack and reject calls are scheduled with `call_soon_ack`. After a reconnect, a promise restores the prefetch count when the restart count is positive and the count has not been restored yet.

Sources: [celery/worker/consumer/consumer.py:754-773](repo://celery/worker/consumer/consumer.py#L754-L773), [celery/worker/consumer/consumer.py:264-266](repo://celery/worker/consumer/consumer.py#L264-L266)

## What the default strategy does with a message

The strategy turns the message into a `Request` through `Req` and then branches. A message with an ETA that has rate limiting goes to the timer with `call_at` and a bucket, a message with only an ETA goes to `apply_eta_task`, and a message subject to a rate limit goes to `limit_task`. Anything else is reserved and handed to `handle`, which is `on_task_request`.

Sources: [celery/worker/strategy.py:132-148](repo://celery/worker/strategy.py#L132-L148), [celery/worker/strategy.py:176-209](repo://celery/worker/strategy.py#L176-L209)

For the ETA case, `apply_eta_task` reserves the task with the state, calls `on_task_request` when the timer fires, and gives the prefetch slot back with `decrement_eventually`. The count was raised when the message was taken, so the slot is free again once the request is in the pool.

Sources: [celery/worker/consumer/consumer.py:659-663](repo://celery/worker/consumer/consumer.py#L659-L663)

A message held for a rate-limit bucket is added to the bucket with its tokens, and the bucket schedules it when a token is free. `_limit_post_eta` does the same for a message that also has an ETA.

Sources: [celery/worker/consumer/consumer.py:357-364](repo://celery/worker/consumer/consumer.py#L357-L364), [celery/worker/consumer/consumer.py:329-331](repo://celery/worker/consumer/consumer.py#L329-L331)

## Prefetch

`initial_prefetch_count` is set by `basic_qos` at start. Later changes come from `_update_prefetch_count`, which the pool calls when it grows or shrinks, so the number of messages held by the worker follows the number of processes.

Sources: [celery/worker/consumer/tasks.py:40-42](repo://celery/worker/consumer/tasks.py#L40-L42), [celery/worker/consumer/consumer.py:305-323](repo://celery/worker/consumer/consumer.py#L305-L323)

## Reconnects

`Consumer.start` loops over the blueprint while it is not in a stop state. A connection error before the first connection and one after it go to different handlers, and after a connection loss the blueprint is restarted.

Sources: [celery/worker/consumer/consumer.py:366-407](repo://celery/worker/consumer/consumer.py#L366-L407), [celery/worker/consumer/consumer.py:409-432](repo://celery/worker/consumer/consumer.py#L409-L432)
