---
type: operations
title: Configuration and Security
description: How Celery's settings are declared and defaulted in one namespace table, the content-type acceptance policy that limits which serializers workers will decode, and the optional message-signing ("auth") serializer with its key, certificate, and certificate-store settings, including what each guarantees and what it does not.
tags: [celery, configuration, settings, security, serialization, signing, certificate, accept-content]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-c0292f440e0f00e60a1ef94d
    resource: repo://celery/security/__init__.py
  - id: openwiki-source-0ab93afcd32bbf1db565f1a3
    resource: repo://celery/security/key.py
  - id: openwiki-source-59df33ccfa1705c7a20dcc7b
    resource: repo://celery/security/serialization.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Configuration and Security

Celery's behaviour is driven by a flat set of settings with names such as `task_serializer` and `worker_pool`. The settings are declared, typed, and defaulted in `celery/app/defaults.py`, and read through the app's configuration object (see [application](../architecture/application.md)). Security-relevant settings are a small subset: which content types a worker will accept, and, optionally, a signing scheme that authenticates producers. This page covers both, and it also states what the defaults protect against and what they do not.

## Declaration and defaults

`celery/app/defaults.py` declares each setting as an `Option` with a default value and a type, and groups related options into `Namespace` blocks. Examples are `beat` (lines 73–80), `broker`, `result`, `task` (line 265), `worker` (line 325), and `security` (line 239). A namespace's options are exposed with the namespace prefix, so `security.key` becomes `security_key`. Old names are accepted through `old=` and `__old__` mappings, which lets upgraded deployments keep working; the `celery upgrade settings` command rewrites them (see [command-line interface](cli.md)).

Two defaults matter for security:

- `accept_content` defaults to `DEFAULT_ACCEPT_CONTENT = ('json',)` (`defaults.py`, line 13, applied at line 67). A worker decodes only JSON message bodies by default. Pickle and other serializers are not accepted unless the application lists them.
- `task_serializer` (line 314) defaults to `json`. The result and event serializers follow their own settings. `result_accept_content` (line 68) defaults to `None`, which means results are accepted with the content types of the general setting.

## The auth serializer and signing

The optional `auth` serializer signs each message body with the sender's private key and lets the worker verify the signature against a trusted certificate store. It is implemented in `celery/security/`:

- `__init__.py` defines `setup_security`. It refuses to run unless `task_serializer` is `auth` and `accept_content` is exactly `['auth']`, and it requires `security_key`, `security_certificate`, and `security_cert_store`. It calls kombu's `disable_insecure_serializers(allowed_serializers)` to restrict decoding to the allowed set, reads the key and certificate files, registers the serializer, and makes `auth` the default serializer.
- `serialization.py` defines `SecureSerializer` and `register_auth`. `serialize` encodes the body with the base serializer (`json` by default), signs the encoded body with the private key (`_key.sign(body, digest)`), and packs the signer identifier, signature, content type, content encoding, and body into one base64 payload separated by the byte sequence `\x00\x01`. `deserialize` unpacks the payload, looks up the signer's certificate in the store, verifies the signature, and only then decodes the body. The code notes that what is signed is the serialized body, not the object, to avoid flaws in verification.
- `key.py` defines `PrivateKey`, which loads a PEM key with an optional password and signs with a digest (default `DEFAULT_SECURITY_DIGEST`).
- `certificate.py` defines `Certificate` (parses a PEM certificate, exposes its public key, serial number, issuer, expiry, and an identifier, and verifies signatures), `CertStore`, and `FSCertStore`, which reads certificates from a directory.
- `utils.py` provides `get_digest_algorithm` and `reraise_errors`, which wraps failures in a consistent message.

The security settings are in the `security` namespace of `defaults.py` (lines 239–247): `certificate`, `cert_store`, `key`, `key_password`, and `digest` (default `DEFAULT_SECURITY_DIGEST`). They map to `security_certificate`, `security_cert_store`, `security_key`, `security_key_password`, and `security_digest`.

The `cryptography` package must be installed; `celery/security/__init__.py` raises `ImproperlyConfigured` when it is missing.

## Operational consequences

- **Accept list is the first line of defence.** Because workers decode only what `accept_content` lists, changing that list to add `pickle` makes the worker execute code from any producer that can reach the broker. Keep `json` unless every producer is trusted.
- **Signing authenticates producers, not payload safety.** A verified `auth` message proves that a holder of a trusted private key sent it. It does not restrict which tasks may run, validate arguments, or protect the broker itself. Access control on the broker and on task definitions still matters.
- **Certificate management is operational.** Certificates have expiry dates (`Certificate.has_expired`), and the certificate store must contain the signer's certificate on every worker. A key rotation or expired certificate causes verification failures, not silent acceptance.
- **Configuration errors fail early.** `setup_security` raises `ImproperlyConfigured` at startup when settings are incomplete or inconsistent, so misconfiguration is visible before messages flow.
- **Results and events have separate content settings.** Enabling the auth scheme for tasks does not automatically cover result or event messages; check `result_accept_content` and `event_serializer` when the policy must cover every message type.

## Invariants

- Only content types in `accept_content` are decoded. `setup_security` calls kombu's disable-insecure-serializers hook, which removes the other registered serializers from use.
- A signed message is decoded only after its signature verifies against a certificate in the configured store.

## Reporting security issues

`SECURITY.md` at the repository root lists the supported versions and says to report vulnerabilities by email to the maintainers it names, rather than in a public issue.

## Representative tests

`t/unit/security/` covers serialization, the key and certificate classes, and `setup_security`. `t/integration/test_security.py` and `t/integration/serialization_config.py` exercise the auth serializer end to end.
