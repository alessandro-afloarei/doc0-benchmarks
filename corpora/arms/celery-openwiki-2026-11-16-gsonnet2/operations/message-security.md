---
type: operations
title: Message Security and Signing
description: How Celery protects the task channel. Covers the serializer allow-list, the optional `auth` message-signing serializer built on X.509 certificates and RSA-PSS (setup_security), related hardening in the worker and result backends, and operational guidance.
tags: [celery, security, serialization, signing, certificates, pickle, operations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
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
  - id: openwiki-source-cc1aca24a63debec055f034f
    resource: repo://celery/security/utils.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# Message Security and Signing

A Celery broker is a trust boundary. Anything that can publish to a task queue can ask workers to run registered code, and anything that can publish to the control exchange can drive the workers (see [Events and remote control](../architecture/events-and-remote-control.md)). Celery's defences are layered: restrict which serializers are accepted, optionally sign messages, refuse risky process configurations, and sanitize what is read back from result backends. The signing code is in `celery/security/`.

## Layer 1: restrict serializers

- `accept_content` defaults to `('json',)` (`celery/app/defaults.py`). The worker passes this list when it decodes task bodies (`trace_task_ret` and `fast_trace_task` in `celery/app/trace.py`). A message in another content type is rejected with `ContentDisallowed`, and the consumer turns that into `on_invalid_task` (reject, `task_rejected` signal) rather than executing it.
- The result side has its own `result_accept_content` (falling back to `accept_content`) and `result_serializer`.
- **Pickle is the dangerous option.** Accepting it means any publisher can run arbitrary code on the worker. Celery lets you opt in, but the worker checks at startup: `check_privileges` (`celery/platforms.py`) refuses to start with `pickle` (or the Python-serialize content type) accepted when running as root or in a `sudo`/`wheel` group, raising `SecurityError` unless `C_FORCE_ROOT` is set. Otherwise it only warns. See [CLI and process management](../architecture/cli-and-process-management.md).

## Layer 2: signed messages (`auth` serializer)

`app.setup_security(...)` (`celery/app/base.py`) calls `celery.security.setup_security`. This is a **global** operation, since it modifies kombu's process-wide serializer registry and affects all apps in the process.

### Setup contract

`setup_security` (`celery/security/__init__.py`):

1. Calls kombu's `disable_insecure_serializers(allowed_serializers)`, disabling untrusted serializers (such as pickle) except those you exempt.
2. **Requires** `task_serializer == 'auth'` **and** `accept_content == ['auth']`, otherwise `ImproperlyConfigured`. The error text states that there is no point in signing messages if they are not verified.
3. Takes the key, key password, certificate, certificate store and digest from arguments or from the settings `security_key`, `security_key_password`, `security_certificate`, `security_cert_store` and `security_digest` (default `sha256`). All of key, cert and store must be set.
4. Registers the `auth` serializer and makes it kombu's default serializer.

Importing `celery.security` fails with `ImproperlyConfigured` if the `cryptography` package is missing (extra: `celery[auth]`, `requirements/extras/auth.txt`).

### Wire format and cryptography

`SecureSerializer` (`celery/security/serialization.py`) wraps an inner serializer (`serializer`, default `json`):

- **Serialize:** encode the data with the inner serializer, then sign **the encoded body bytes** with the private key. The format is `base64(b64(signer) SEP b64(signature) SEP content_type SEP content_encoding SEP body)`, with the separator `\x00\x01`.
- **Deserialize:** unpack, look up the signer's certificate in the certificate store by id, **verify the signature over the raw body first**, and only then decode the body with the inner serializer. Verifying before decoding is deliberate: the receiver never parses attacker-controlled content that has not been authenticated, which avoids decoder flaws.
- The signer id is `"<issuer> <serial number>"` of the signing certificate, which identifies which store certificate to verify against.

Key handling:

- `PrivateKey` (`key.py`) loads a PEM key (optionally password-protected) and accepts only **RSA** keys. It signs with **RSA-PSS**, MGF1 over the chosen digest and maximum salt length.
- `Certificate` (`certificate.py`) loads an X.509 PEM certificate, requires an RSA public key, and verifies PSS signatures.
- `FSCertStore` loads every file in a directory (or glob) at startup. It raises `SecurityError` for an expired certificate or a duplicate id. Unknown signer ids raise `SecurityError('Unknown certificate: ...')` at verification time.
- Crypto errors are converted to `SecurityError` by `reraise_errors`.

### Operational consequences

- Every producer **and** worker needs a key pair and the CA/peer certificates. Since only `auth` is accepted, an unsigned message, including one from a producer that forgot `setup_security`, is rejected.
- Certificates are read at startup only, so rotate by restarting workers. An expired certificate in the store prevents startup.
- Signing gives **integrity and authenticity**, not confidentiality. The body is not encrypted. Use broker TLS (`broker_use_ssl`) for secrecy and to protect the control and event channels.
- Signing does not cover the control (pidbox) or event exchanges, which have their own accept-content settings (`accept_content` is passed to the control `Mailbox`).
- The signature covers the body only. Message headers (task name, id, eta, and so on) are outside the signed bytes.

## Layer 3: defence in depth elsewhere

- **Result backends.** `Backend.exception_to_python` raises `SecurityError` if a stored "exception" does not resolve to an exception class, which blocks results that name arbitrary callables as the exception type (`celery/backends/base.py`). See [Result backends](../architecture/result-backends.md).
- **Process hygiene.** The worker should run unprivileged. `--uid` and `--gid` drop privileges (see [CLI and process management](../architecture/cli-and-process-management.md)).
- **Static analysis.** The repo runs `bandit` (config in `bandit.json`; the `bandit` tox env), CodeQL and Semgrep workflows (`.github/workflows/codeql-analysis.yml`, `semgrep.yml`). See [Testing, CI and development workflow](../testing/test-strategy.md).
- **Reporting.** `SECURITY.md` asks for vulnerability reports by email to the maintainers rather than public issues, and lists the supported release lines (the table there lags the current 5.6 release).

## Tests

`t/unit/security/` (`test_security.py`, `test_serialization.py`, `test_certificate.py`, `test_key.py`, plus `case.py` and fixture keys), and `t/integration/test_security.py`, which exercises a real signed round trip.
