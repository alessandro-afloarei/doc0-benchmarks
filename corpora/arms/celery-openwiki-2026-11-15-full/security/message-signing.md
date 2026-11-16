---
type: subsystem
title: Message Signing Security
description: Celery's message-signing "auth" serializer — setup_security preconditions, disabling insecure serializers, RSA key and X.509 certificate handling, the certificate store, the signed payload format and verification path, and related serializer/root safety checks.
tags: [security, signing, serializer, certificates, auth]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-c0292f440e0f00e60a1ef94d
    resource: repo://celery/security/__init__.py
  - id: openwiki-source-5e4aaa0fe9e4042b9efeba88
    resource: repo://celery/security/certificate.py
  - id: openwiki-source-0ab93afcd32bbf1db565f1a3
    resource: repo://celery/security/key.py
  - id: openwiki-source-59df33ccfa1705c7a20dcc7b
    resource: repo://celery/security/serialization.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Message Signing Security

`celery/security/` implements an optional **`auth` serializer** that signs every task message with an RSA private key and verifies signatures against a store of trusted X.509 certificates. It protects against forged or tampered task messages from parties who can publish to the broker but don't hold a trusted key. It does **not** encrypt message contents.

The package requires the `cryptography` library: importing `celery.security` without it raises `ImproperlyConfigured`.

## Enabling it

```python
app.conf.update(
    security_key='/etc/ssl/private/worker.key',
    security_certificate='/etc/ssl/certs/worker.pem',
    security_cert_store='/etc/ssl/certs/*.pem',
    security_digest='sha256',          # default
    task_serializer='auth',
    accept_content=['auth'],
    # optionally: event_serializer / result_serializer / result_accept_content
)
app.setup_security()
```

`Celery.setup_security(allowed_serializers=None, key=None, key_password=None, cert=None, store=None, digest='sha256', serializer='json')` delegates to `celery.security.setup_security`, which:

1. Calls kombu's `disable_insecure_serializers(allowed_serializers)` — a **process-global** change to kombu's serializer registry that affects every app in the process.
2. Requires `task_serializer == 'auth'` **and** `accept_content == ['auth']`; otherwise raises `ImproperlyConfigured` ("There is no point in signing messages if they are not verified").
3. Fills `key`, `key_password`, `cert`, `store`, `digest` from `security_key`, `security_key_password`, `security_certificate`, `security_cert_store`, `security_digest`; missing key/cert/store raises `ImproperlyConfigured`.
4. Reads the key and certificate files and calls `register_auth(...)`, which registers the `auth` serializer in kombu (`content_type='application/data'`, `content_encoding='utf-8'`).
5. Sets `auth` as kombu's default serializer.

`serializer` is the *inner* serializer used to encode the body before signing (default `json`).

## Keys, certificates and the store

- `PrivateKey` (`key.py`) loads a PEM private key (optionally password-protected). **Only RSA keys are accepted.** Signing uses RSA-PSS with MGF1 and maximum salt length over the configured digest.
- `Certificate` (`certificate.py`) loads a PEM X.509 certificate; **only RSA public keys are accepted**. Its id is `"<issuer> <serial number>"`. `verify()` checks an RSA-PSS signature.
- `FSCertStore(path)` loads every file matching `path` (a glob, or every file in a directory). It raises `SecurityError` for an **expired** certificate or a duplicate id. Lookups of unknown signer ids raise `SecurityError('Unknown certificate')`.
- `get_digest_algorithm(name)` maps the digest name to a `cryptography.hazmat.primitives.hashes` class (e.g. `sha256` → `SHA256`).
- Cryptography errors are re-raised as `celery.exceptions.SecurityError` (`reraise_errors`).

## Signed payload format

`SecureSerializer.serialize(data)`:

1. Encodes `data` with the inner serializer → `(content_type, content_encoding, body)`.
2. Signs the **serialized bytes** (not the Python object), so the receiver can verify before decoding anything.
3. Packs `b64(signer_id) \x00\x01 b64(signature) \x00\x01 content_type \x00\x01 content_encoding \x00\x01 body` and base64-encodes the whole thing.

`deserialize(data)` base64-decodes, splits on the separator (at most 4 splits, so the body may contain anything), looks up the signer's certificate in the store, verifies the signature over `body`, and only then decodes `body` with the declared content type (`force=True`, since the inner type may not be in `accept_content`). Any failure raises `SecurityError`.

## Operational consequences

- Every producer (clients, workers sending subtasks, beat) needs a private key whose certificate is in every consumer's store; workers need the store of all trusted signers.
- Because `accept_content` must be exactly `['auth']`, unsigned task messages are rejected by workers (the consumer treats disallowed content as an invalid task — see [Worker Consumer](../worker/consumer.md)).
- A `SecurityError` raised while starting the worker CLI exits with status 1 (see [Command-Line Interface](../cli/command-line.md)).
- Expired certificates in the store prevent startup rather than being silently skipped.

## Related serializer safety

Independently of signing:

- `accept_content` defaults to `('json',)`; the worker refuses other content types.
- Starting a worker as root while accepting `pickle` raises `SecurityError` unless `C_FORCE_ROOT` is set (`platforms.check_privileges`, see [Signals, Logging and Platform Support](../operations/signals-logging-and-platforms.md)).
- Result backends refuse to rebuild stored "exceptions" that are not real exception classes ([Result Backends](../results/result-backends.md)).

## Related tests

`t/unit/security/` (`test_security.py`, `test_certificate.py`, `test_key.py`, `test_serialization.py`), `t/integration/test_security.py`.
