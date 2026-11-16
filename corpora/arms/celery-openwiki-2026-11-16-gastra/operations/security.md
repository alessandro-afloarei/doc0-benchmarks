---
type: operations
title: Serialization and trust boundaries
description: Task and result content policies, signed message setup, broker and backend trust, and worker privilege checks in this checkout.
tags: [security, serialization, authentication, configuration]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:10:58.334Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-0f8d26932b6272605a1f8531
    resource: repo://celery/platforms.py
  - id: openwiki-source-c0292f440e0f00e60a1ef94d
    resource: repo://celery/security/__init__.py
  - id: openwiki-source-59df33ccfa1705c7a20dcc7b
    resource: repo://celery/security/serialization.py
  - id: openwiki-source-fbbf6a2cbf7712dfaaf5718b
    resource: repo://docs/userguide/security.rst
generated: { by: "codex", at: "2026-11-16T08:10:58.334Z" }
---

# Serialization and trust boundaries

Celery workers execute code selected by incoming task names. Broker access, trusted publishers, accepted serialization formats, result-backend access, and worker operating-system permissions are separate boundaries. Message signing addresses one part of this system; it does not replace those other controls.

## Task and result serialization

This checkout defaults `task_serializer` and `result_serializer` to JSON and `accept_content` to JSON only. The AMQP task consumer uses the configured accepted-content policy. Broadening it allows additional deserializers to process incoming messages; the repository's [security guide](../../docs/userguide/security.rst) specifically identifies pickle as unsafe with untrusted senders.

Backend acceptance has its own precedence: an explicit backend `accept` argument, then `result_accept_content`, then `accept_content`. Task and result formats can therefore differ intentionally.

```python
app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    result_accept_content=["json"],
)
```

If task messages use authentication but results remain JSON, set the result acceptance policy explicitly. Do not assume signing task publication signs backend writes.

The result backend also validates reconstructed exception types: a decoded exception descriptor must resolve to a class derived from `BaseException`, otherwise it raises `SecurityError`. This check guards exception reconstruction; it does not make an attacker-controlled backend trustworthy.

## Signed task messages

`app.setup_security()` delegates to the security module and changes the process-wide Kombu serializer registry. The implementation requires:

- `task_serializer='auth'` and exactly `accept_content=['auth']`.
- A private key, certificate, and certificate-store path through the security configuration or method arguments.
- The cryptography dependency.

Setup disables untrusted serializers, registers `auth`, and makes it the default serializer. Configure all producers and consumers consistently before sending authenticated tasks. Because the serializer registry is global, setup affects other Celery application instances in the same process.

`SecureSerializer` serializes the payload with its inner serializer, signs the serialized body, and packs the signer, signature, content information, and body. Deserialization verifies the body signature against the certificate store before decoding it. The `auth` format does not encrypt content. The repository documents `broker_use_ssl` for supported broker connections; backend connection security is configured separately by backend.

## Worker privileges and authorization scope

`check_privileges()` inspects user and group identity where the platform supports it. Root or privileged-group execution triggers a security warning, and accepting pickle under those conditions raises `SecurityError` unless `C_FORCE_ROOT` bypasses the refusal. That override suppresses a protection; it does not change what a task can access.

Run workers with the permissions needed for their task code and restrict access to broker and backend services. A valid message signature authenticates the signing identity; this implementation does not provide a per-task authorization policy mapping certificates to allowed task names. Exposing a task in the registry therefore needs to be considered alongside who can publish to its queues.

## Verification and neighboring contracts

[Security setup tests](../../t/unit/security/test_security.py) check configuration validation and registry effects; [serialization tests](../../t/unit/security/test_serialization.py) cover the signed format; [platform tests](../../t/unit/utils/test_platforms.py) exercise privilege checks. Backend exception validation is in [backends/base.py](../../celery/backends/base.py).

Read [task delivery](../workflows/task-delivery.md) for protocol and routing, [result backends](../integrations/result-backends.md) for storage and result decoding, and [worker operations](workers.md) for the control/monitoring paths.
