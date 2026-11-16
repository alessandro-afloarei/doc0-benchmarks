# Files

- [Canvas: Signatures, Chains, Groups and Chords](canvas.md) - How Celery composes workflows from serializable task signatures — Signature merging, cloning and freezing; chain unrolling and upgrades to chords; group publishing; chord execution via backend counters or the polling chord_unlock task; error propagation; and stamping.
- [Tasks: Definition, Invocation, Retry](tasks.md) - The Task class and how tasks are bound to an app and configuration, invoked with delay/apply_async/apply, given request context, retried manually or automatically with backoff, replaced by other signatures, annotated from configuration, and controlled by acknowledgement and rejection semantics.
