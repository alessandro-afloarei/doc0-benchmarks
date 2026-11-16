---
type: operations
title: Message Signing and Security
description: Celery's security model for task messages — content-type whitelisting with accept_content, and the optional `auth` message-signing serializer in celery/security (RSA keys, X.509 certificate store, PSS signatures over the serialized body) configured through app.setup_security.
tags: [security, signing, serialization, certificates, accept-content]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-41d293d3c7e3c875eed1b7ef
    resource: repo://celery/app/control.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-3cfd5f9bf00aaf6b49d01291
    resource: repo://celery/apps/worker.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-0f8d26932b6272605a1f8531
    resource: repo://celery/platforms.py
  - id: openwiki-source-c0292f440e0f00e60a1ef94d
    resource: repo://celery/security/__init__.py
  - id: openwiki-source-5e4aaa0fe9e4042b9efeba88
    resource: repo://celery/security/certificate.py
  - id: openwiki-source-0ab93afcd32bbf1db565f1a3
    resource: repo://celery/security/key.py
  - id: openwiki-source-59df33ccfa1705c7a20dcc7b
    resource: repo://celery/security/serialization.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Message Signing and Security

Anyone who can publish to the broker can make workers execute registered tasks, so Celery's defences focus on **what a worker will deserialize** and, optionally, **who signed a message**. The code is in `celery/security/` (signing) plus the `accept_content` checks in the AMQP and backend layers. Vulnerability reporting is described in `SECURITY.md`.

## Content whitelisting

- `accept_content` defaults to `('json',)`. The worker's task consumer (`app.amqp.TaskConsumer`) and the remote-control mailbox pass it to kombu as `accept=`, so messages with any other content type (notably `pickle`, which can execute arbitrary code on load) are rejected.
- Result backends use `result_accept_content`, falling back to `accept_content` (`celery/backends/base.py`).
- Event receivers accept `{event_serializer, 'json'}`.
- `celery.security.disable_untrusted_serializers(whitelist)` disables every serializer in kombu's registry except the whitelist, for processes that want to be defensive globally.

Enabling `pickle` requires adding it to `accept_content` explicitly; the user guide (`docs/userguide/security.rst`) explains the risks.

## The `auth` serializer

Message signing is implemented as a kombu serializer named `auth` that wraps another serializer (JSON by default).

### Setup

```python
app.conf.update(
    security_key='/etc/ssl/private/worker.key',
    security_certificate='/etc/ssl/certs/worker.pem',
    security_cert_store='/etc/ssl/certs/*.pem',
    security_digest='sha256',
    task_serializer='auth',
    event_serializer='auth',
    accept_content=['auth'],
)
app.setup_security()
```

`Celery.setup_security()` delegates to `celery.security.setup_security()`, which:

1. Imports `cryptography` (raising `ImproperlyConfigured` at import of `celery.security` if it is missing).
2. Disables insecure serializers except those passed in `allowed_serializers`.
3. **Requires** `task_serializer == 'auth'` and `accept_content == ['auth']`; otherwise raises `ImproperlyConfigured` — signing without verifying everything is pointless.
4. Requires `security_key`, `security_certificate` and `security_cert_store` (from arguments or settings).
5. Reads the key and certificate files and calls `register_auth(...)`, which registers the serializer under content type `application/data`.
6. Makes `auth` kombu's default serializer.

This is a **process-global** operation on kombu's registry, affecting all app instances. Both producers and workers must call it.

### Settings

| Setting | Meaning |
|---------|---------|
| `security_key` | Path to the PEM private key used for signing |
| `security_key_password` | Optional password for the key (bytes) |
| `security_certificate` | Path to the PEM certificate matching the key |
| `security_cert_store` | Directory or glob of trusted certificates for verification |
| `security_digest` | Hash algorithm name (default `sha256`), resolved as `cryptography.hazmat.primitives.hashes.<NAME>` |

### Signing and verification flow

`SecureSerializer` (`celery/security/serialization.py`):

- **serialize** — serialises data with the inner serializer, then signs the *serialized bytes* (not the Python object) with the private key, so verification never has to decode untrusted content first. The payload is `b64encode(signer ⧺ signature ⧺ content_type ⧺ content_encoding ⧺ body)`, fields joined by the separator `\x00\x01` and signer/signature individually base64-encoded. The signer id is the certificate's `"<issuer> <serial number>"`.
- **deserialize** — splits the payload (at most 4 splits, so the body may contain anything), looks up the signer in the certificate store, verifies the signature, and only then decodes the body with the inner serializer (`force=True`, bypassing the accept list for the inner content type since it has been authenticated).

Cryptography details (`celery/security/key.py`, `certificate.py`):

- Only **RSA** keys and certificates are supported; others raise `ValueError` → `SecurityError`.
- Signatures use **RSA-PSS** with MGF1 and maximum salt length.
- `FSCertStore` loads every certificate matching the path/glob; an **expired certificate** or a **duplicate** id raises `SecurityError` at load time, and unknown signers raise `SecurityError('Unknown certificate')` during verification.
- All crypto exceptions are re-raised as `celery.exceptions.SecurityError` (`reraise_errors`). In the `celery worker` command a `SecurityError` aborts startup with exit code 1.

### Scope and limits

- Signing authenticates messages; it does **not** encrypt them. Use TLS on the broker connection (`broker_use_ssl`) for confidentiality.
- Results are signed only if `result_serializer='auth'` is configured too.
- Every signer's certificate must be present in every verifier's store.

## Other hardening notes

- `app.conf.humanize()`/`celery report` mask secrets in output (see [Configuration](../architecture/configuration.md)).
- At startup `celery.apps.worker.Worker` calls `platforms.check_privileges(accept_content)`: running as root (uid/euid 0) or with a `sudo`/`wheel` group is refused with `SecurityError` when `pickle` is accepted, unless `C_FORCE_ROOT` is set; without pickle it only warns. `--uid/--gid` drop privileges.
- Remote control can be disabled with `worker_enable_remote_control=False` (see [Remote Control](../worker/remote-control.md)).

## Tests

- `t/unit/security/` — certificates, keys, serializer round-trips, `setup_security` validation.
- `t/integration/test_security.py` — signed messages against a live broker with generated certificates.

## Related

- [Message Protocol, Queues and Routing](../tasks/messaging-and-routing.md)
- [Configuration System](../architecture/configuration.md)
