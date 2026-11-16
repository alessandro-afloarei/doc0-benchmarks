---
type: security
title: Serialization, trust, and signed messages
description: Serializer acceptance, task-body signing and certificate trust, result exception reconstruction, and the boundaries these mechanisms protect.
tags: [security, serialization, signing, certificates, trust]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:38:41.370Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-c0292f440e0f00e60a1ef94d
    resource: repo://celery/security/__init__.py
  - id: openwiki-source-5e4aaa0fe9e4042b9efeba88
    resource: repo://celery/security/certificate.py
  - id: openwiki-source-59df33ccfa1705c7a20dcc7b
    resource: repo://celery/security/serialization.py
  - id: openwiki-source-fbbf6a2cbf7712dfaaf5718b
    resource: repo://docs/userguide/security.rst
generated: { by: "codex", at: "2026-11-16T16:38:41.370Z" }
---

# Serialization, trust, and signed messages

The relevant boundaries are task publishers to broker consumers, workers to result readers, and operators to the remote-control mailbox. Serializer acceptance constrains decoding; signing authenticates a serialized body; broker access controls who can send or observe messages. These mechanisms have different responsibilities.

## Accepted content and result decoding

Task serialization defaults to JSON in `celery/app/defaults.py`. The application's `AMQP.TaskConsumer()` supplies `accept_content` to Kombu. A producer choosing a serializer does not make consumers accept it: the receiving allowlist must agree. Unknown or disallowed content reaches the consumer's invalid/decode handling rather than ordinary task execution.

Result decoding has its own setting. The backend chooses an explicit constructor `accept` value first, then `result_accept_content`, then `accept_content`. This matters when task messages use `auth` but backend values remain JSON: configure result acceptance for the actual backend encoding. Task, event, and result serializers are independently configurable.

The repository's security guide explains why accepting pickle expands the trust placed in message senders. JSON still allows callers to request registered task execution; it does not authorize particular arguments or provide tenant isolation. Treat broker publication access as access to the task surface exposed by its workers.

## Configure signed task bodies

`app.setup_security()` requires `cryptography`, a signing key, certificate, and certificate-store path. Its configuration check requires both `task_serializer='auth'` and `accept_content=['auth']`. It disables untrusted serializers in Kombu's registry, registers `auth`, and sets that registry's default serializer. This is process-wide registry work, which matters when multiple applications coexist in a test process.

An application configuration can use:

```python
app.conf.update(
    task_serializer='auth',
    accept_content=['auth'],
    result_serializer='json',
    result_accept_content=['json'],
    security_key='/etc/celery/private.key',
    security_certificate='/etc/celery/signer.pem',
    security_cert_store='/etc/celery/trusted/*.pem',
)
app.setup_security()
```

The paths are deployment inputs, not repository-provided files. An encrypted private key can use `security_key_password`. Event signing additionally requires selecting `event_serializer='auth'`; task signing does not implicitly change the event serializer.

`SecureSerializer` first serializes with its inner serializer (JSON by default), signs those bytes, and packs the signer ID, signature, content metadata, and body. On receipt it resolves the signer in the certificate store and verifies the signature before decoding the inner payload. Unknown signers and bad signatures fail through the security error path.

The exact signed material is the serialized body. This implementation does not sign the complete broker envelope or protocol 2 headers. The packed format is base64 transport encoding, not encryption; the repository security guide explicitly says that `auth` does not encrypt message contents. Transport confidentiality and broker permissions remain deployment responsibilities.

## Certificate trust and rotation

The certificate implementation accepts RSA public keys. Signatures are verified using RSA-PSS with the configured digest. Certificate IDs combine issuer and serial number, and the store rejects duplicate IDs or unknown signer lookups.

`FSCertStore` loads files from a directory or glob and rejects expired certificates during store construction. The message verification method checks signatures using the already-loaded public key; it does not call the expiry check for every message. Store reload and process restart behavior therefore matter for rotation and removal. The configured store is the local trusted signer set; these classes do not implement a full network-fetched certificate revocation service.

## Backend exception reconstruction

For non-pickle results, the backend represents failures as exception module, qualified type, and serializable arguments. Reconstructing an exception looks in already-loaded modules or creates a fallback exception class. Before instantiation, it requires the resolved value to be a class derived from `BaseException`; other values raise `SecurityError`. This prevents stored failure metadata from selecting an arbitrary callable as its exception constructor.

This guard is one specific decoding invariant. Backend write access still influences the state and values seen by result readers. See [result contracts](../architecture/results.md) for storage and retrieval behavior, and [remote control](../operations/monitoring-control.md) for the mailbox sharing the broker boundary.

## Evidence and focused tests

Read [security setup](../../celery/security/__init__.py), [signed serialization](../../celery/security/serialization.py), [certificate store](../../celery/security/certificate.py), [exception reconstruction](../../celery/backends/base.py), and the [security guide](../../docs/userguide/security.rst). [Setup tests](../../t/unit/security/test_security.py), [serialization tests](../../t/unit/security/test_serialization.py), and [certificate tests](../../t/unit/security/test_certificate.py) cover rejection paths and round trips. [Base-backend tests](../../t/unit/backends/test_base.py) cover exception conversion. Follow [messaging](../architecture/messaging.md) for the complete task envelope and publication flow.
