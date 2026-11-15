# Files

- [Message Signing (auth serializer)](message-signing.md) - How Celery's optional `auth` serializer signs task messages with an RSA private key and verifies them against a filesystem store of X.509 certificates. Covers setup_security preconditions, the wire format, the digest and PSS padding, certificate store rules, related settings, and what signing does and does not protect.
