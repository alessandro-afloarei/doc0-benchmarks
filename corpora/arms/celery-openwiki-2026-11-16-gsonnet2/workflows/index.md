# Files

- [Task Execution, Tracing, Retry and States](task-execution-and-tracing.md) - What happens when a pool process runs a task. Covers the tracer (build_tracer and trace_task), task states and their precedence, success, failure, retry, ignore and reject paths, auto-retry and Task.retry, Task.replace, time limits, acknowledgement interplay, signals and the Task hook methods.
- [Task Publishing: apply_async to Broker](task-publishing.md) - How a task call becomes a broker message. Covers Task.delay/apply_async, option merging, Celery.send_task, routing to queues, countdown/eta/expires handling (including quorum-queue native delayed delivery), protocol-2 message construction, producer pools and publish signals, parent/child tracking, and eager mode.
