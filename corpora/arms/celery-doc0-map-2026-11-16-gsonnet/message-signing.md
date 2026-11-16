---
title: "Message Signing"
---
## Overview

By default a worker trusts whatever is in the queue it consumes: whoever can publish to the broker can send it a task. Message signing closes that gap with a serializer named `auth`. The sender serializes a message with an ordinary serializer, signs the serialized bytes with an RSA private key and wraps the result together with the signer's certificate id. The receiver looks the certificate up in a trusted store, checks the signature, and only then decodes the content. It is built on the `cryptography` package and lives in `celery/security`.

Sources: [celery/security/serialization.py:20-77](repo://celery/security/serialization.py#L20-L77), [celery/security/__init__.py:1-41](repo://celery/security/__init__.py#L1-L41)

The serializer plugs into kombu's serializer registry, so it applies wherever the serializer named `auth` is selected, which `setup_security` makes the task serializer and the default. The general serializer and `accept_content` settings that it relies on are covered in [[The Celery App and Configuration]], and how a published message reaches the serializer is in [[Publishing Tasks]].

Sources: [celery/security/serialization.py:80-90](repo://celery/security/serialization.py#L80-L90), [celery/security/__init__.py:70](repo://celery/security/__init__.py#L70)

## Turning it on

`app.setup_security(...)` forwards to `celery.security.setup_security`, a global operation that affects every app instance. Importing the module fails with `ImproperlyConfigured` and an install hint when `cryptography` is missing.

Sources: [celery/app/base.py:750-780](repo://celery/app/base.py#L750-L780), [celery/security/__init__.py:34-41](repo://celery/security/__init__.py#L34-L41)

`setup_security` performs these steps:

Sources: [celery/security/__init__.py:44-70](repo://celery/security/__init__.py#L44-L70)

1. It calls kombu's `disable_insecure_serializers`, which disables the untrusted serializers (the ones not named in `allowed_serializers`).
2. It requires `task_serializer` to be `'auth'` and `accept_content` to be exactly `['auth']`; anything else raises `ImproperlyConfigured`, explaining that signing is pointless unless messages are also verified.
3. It reads `key`, `key_password`, `cert`, `store` and `digest` from the arguments, falling back to the `security_key`, `security_key_password`, `security_certificate`, `security_cert_store` and `security_digest` settings, and raises `ImproperlyConfigured` unless the key, certificate and store are all set.
4. It opens the key and certificate files, calls `register_auth` with their contents, and makes `auth` the default serializer.

Sources: [celery/security/__init__.py:44-70](repo://celery/security/__init__.py#L44-L70), [celery/app/defaults.py:239-247](repo://celery/app/defaults.py#L239-L247)

`security_digest` defaults to `sha256`, and the `serializer` argument (default `json`) names the serializer that encodes the message body before it is signed.

Sources: [celery/app/defaults.py:15-30](repo://celery/app/defaults.py#L15-L30), [celery/app/defaults.py:246](repo://celery/app/defaults.py#L246), [celery/security/__init__.py:44-45](repo://celery/security/__init__.py#L44-L45)

## Signing and verifying

`register_auth` builds a `SecureSerializer` from a `PrivateKey` (when a key is given), a `Certificate` (when a certificate is given) and an `FSCertStore` (when a store is given), and registers `s.serialize` and `s.deserialize` in kombu's registry under the name `auth`, with content type `application/data`.

Sources: [celery/security/serialization.py:80-90](repo://celery/security/serialization.py#L80-L90)

`serialize` first encodes the data with the inner serializer using kombu's `dumps`. The comment in the code explains the key decision: the signature covers the serialized body, so the receiver can verify before decoding anything and a flaw in the decoder cannot be reached by an unsigned message. It signs the body with the private key and packs it with the signer's id.

Sources: [celery/security/serialization.py:31-46](repo://celery/security/serialization.py#L31-L46)

The packed form is a base64 string made of the base64 signer id, the base64 signature, the inner content type, the inner content encoding and the body, joined by the separator `\x00\x01`. The comment above `DEFAULT_SEPARATOR` says it is guaranteed not to occur in the serialized data, and `_unpack` splits at most four times so the body may contain the separator.

Sources: [celery/security/serialization.py:14-17](repo://celery/security/serialization.py#L14-L17), [celery/security/serialization.py:60-77](repo://celery/security/serialization.py#L60-L77)

`deserialize` unpacks the payload, then looks up `self._cert_store[signer]` and calls `verify(body, signature, digest)`. An unknown signer raises `SecurityError('Unknown certificate: ...')` from the store, and a bad signature raises `SecurityError`. Only after verification does it call kombu's `loads` with the inner content type, with `force=True` because the inner serializer is not in the accepted set.

Sources: [celery/security/serialization.py:48-58](repo://celery/security/serialization.py#L48-L58), [celery/security/certificate.py:86-91](repo://celery/security/certificate.py#L86-L91)

```mermaid
flowchart LR
  data["message data"] --> dumps["inner serializer (json)"]
  dumps --> sign["PrivateKey.sign(body)"]
  sign --> pack["pack: signer, signature, type, encoding, body"]
  pack --> wire["base64 on the wire"]
  wire --> unpack["unpack"]
  unpack --> lookup["CertStore[signer]"]
  lookup --> verify["Certificate.verify"]
  verify --> loads["loads(body)"]
```

Sources: [celery/security/serialization.py:31-77](repo://celery/security/serialization.py#L31-L77)

## Keys, certificates and the store

`PrivateKey` loads a PEM private key with an optional password and rejects anything that is not an RSA key. `sign` produces an RSA-PSS signature with MGF1 over the configured digest and the maximum salt length.

Sources: [celery/security/key.py:12-35](repo://celery/security/key.py#L12-L35)

`Certificate` loads a PEM X.509 certificate and also rejects non-RSA public keys. A certificate's id is its issuer and serial number joined as `"<issuer> <serial>"`, which is what the signer field carries. `verify` checks an RSA-PSS signature with the same parameters, and `has_expired` compares the certificate's validity end with the current UTC time.

Sources: [celery/security/certificate.py:31-73](repo://celery/security/certificate.py#L31-L73)

`FSCertStore` reads every file in a directory (or those matching a glob), builds a `Certificate` from each and adds it by id. It raises `SecurityError` for an expired certificate, and `add_cert` raises for a duplicate id. The store is the list of identities the worker trusts, since a message signed by a certificate that is not in it fails at lookup.

Sources: [celery/security/certificate.py:76-113](repo://celery/security/certificate.py#L76-L113)

`get_digest_algorithm` turns the digest name into a `cryptography` hash object by upper-casing it and looking it up in `hashes`. `reraise_errors` is a context manager used throughout that converts the library's errors into `SecurityError` with a message, so every failure surfaces as one exception type.

Sources: [celery/security/utils.py:13-28](repo://celery/security/utils.py#L13-L28)

## Related safeguards

Signing is one of two places where the code checks what a worker will accept. When a worker is created, `check_privileges(accept_content)` raises `SecurityError` if the process is root, or in the `sudo` or `wheel` group, and accepts `pickle` content, unless `C_FORCE_ROOT` is set; otherwise it warns. A worker restricted to `['auth']` does not trigger the pickle case ([[Command Line Interface]]).

Sources: [celery/platforms.py:788-845](repo://celery/platforms.py#L788-L845), [celery/apps/worker.py:94-104](repo://celery/apps/worker.py#L94-L104)

The result backend applies a related rule when it reads stored errors: `exception_to_python` refuses to instantiate an "exception class" that is not a `BaseException` subclass and raises `SecurityError` instead, since a stored record could otherwise name an arbitrary callable ([[Result Backends]]).

Sources: [celery/backends/base.py:510-513](repo://celery/backends/base.py#L510-L513)
