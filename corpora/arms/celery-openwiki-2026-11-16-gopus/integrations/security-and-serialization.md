---
type: integration
title: Serialization and Message Signing
description: How Celery encodes task messages, results and events (serializer and accept_content settings), how exceptions are serialized and safely rebuilt from result backends, and how the 'auth' serializer signs and verifies messages with X.509 certificates and RSA keys.
tags: [serialization, security, accept-content, signing, certificates, exceptions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-c0292f440e0f00e60a1ef94d
    resource: repo://celery/security/__init__.py
  - id: openwiki-source-5e4aaa0fe9e4042b9efeba88
    resource: repo://celery/security/certificate.py
  - id: openwiki-source-0ab93afcd32bbf1db565f1a3
    resource: repo://celery/security/key.py
  - id: openwiki-source-59df33ccfa1705c7a20dcc7b
    resource: repo://celery/security/serialization.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Serialization and Message Signing

Celery delegates the mechanics of encoding to kombu's serializer registry
(`json`, `msgpack`, `yaml`, `pickle`, plus custom registrations); Celery
decides *which* serializers are used and *which content types are accepted*.
Accepting a content type means trusting its decoder with broker or backend
input, so these settings are security relevant.

## Settings

| Setting | Default | Used for |
|---------|---------|----------|
| `task_serializer` | `json` | Encoding task message bodies (`Task.serializer` / `serializer=` override per task/call) |
| `result_serializer` | `json` | Encoding results stored in the backend |
| `event_serializer` | `json` | Monitoring events |
| `accept_content` | `('json',)` | Content types the **worker** accepts for task messages; also the default for results |
| `result_accept_content` | `None` → `accept_content` | Content types accepted when reading results |
| `task_compression`, `result_compression` | none | Optional compression (`gzip`, `bzip2`, ...) |

Enforcement points:

- The worker's task consumer is created with `accept=app.conf.accept_content`
  (`AMQP.TaskConsumer`), and the protocol-v2 body is decoded in the pool by
  `trace_task_ret` with the same accept list. A disallowed type raises
  `ContentDisallowed`; the consumer logs and rejects such messages as invalid
  ([consumer](../architecture/worker/consumer.md)).
- Backends resolve `accept` with precedence: explicit argument →
  `result_accept_content` → `accept_content`.
- Remote control uses `accept_content` and `task_serializer` for the mailbox.

Because JSON is the default, task arguments and return values must be
JSON-serializable; `task_always_eager` round-trips arguments through the
serializer to surface such errors in tests.

## Exception serialization

Results for failed tasks must carry exceptions through non-pickle serializers
(`Backend.prepare_exception` / `exception_to_python`,
`celery/backends/base.py`):

- With `pickle` (the only member of `EXCEPTION_ABLE_CODECS`) the exception is
  made pickleable (`get_pickleable_exception`) and stored as-is. Exceptions
  that cannot be pickled are wrapped in `UnpickleableExceptionWrapper`
  (`celery/utils/serialization.py`).
- Otherwise it is stored as
  `{'exc_type': qualname, 'exc_message': args, 'exc_module': module}`.
- When reading, the class is looked up in **already imported** modules
  (`sys.modules[exc_module]`, walking dotted qualnames). If it cannot be
  found, a placeholder class with the same name is synthesized
  (`create_exception_cls`) so the client still gets a meaningful exception.
- **Security check:** if the resolved object is not a subclass of
  `BaseException`, `SecurityError` is raised instead of calling it. This
  prevents a crafted result (e.g. `exc_module='os'`, `exc_type='system'`)
  in a compromised backend from executing arbitrary callables on the client.

The worker likewise converts exceptions with `get_pickleable_exception` /
`get_pickleable_etype` before sending them back from pool children.

## Message signing: the `auth` serializer

`celery/security/` implements a signing serializer that authenticates task
messages (it does **not** encrypt them). It requires the `cryptography`
package; importing `celery.security` without it raises
`ImproperlyConfigured`.

### Enabling

```python
app.conf.update(
    security_key='/etc/ssl/private/worker.key',
    security_certificate='/etc/ssl/certs/worker.pem',
    security_cert_store='/etc/ssl/certs/*.pem',
    security_digest='sha256',          # default
    task_serializer='auth',
    event_serializer='auth',
    accept_content=['auth'],
)
app.setup_security()
```

`app.setup_security(allowed_serializers=None, key=None, key_password=None,
cert=None, store=None, digest=None, serializer='json')` →
`celery.security.setup_security`:

1. calls kombu's `disable_insecure_serializers(allowed_serializers)`;
2. **requires** `task_serializer == 'auth'` and `accept_content == ['auth']`,
   otherwise raises `ImproperlyConfigured` — signing is pointless if unsigned
   messages are still accepted;
3. requires `security_key`, `security_certificate` and `security_cert_store`;
4. reads the key and certificate files and calls `register_auth(...)`, which
   registers serializer `auth` (content type `application/data`) in kombu;
5. makes `auth` kombu's default serializer.

### Wire format

`SecureSerializer` (`celery/security/serialization.py`):

- **serialize:** encode the data with the inner serializer (default `json`),
  sign the *encoded bytes* with the private key, and pack
  `b64(signer) ␀␁ b64(signature) ␀␁ content_type ␀␁ content_encoding ␀␁ body`
  (separator `\x00\x01`), base64-encoding the whole. The signer id is the
  certificate's `issuer` + serial number.
- **deserialize:** unpack, look up the signer's certificate in the cert
  store, verify the signature over the raw body **before decoding it** (so the
  decoder never sees unauthenticated input), then decode with the declared
  content type.
- Signatures use RSA-PSS with MGF1 and maximum salt length, with the digest
  from `security_digest` (`sha256` by default).
- All crypto errors are re-raised as `celery.exceptions.SecurityError`.

### Keys and certificate store

- `PrivateKey` (`celery/security/key.py`) loads a PEM RSA key, optionally
  password-protected (`security_key_password`).
- `Certificate` (`celery/security/certificate.py`) loads a PEM X.509
  certificate; non-RSA certificates are rejected.
- `FSCertStore(path)` loads every file matching a glob (or every file in a
  directory). It raises `SecurityError` for **expired** certificates and
  duplicate certificate ids; looking up an unknown signer raises
  `SecurityError('Unknown certificate: ...')`.

Every producer and worker needs its own key/certificate, and every node's cert
store must contain the certificates of all nodes it accepts messages from.
Results are not signed by this mechanism; protect the result backend
separately (and keep `result_accept_content` restrictive).

## Tests

- `t/unit/security/` – serializer packing, certificate store, key handling,
  `setup_security` validation.
- `t/unit/backends/test_base.py` – exception (de)serialization including the
  `SecurityError` guard.
- `t/integration/test_security.py`, `t/integration/test_serialization.py`;
  `examples/security/` shows a working configuration.

See also: [Publishing and routing](../workflows/task-publishing-and-routing.md),
[Result backends](../architecture/result-backends.md).
