---
title: "Message Security"
---
## Overview

Celery constrains decoding through serializer acceptance settings and can register the `auth` serializer for signed task payloads. The signing path serializes the task body, signs those bytes and verifies the signature before decoding the inner payload. This sits alongside the publication machinery in [[Task Publishing and Routing]]. Result decoding uses its own backend configuration, covered here only at the trust boundary and otherwise in [[Results and State]].

Sources: [celery/app/amqp.py:317-324](repo://celery/app/amqp.py#L317-L324), [celery/security/serialization.py:31-58](repo://celery/security/serialization.py#L31-L58), [celery/backends/base.py:138-156](repo://celery/backends/base.py#L138-L156)

## Separate serializer selection from acceptance

The producer passes its selected serializer to `publish`; the task consumer passes `accept_content` to its consumer. A producer's encoding choice therefore has a corresponding receiving-side gate. The worker dispatch path explicitly handles `ContentDisallowed` as an invalid task. [[Worker Lifecycle and Concurrency]] describes that invalid-message path and how it differs from decode failure handling.

Sources: [celery/app/amqp.py:317-324](repo://celery/app/amqp.py#L317-L324), [celery/app/amqp.py:565-576](repo://celery/app/amqp.py#L565-L576), [celery/worker/consumer/consumer.py:775-784](repo://celery/worker/consumer/consumer.py#L775-L784)

For result backends, constructor-level `accept` takes precedence, followed by `result_accept_content` and then `accept_content`. The chosen set is normalized by the serializer registry. This lets results and tasks have separate allowed content while sharing the application default when no result-specific policy is supplied. It does not automatically place results inside the task signing envelope; the backend selects `result_serializer` independently.

Sources: [celery/backends/base.py:138-156](repo://celery/backends/base.py#L138-L156)

## Initialize message signing

`app.setup_security` delegates to the security module and documents its effect on the global Kombu serializer registry across application instances. Security setup first disables serializers except allowed exemptions, then checks that `task_serializer` is `auth` and `accept_content` is exactly `['auth']`. A mismatch raises `ImproperlyConfigured`: configuring signature production without requiring verification is explicitly rejected by this setup path.

Sources: [celery/app/base.py:750-780](repo://celery/app/base.py#L750-L780), [celery/security/__init__.py:26-34](repo://celery/security/__init__.py#L26-L34), [celery/security/__init__.py:44-56](repo://celery/security/__init__.py#L44-L56)

| Input | Configuration fallback | Purpose |
| --- | --- | --- |
| `key` | `security_key` | Private-key file used for signing |
| `key_password` | `security_key_password` | Password used when loading the key |
| `cert` | `security_certificate` | Signer's certificate file |
| `store` | `security_cert_store` | Directory or glob of trusted certificate files |
| `digest` | Security digest selection | Hash algorithm used for signatures |
| `serializer` | API default `json` | Inner payload encoding |

Sources: [celery/app/base.py:750-776](repo://celery/app/base.py#L750-L776), [celery/security/__init__.py:58-70](repo://celery/security/__init__.py#L58-L70), [celery/security/certificate.py:100-113](repo://celery/security/certificate.py#L100-L113)

Cryptography must be installed, and key, certificate and certificate store must all be configured. Setup reads the key and certificate files, builds the secure serializer and registers `auth` with content type `application/data` and UTF-8 content encoding. It then makes `auth` the default serializer in the global registry. Apply these settings before depending on signed publication or consumer decoding; [[Applications and Configuration]] explains application configuration timing.

Sources: [celery/security/__init__.py:38-70](repo://celery/security/__init__.py#L38-L70), [celery/security/serialization.py:80-90](repo://celery/security/serialization.py#L80-L90)

## Follow serialization and verification

The serializer encodes the data with its inner serializer, converts the body to bytes and signs that serialized body. Its comment gives the reason for signing encoded bytes: the receiver can verify before decoding potentially unsafe contents. Packing includes signer ID, signature, content type, content encoding and body in a base64 envelope. The signature input is the body bytes; the surrounding metadata fields are packed separately.

Sources: [celery/security/serialization.py:31-46](repo://celery/security/serialization.py#L31-L46), [celery/security/serialization.py:60-77](repo://celery/security/serialization.py#L60-L77)

```mermaid
flowchart LR
  Data["Task data"] --> Encode["Encode inner body"]
  Encode --> Sign["Sign body bytes"]
  Sign --> Pack["Pack signer and payload"]
  Pack --> Unpack["Unpack on receiver"]
  Unpack --> Lookup["Look up trusted certificate"]
  Lookup --> Verify["Verify body signature"]
  Verify --> Decode["Decode inner body"]
```

Sources: [celery/security/serialization.py:31-77](repo://celery/security/serialization.py#L31-L77)

Deserialization unpacks the envelope, looks up the signer in the certificate store and verifies the body signature with that certificate. Only afterward does it call the inner decoder with `force=True`. The implementation supplies signing and verification, while packing uses base64; it does not encrypt the payload. Keep the distinction between authenticity and confidentiality when interpreting what this serializer's implementation guarantees.

Sources: [celery/security/serialization.py:48-77](repo://celery/security/serialization.py#L48-L77)

## Load trusted keys and certificates

Private keys load from PEM, optionally with a password, and must be RSA keys. Certificates also load from PEM and reject non-RSA public keys. Signing and verification use PSS padding with MGF1 and maximum salt length for the selected digest. Digest names resolve to cryptography hash objects; crypto operations run through error wrappers that re-raise configured failures as `SecurityError`.

Sources: [celery/security/key.py:15-35](repo://celery/security/key.py#L15-L35), [celery/security/certificate.py:34-42](repo://celery/security/certificate.py#L34-L42), [celery/security/certificate.py:65-73](repo://celery/security/certificate.py#L65-L73), [celery/security/utils.py:13-28](repo://celery/security/utils.py#L13-L28)

Certificate IDs combine issuer and serial number. Store lookup rejects unknown IDs, and adding a duplicate ID raises. `FSCertStore` expands a directory to a glob, loads each matching certificate and checks expiry at store construction. The verify method performs signature verification; it does not repeat that expiry check on every message. The trust set here is the certificates loaded from the configured store.

Sources: [celery/security/certificate.py:53-113](repo://celery/security/certificate.py#L53-L113)

## Check worker process privileges and result exceptions

The platform privilege check inspects real/effective user and group IDs where the platform provides them, recognizes root and privileged group names, and detects acceptance of pickle-compatible content. It raises for privileged pickle acceptance unless the force-root environment override is present, otherwise warning about privileged execution. Platforms without the required group/user modules return early. These are process-start checks rather than message-signature checks.

Sources: [celery/platforms.py:788-845](repo://celery/platforms.py#L788-L845)

Result exception reconstruction also validates its target. After resolving exception metadata, the backend requires a type derived from `BaseException` before constructing it; otherwise it raises `SecurityError`. The comment identifies the danger of letting stored metadata name an arbitrary callable. This check complements the result serializer acceptance boundary, while exception propagation to the caller remains the responsibility described in [[Results and State]].

Sources: [celery/backends/base.py:474-513](repo://celery/backends/base.py#L474-L513)
