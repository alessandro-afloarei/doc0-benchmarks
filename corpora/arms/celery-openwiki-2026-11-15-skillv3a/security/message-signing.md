---
type: security
title: Message Signing (auth serializer)
description: How Celery's optional `auth` serializer signs task messages with an RSA private key and verifies them against a filesystem store of X.509 certificates. Covers setup_security preconditions, the wire format, the digest and PSS padding, certificate store rules, related settings, and what signing does and does not protect.
tags: [security, signing, serializer, certificates, cryptography]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
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
  - id: openwiki-source-cc1aca24a63debec055f034f
    resource: repo://celery/security/utils.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Message Signing (auth serializer)

`celery/security/` implements an opt-in **message-signing serializer** named `auth`. It is registered in kombu's serializer registry, so it signs any payload it serializes. Workers that only accept `auth` will reject messages that are unsigned or signed by an unknown certificate. It requires the `cryptography` package. Importing `celery.security` without it raises `ImproperlyConfigured`.

## Enabling it

```python
app.conf.update(
    security_key='/etc/ssl/private/worker.key',
    security_certificate='/etc/ssl/certs/worker.pem',
    security_cert_store='/etc/ssl/certs/*.pem',
    task_serializer='auth',
    event_serializer='auth',      # optional
    accept_content=['auth'],
)
app.setup_security()
```

`app.setup_security(allowed_serializers=None, key=None, key_password=None, cert=None, store=None, digest='sha256', serializer='json')` → `celery.security.setup_security` does the following:

1. Calls kombu's `disable_insecure_serializers(allowed_serializers)`. This is a **process-global** change to the kombu registry and affects every app in the process.
2. Requires `task_serializer == 'auth'` **and** `accept_content == ['auth']`, otherwise it raises `ImproperlyConfigured`. Signing without verification is pointless, so both must be set.
3. Resolves `security_key`, `security_key_password`, `security_certificate`, `security_cert_store`, and `security_digest` from arguments or configuration. All of key, certificate, and store are required.
4. Reads the key and certificate files and calls `register_auth(...)`, which registers `'auth'` with content type `application/data`. It then makes `auth` kombu's default serializer.

`serializer` is the **inner** serializer used for the actual body before signing. It defaults to `json`.

## Wire format

`SecureSerializer.serialize(data)`:

1. `body = kombu.dumps(data, serializer=inner)`, so the **serialized bytes** are signed. This means the receiver can verify the signature before decoding anything.
2. `signature = PrivateKey.sign(body, digest)` uses RSA with **PSS** padding (MGF1 with the same digest, maximum salt length).
3. `signer = Certificate.get_id()`, which is `"<issuer> <serial number>"`.
4. It packs `b64(signer) ␀␁ b64(signature) ␀␁ content_type ␀␁ content_encoding ␀␁ body` with the separator `\x00\x01`, then base64-encodes the whole thing.

`deserialize(data)` unpacks the payload (splitting at most four times, so the separator may appear inside the body). It looks up the signer's certificate in the store, verifies the signature over the raw body, and only then calls `kombu.loads(body, content_type, content_encoding, force=True)`. Any error from the crypto library or the format is re-raised as `celery.exceptions.SecurityError` by `reraise_errors`.

## Keys and certificates

- `PrivateKey` loads a PEM key, optionally decrypted with `security_key_password`. **Only RSA keys are accepted.**
- `Certificate` loads a PEM X.509 certificate. Only RSA public keys are accepted. `has_expired()` compares against `not_valid_after_utc`.
- `FSCertStore(path)` loads every file matching a glob. A directory is expanded to `dir/*`. It **raises `SecurityError` on any expired certificate** or on a duplicate certificate ID, and `store[unknown_id]` raises `SecurityError('Unknown certificate ...')`.
- `security_digest` (default `sha256`) is resolved to the `cryptography.hazmat.primitives.hashes` class with the same name in upper case, for example `sha512` → `SHA512`.

Workers verify against **all** certificates in the store. Every producer that sends tasks (clients, beat, other workers that publish subtasks or results) therefore needs a key whose certificate is in each consumer's store.

## What it protects (and what it doesn't)

- **Integrity and authenticity** of message bodies: a party that can publish to the broker but holds no trusted key cannot inject tasks that a verifying worker will execute.
- It does **not encrypt**: bodies are base64 but readable. Use broker TLS for confidentiality.
- Headers are outside the signed body. Protocol v2 carries routing and metadata in AMQP headers, and only the body is signed.
- It complements `accept_content`. The worker refuses to start as root when `pickle` is accepted (see [Deployment](../operations/deployment.md)). Result payloads are additionally protected from code execution by the backend's exception-class check (see [Result Backends](../results/backends.md#exceptions-are-reconstructed-safely)).
- `celery worker` exits with code 1 on `SecurityError` during start-up, for example on a bad key or an expired certificate in the store.

## Tests and tooling

- `t/unit/security/`: `test_security.py` (setup preconditions), `test_serialization.py` (round trip, tampering, separator handling), `test_certificate.py` (expiry, store), and `test_key.py`. Shared PEM fixtures are in `case.py`.
- `t/integration/test_security.py` exercises signed messages end-to-end.
- `extra/release/gen-cert.sh` generates test certificates.

## See also

- [Task Messages, Protocol and Routing](../tasks/messaging-and-routing.md)
- [Configuration Settings Reference](../reference/configuration.md)
