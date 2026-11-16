---
type: architecture
title: Message Signing and Security
description: How Celery's optional message-signing 'auth' serializer works (RSA-PSS signatures, X.509 certificate store, setup_security preconditions), the serialization trust model (accept_content, pickle risk), and other security guards such as result-backend exception validation and secret masking.
tags: [celery, security, signing, serialization, cryptography, pickle, certificates]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
sources:
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-3cfd5f9bf00aaf6b49d01291
    resource: repo://celery/apps/worker.py
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
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Message Signing and Security

Celery's trust model is simple: **whoever can publish to the broker (or write to the result backend) can influence what workers execute or what clients receive.** The package offers two main mitigations — restricting serializers and optionally *signing* messages with the `auth` serializer — plus a few targeted guards. Code is in `celery/security/`; settings are defined in `celery/app/defaults.py`.

## Serialization is the main attack surface

Task messages are encoded with a kombu serializer (`task_serializer`, default JSON) and a worker only decodes content types in `accept_content` (default `('json',)`, `celery/app/defaults.py#L13`). Result payloads follow `result_serializer` and `result_accept_content` (falling back to `accept_content`). Enabling `pickle` in `accept_content` lets any broker writer run arbitrary code in the worker (and any result-store writer attack clients), so it should only be used on fully trusted infrastructure. When a message cannot be decoded (content type not accepted, bad data, bad signature), the consumer's `on_decode_error` logs a critical error with the content type, headers and truncated body and **acknowledges the message** so it does not loop forever (`celery/worker/consumer/consumer.py#L516-L530`).

## The `auth` serializer

`setup_security()` (`celery/security/__init__.py#L42-L70`, exposed as `app.setup_security(...)`) registers a signing serializer and makes it the default. It deliberately refuses to configure itself unless the app is safe:

1. It first disables all insecure serializers in kombu (`disable_insecure_serializers(allowed_serializers)`; everything is disabled except the serializers explicitly allowed).
2. It then requires `task_serializer == 'auth'` **and** `accept_content == ['auth']`, otherwise raises `ImproperlyConfigured`. Signing is pointless if unsigned messages are still accepted, so only signed content is allowed.
3. It requires `security_key`, `security_certificate` and `security_cert_store` (plus optional `security_key_password` and `security_digest`, default `sha256`); missing ones raise `ImproperlyConfigured`.
4. It reads the key and certificate files and calls `register_auth`, then sets `auth` as the default kombu serializer.

The import of `celery.security` itself raises `ImproperlyConfigured` if the `cryptography` package is missing (install the `celery[auth]` extra).

### Wire format and verification

`SecureSerializer` (`celery/security/serialization.py`) wraps an inner serializer (default `json`; configurable through `setup_security(serializer=...)`):

- **serialize**: encode the data with the inner serializer, sign *the encoded bytes* with the private key (`RSA-PSS`, MGF1 with the chosen digest, maximum salt length), and pack `signer-id, signature, content_type, content_encoding, body` separated by the byte sequence `\x00\x01` and base64-encoded as a whole. The signer id is the certificate's `"<issuer> <serial>"` string.
- **deserialize**: unpack, look up the signer's certificate in the store by id, **verify the signature over the raw body before decoding it**, and only then decode the body with the inner content type (`loads(..., force=True)`). Verifying before decoding is intentional: the receiver never runs a decoder over unauthenticated bytes, avoiding flaws in the decoding step.
- All cryptographic failures are re-raised as `SecurityError` through `reraise_errors` (`utils.py`).

### Keys and certificates

- `PrivateKey` (`key.py`) loads a PEM private key (optional password) and **only RSA keys are accepted**; `sign` uses PSS padding.
- `Certificate` (`certificate.py`) loads a PEM X.509 certificate, again **RSA-only**; `verify` uses PSS; `has_expired()` compares `not_valid_after_utc` with now.
- `FSCertStore` loads every file matching a path or directory glob into a dict keyed by certificate id. Loading **fails with `SecurityError` on an expired certificate or a duplicate id**, and lookup of an unknown signer raises `SecurityError('Unknown certificate ...')`. Certificates are therefore only checked for expiry at load time (worker/client start-up), not on each message, and there is no revocation check: rotate by changing the store and restarting.
- The certificate store acts as the allow-list: any signer whose certificate is in `security_cert_store` is trusted to publish tasks, so only place certificates of publishers you trust there. (The code does not validate certificate chains against a CA.)

### Operating it

Both producers and workers must call `app.setup_security(...)`; producers need a key and certificate, workers need the store containing all producers' certificates. A worker that cannot configure security exits (the CLI worker command turns `SecurityError` into a message and exit code 1 — see [[/openwiki/architecture/cli.md]]). Tests live in `t/unit/security/` (key, certificate, serialization, setup) and `t/integration/test_security.py`.

## Other guards

- **Result exception validation**: when rebuilding exceptions from the result backend, the backend verifies the resolved object is an exception class, raising `SecurityError` otherwise (see [[/openwiki/architecture/result-backends.md]]).
- **Secret masking**: `HIDDEN_SETTINGS` in `celery/app/utils.py` is a regex (API, TOKEN, KEY, SECRET, PASS, SIGNATURE, DATABASE, BEAT_DBURI...) used when displaying configuration (bug reports, `celery report`) so secrets are masked; backend URLs are sanitized by `as_uri()`.
- **Root/privilege check**: `Worker.on_before_init` calls `check_privileges(accept_content)` (`celery/platforms.py#L788-L843`). If the worker runs as root (uid/euid 0) or in a `sudo`/`wheel` group, it emits a `SecurityWarning`; if additionally `pickle` (or the `application/group-python-serialize` type) is accepted, it raises `SecurityError` unless `C_FORCE_ROOT` is set. Separately, `--uid/--gid` on the `worker` and `beat` commands drop privileges via `maybe_drop_privileges`.

## Reporting

`SECURITY.md` lists supported versions and the e-mail addresses for private vulnerability reports.

## Related

- [[/openwiki/architecture/tasks.md]] — where task serializer options (`serializer`, `compression`) are applied at publish time.
- [[/openwiki/architecture/worker.md]] — consumer decode-error handling and message acknowledgement.
