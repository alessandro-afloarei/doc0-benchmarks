---
title: "Message Signing and Serialization Security"
---
## Overview

A worker runs whatever a message tells it to run, with arguments decoded from the message body, so anyone who can publish to the broker can make workers execute tasks. Celery limits the damage in three layers: workers decode only content types listed in `accept_content` (JSON by default, which cannot carry code); the `pickle` serializer, which can, must be enabled explicitly and is refused for root workers; and the `auth` serializer signs every message with a private key so workers accept only messages signed by a certificate they trust. Broker access control and TLS are configured on the broker and the connection (`broker_use_ssl`), outside these layers.

Sources: [celery/app/defaults.py:13-13](repo://celery/app/defaults.py#L13-L13), [celery/app/defaults.py:66-72](repo://celery/app/defaults.py#L66-L72), [celery/security/__init__.py:1-74](repo://celery/security/__init__.py#L1-L74)

## Serializers and accepted content

### Choosing serializers

Task messages are encoded with `task_serializer`, results with `result_serializer`, and events with `event_serializer`; all default to `json`. Workers decode task bodies only if their content type is in `accept_content` (default `('json',)`), and result readers use `result_accept_content`, falling back to `accept_content`. A message in another format is rejected by the consumer with `ContentDisallowed` ([[Consumer and Event Loop]]); for protocol 2 the check happens in the pool process when the body is decoded ([[Task Tracing and Execution]]).

Sources: [celery/app/defaults.py:205-230](repo://celery/app/defaults.py#L205-L230), [celery/app/trace.py:735-755](repo://celery/app/trace.py#L735-L755), [celery/backends/base.py:142-152](repo://celery/backends/base.py#L142-L152), [celery/app/amqp.py:317-324](repo://celery/app/amqp.py#L317-L324)

| Serializer | Content type | Notes |
| --- | --- | --- |
| `json` | `application/json` | Default; kombu's encoder also handles dates, UUIDs and decimals |
| `msgpack` | `application/x-msgpack` | Compact binary; needs `celery[msgpack]` |
| `yaml` | `application/x-yaml` | Needs `celery[yaml]` |
| `pickle` | `application/x-python-serialize` | Any Python object, and arbitrary code on decode |
| `auth` | `application/data` | Signs another serializer's output; see below |

Sources: [celery/security/serialization.py:80-90](repo://celery/security/serialization.py#L80-L90), [setup.py:12-47](repo://setup.py#L12-L47)

### Why pickle is dangerous

Unpickling can call any importable function, so a single crafted message lets its sender run code on every worker that accepts pickle. Use JSON and pass identifiers instead of objects. When pickle is needed, keep the broker private, and never run such workers as root: `check_privileges` raises `SecurityError` at start-up when `accept_content` includes pickle and the worker runs as root or with a `sudo` or `wheel` group, unless `C_FORCE_ROOT` is set, and warns about root even without pickle.

Sources: [celery/platforms.py:788-845](repo://celery/platforms.py#L788-L845), [celery/apps/worker.py:94-104](repo://celery/apps/worker.py#L94-L104)

The same concern applies to results stored with pickle. With JSON, stored exceptions are rebuilt from their module and class name, and `exception_to_python` raises `SecurityError` if the named class is not an exception, so a forged result cannot instantiate an arbitrary class ([[Result Backends]]).

Sources: [celery/backends/base.py:457-526](repo://celery/backends/base.py#L457-L526)

## Message signing

### Setting it up

`app.setup_security()` (or `celery.security.setup_security`) enables signing for the process. It first disables every serializer kombu considers insecure except those in `allowed_serializers`, then requires `task_serializer = 'auth'` and `accept_content = ['auth']`, because signing without verification would be pointless. It reads `security_key`, `security_key_password`, `security_certificate`, `security_cert_store` and `security_digest` (`sha256`), or the matching arguments, registers the `auth` serializer, and makes it kombu's default. A missing setting raises `ImproperlyConfigured`, and the module refuses to import without the `cryptography` package.

Sources: [celery/app/base.py:750-780](repo://celery/app/base.py#L750-L780), [celery/security/__init__.py:36-74](repo://celery/security/__init__.py#L36-L74), [celery/app/defaults.py:239-245](repo://celery/app/defaults.py#L239-L245)

```python
app.conf.update(
    security_key='ssl/worker.key',
    security_certificate='ssl/worker.pem',
    security_cert_store='ssl/*.pem',
    task_serializer='auth',
    event_serializer='auth',
    accept_content=['auth'],
    result_accept_content=['json'],
)
app.setup_security()
```

Sources: [examples/security/mysecureapp.py:28-44](repo://examples/security/mysecureapp.py#L28-L44)

Every process that sends or receives tasks (clients, workers and beat) must call `setup_security()` with a key, a certificate and the store, since each both signs what it sends and verifies what it receives. The example's header shows generating a key pair with `openssl`.

Sources: [examples/security/mysecureapp.py:1-26](repo://examples/security/mysecureapp.py#L1-L26)

### Signing

`SecureSerializer.serialize` first encodes the data with the inner serializer (`json` by default, the `serializer` argument), then signs the encoded bytes with the RSA private key using PSS padding and the configured digest. Signing the encoded body rather than the Python object means the receiver can verify the signature before decoding anything, so a forged message never reaches a decoder. The result packs the signer's certificate id (issuer and serial number), the signature, the inner content type and encoding, and the body, separated by `\x00\x01` and base64-encoded.

Sources: [celery/security/serialization.py:20-78](repo://celery/security/serialization.py#L20-L78), [celery/security/key.py:12-35](repo://celery/security/key.py#L12-L35)

### Verifying

`deserialize` unpacks the payload, looks up the signer's certificate in the store by id, and verifies the signature over the body; only then does it decode the body with the inner content type. An unknown signer, a bad signature or any cryptography error raises `SecurityError`, and the message is rejected.

Sources: [celery/security/serialization.py:48-58](repo://celery/security/serialization.py#L48-L58), [celery/security/utils.py:19-28](repo://celery/security/utils.py#L19-L28)

### Keys, certificates and the store

`PrivateKey` loads a PEM key, optionally with a password, and accepts only RSA keys. `Certificate` loads a PEM X.509 certificate, again RSA only, and identifies itself by issuer and serial number. `FSCertStore(path)` loads every file matching a path or glob (a directory means all files in it), refuses expired certificates and duplicates with `SecurityError`, and is the set of signers a process trusts. Removing a certificate from the store revokes its holder after the next restart.

Sources: [celery/security/key.py:12-25](repo://celery/security/key.py#L12-L25), [celery/security/certificate.py:31-113](repo://celery/security/certificate.py#L31-L113)

## Related protections

Other parts of Celery limit what leaks or what a message can do.

Sources: [celery/app/utils.py:327-343](repo://celery/app/utils.py#L327-L343)

- `argsrepr` and `kwargsrepr` in the message headers are what workers log and send in events; a task can override them when sending to keep secrets out of logs ([[Calling Tasks and the Message Protocol]]).
- Configuration reports mask keys matching `API`, `TOKEN`, `KEY`, `SECRET`, `PASS`, `SIGNATURE` and `DATABASE`, and passwords in broker and backend URLs ([[Configuration and Loaders]]).
- Remote control commands are broadcast on the broker, so anyone able to publish there can revoke tasks or shut workers down; `worker_enable_remote_control = False` disables the mailbox ([[Remote Control and Inspection]]).

Sources: [celery/app/amqp.py:361-391](repo://celery/app/amqp.py#L361-L391), [celery/app/utils.py:37-40](repo://celery/app/utils.py#L37-L40), [celery/worker/consumer/control.py:31-33](repo://celery/worker/consumer/control.py#L31-L33)
