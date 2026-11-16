---
title: "Message Security"
---
## Overview

The security layer signs each message that uses the `auth` serializer with a private key and checks the signature on arrival, so a worker accepts such a message only from a sender whose certificate is in its store. It is built from four parts: `setup_security` in `celery/security/__init__.py`, which wires the settings together and restricts the serializers; `PrivateKey` and `Certificate` in `key.py` and `certificate.py`, which load the PEM files; `CertStore`, which finds the certificate for a signer id; and `SecureSerializer` in `serialization.py`, which signs on serialize and verifies on deserialize. Once `setup_security` registers the `auth` serializer, it is the registry's default serializer. The message layout that is signed is described in [[Message Format and Serialization]].

Sources: [celery/security/__init__.py:44-72](repo://celery/security/__init__.py#L44-L72), [celery/security/serialization.py:20-30](repo://celery/security/serialization.py#L20-L30)

## Setting up

`setup_security` takes the keys, certificate and store, and falls back to the settings `security_key`, `security_key_password`, `security_certificate`, `security_cert_store` and `security_digest` for any value it is not given. It refuses to continue when a required value is missing, and it disables the insecure serializers before it registers anything.

Sources: [celery/security/__init__.py:44-66](repo://celery/security/__init__.py#L44-L66)

The key and certificate are read from their files, and `register_auth` registers the `auth` serializer with them. The registry's default serializer is then set to `auth`, so messages are signed without each call naming the serializer.

Sources: [celery/security/__init__.py:67-70](repo://celery/security/__init__.py#L67-L70), [celery/security/serialization.py:80-90](repo://celery/security/serialization.py#L80-L90)

`disable_untrusted_serializers` calls the kombu function that removes every serializer except the allowed list, so a worker can refuse pickled messages even when `setup_security` is not used.

Sources: [celery/security/__init__.py:73-74](repo://celery/security/__init__.py#L73-L74)

## Keys and certificates

`PrivateKey` loads a PEM private key with the password, and it rejects a key that is not RSA. `Certificate` loads a PEM X.509 certificate, and it rejects one that is not RSA. A certificate reports whether it has expired by comparing the current UTC time with its not-valid-after time, and it returns the public key for verification.

Sources: [celery/security/key.py:12-30](repo://celery/security/key.py#L12-L30), [celery/security/certificate.py:31-55](repo://celery/security/certificate.py#L31-L55)

`CertStore` is a mapping from signer id to certificate. Adding a certificate with an id already in the store raises an error, and looking up an unknown id raises `SecurityError`, so a message from an unknown signer cannot be verified.

Sources: [celery/security/certificate.py:76-99](repo://celery/security/certificate.py#L76-L99)

## Signing and verifying

`SecureSerializer.serialize` serializes the data with the inner serializer and signs the serialized bytes, not the Python object. The receiver can check the signature before it decodes the body, which the code comment gives as a reason for signing the bytes. The packed payload holds the signer id, the signature, the content type, the content encoding and the body.

Sources: [celery/security/serialization.py:31-47](repo://celery/security/serialization.py#L31-L47), [celery/security/serialization.py:60-67](repo://celery/security/serialization.py#L60-L67)

`deserialize` unpacks the payload, looks up the certificate for the signer id in the store, and verifies the signature over the body with the chosen digest. Only after the check passes does it decode the body with the content type it recorded. A failed check raises before any decoding happens.

Sources: [celery/security/serialization.py:49-58](repo://celery/security/serialization.py#L49-L58), [celery/security/serialization.py:68-78](repo://celery/security/serialization.py#L68-L78)

The payload is base64 encoded at each level, and it is split on a separator that the code guarantees does not appear in the serialized data. The split uses at most five parts, so the body keeps any separator bytes it contains.

Sources: [celery/security/serialization.py:14-18](repo://celery/security/serialization.py#L14-L18), [celery/security/serialization.py:68-78](repo://celery/security/serialization.py#L68-L78)
