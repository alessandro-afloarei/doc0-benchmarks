---
type: operations
title: Serialization and message trust
description: Task and result content allowlists, auth serializer signing and certificate checks, broker TLS configuration and the limits of argument redaction.
tags: [security, serialization, certificates, messaging]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:34:04.042Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-c0292f440e0f00e60a1ef94d
    resource: repo://celery/security/__init__.py
  - id: openwiki-source-5e4aaa0fe9e4042b9efeba88
    resource: repo://celery/security/certificate.py
  - id: openwiki-source-59df33ccfa1705c7a20dcc7b
    resource: repo://celery/security/serialization.py
generated: { by: "codex", at: "2026-11-16T06:34:04.042Z" }
---

# Serialization and message trust

Celery's task protocol passes serialized data across a broker boundary. Task content acceptance, result content acceptance, message signing and transport configuration are separate controls with separate code paths.

## Restrict decoding at each boundary

The default task serializer and accepted content are JSON. `AMQP.TaskConsumer()` supplies `accept_content` to Kombu. A result backend uses `result_accept_content` when configured, falling back to `accept_content`; result serialization is selected through `result_serializer`.

Keep producer encoders and consumer allowlists compatible. Enabling an additional serializer changes what receivers can decode; changing only `task_serializer` does not automatically authorize it everywhere. Result readers may require a different allowlist from workers, especially when task messages use signing but results use JSON.

## Register signed task serialization

The `auth` extra provides the cryptography dependency. A signing setup supplies paths for `security_key`, `security_certificate` and `security_cert_store`, plus optional key password and digest configuration:

```python
app.conf.update(
    task_serializer='auth',
    accept_content=['auth'],
    result_serializer='json',
    result_accept_content=['json'],
    security_key='/run/celery/private.key',
    security_certificate='/run/celery/producer.pem',
    security_cert_store='/run/celery/trusted/*.pem',
)
app.setup_security()
```

These paths are deployment inputs, not files supplied by this repository. `setup_security()` disables untrusted serializers, requires exactly the auth task serializer and allowlist, checks required paths, registers auth with Kombu and makes it the default serializer. Its registry changes affect all application instances in the process, so account for this in tests hosting multiple apps.

`SecureSerializer` encodes the body using its inner serializer, signs those serialized bytes and packs signer identity, signature, content metadata and body. On receipt it looks up the signer in the configured certificate store, verifies the body signature, then decodes the inner content. This is body signing, not encryption: the packed body is base64-encoded and remains recoverable. Protocol headers and broker routing are handled outside that body serializer.

Certificates are loaded as PEM and must contain RSA public keys. Verification uses RSA-PSS. The filesystem store rejects expired certificates at load time; lookups reject unknown signer IDs and duplicate IDs are rejected when added. Expiration checking shown here happens when constructing the store, so do not infer continuous certificate revalidation from this implementation.

## Transport and observability boundaries

Application connection construction forwards `broker_use_ssl` to Kombu, alongside transport options and credentials. TLS details depend on the selected transport and should be configured at that boundary. Body signing does not replace broker access controls or transport confidentiality.

Protocol v2 places `argsrepr` and `kwargsrepr` in headers and uses them for sent events. Custom representations can reduce exposure in logs and monitoring, but the actual task arguments remain in the message body. Treat representation overrides as display controls, not data removal.

For failures, first distinguish content rejection, missing crypto/configuration, certificate loading, signature verification and connection setup. The [publishing guide](../workflows/publishing.md) traces how messages are constructed; [result contracts](../integrations/result-backends.md) covers result decoding.

## Focused verification

Use `t/unit/security/test_security.py`, `test_serialization.py` and `test_certificate.py` for configuration validation, signed round trips, tampering, missing certificates and expiry. Serialization and protocol changes also belong in `t/unit/app/test_amqp.py`. No application-specific authorization or secret-management service is implemented by the auth serializer.
