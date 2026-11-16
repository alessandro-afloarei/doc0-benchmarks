---
title: "Message Security"
---
## Overview

The `auth` serializer signs each task message with the sender's private key and checks the signature on receipt against a certificate store. A worker that verifies only `auth` messages rejects any message that was not signed by a certificate it trusts. The code lives in `celery/security`; this page covers the setup, the signed format and the verification. The send path is in [[Sending Tasks]] and the receive path is in [[Task Execution]].

Sources: [celery/security/__init__.py:44-71](repo://celery/security/__init__.py#L44-L71)

Sources: [celery/security/serialization.py:20-40](repo://celery/security/serialization.py#L20-L40)

## Setup

`setup_security` refuses to run unless the app is configured for the `auth` serializer: `task_serializer` must be `auth` and `accept_content` must be `['auth']`. The message text says why, because signing is useless when unsigned messages are still accepted.

Sources: [celery/security/__init__.py:14-36](repo://celery/security/__init__.py#L14-L36)

Sources: [celery/security/__init__.py:53-56](repo://celery/security/__init__.py#L53-L56)

The key, certificate and certificate store come from the arguments or, when they are not given, from the `security_key`, `security_certificate` and `security_cert_store` settings. All three are required. The key file is opened with its password, the certificate is read, and both are registered as the `auth` serializer, which becomes the default.

Sources: [celery/security/__init__.py:57-71](repo://celery/security/__init__.py#L57-L71)

`setup_security` also calls the kombu function `disable_insecure_serializers` with the allowed list, which turns off the serializers outside that list, so a message in an insecure format is not decoded. `disable_untrusted_serializers` is the same call made on its own.

Sources: [celery/security/__init__.py:1-3](repo://celery/security/__init__.py#L1-L3)

Sources: [celery/security/__init__.py:44-51](repo://celery/security/__init__.py#L44-L51)

Sources: [celery/security/__init__.py:73-74](repo://celery/security/__init__.py#L73-L74)

The app method `Celery.setup_security` is the entry point that calls this module function.

Sources: [celery/app/base.py:750-760](repo://celery/app/base.py#L750-L760)

## Signed format

`SecureSerializer.serialize` serializes the data with the configured serializer, then signs the serialized bytes, not the object. The receiver can therefore check the signature before it decodes the body, which avoids decoding untrusted content.

Sources: [celery/security/serialization.py:31-46](repo://celery/security/serialization.py#L31-L46)

The signed payload carries the signer's certificate id, the signature, the content type, the content encoding and the body. `_pack` base64-encodes the signer and the signature, joins the five fields with the separator `\x00\x01`, and base64-encodes the joined result as a whole.

Sources: [celery/security/serialization.py:17](repo://celery/security/serialization.py#L17)

Sources: [celery/security/serialization.py:60-66](repo://celery/security/serialization.py#L60-L66)

`register_auth` builds the serializer from the key, certificate and store, and registers its `serialize` and `deserialize` methods under the name `auth` with the content type `application/data`.

Sources: [celery/security/serialization.py:80-90](repo://celery/security/serialization.py#L80-L90)

## Verification

`deserialize` unpacks the payload and looks up the signer's certificate in the store. The lookup fails with `SecurityError` when the signer is unknown; the signature is then verified against the body with the configured digest. Only after verification does the body get decoded.

Sources: [celery/security/serialization.py:48-58](repo://celery/security/serialization.py#L48-L58)

Sources: [celery/security/certificate.py:76-98](repo://celery/security/certificate.py#L76-L98)

The store is a directory or a glob of certificate files, each read as a PEM certificate. Loading it reads every file and raises `SecurityError` for an expired certificate, and `setup_security` builds the store, so an expired certificate stops start-up rather than the first message.

Sources: [celery/security/certificate.py:100-112](repo://celery/security/certificate.py#L100-L112)

Sources: [celery/security/certificate.py:31-40](repo://celery/security/certificate.py#L31-L40)
