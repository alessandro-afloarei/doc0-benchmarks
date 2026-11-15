---
title: "Server REST API"
---
## Overview

`wazuh-apid` serves the Wazuh REST API, by default over HTTPS on port 55000. It is a thin HTTP layer: an OpenAPI specification (`api/api/spec/spec.yaml`) defines every endpoint and maps it to a controller function, controllers turn request parameters into a call to a framework function through the distributed API, and the result or exception is rendered as JSON. The business logic lives in the [[Python Framework]]; who may call what is decided by [[RBAC and Security]].

Sources: [api/api/configuration.py:34-75](repo://api/api/configuration.py#L34-L75), [api/scripts/wazuh_apid.py:119-180](repo://api/scripts/wazuh_apid.py#L119-L180)

## Startup

`start(params)` in `api/scripts/wazuh_apid.py` builds the server:

Sources: [api/scripts/wazuh_apid.py:119-135](repo://api/scripts/wazuh_apid.py#L119-L135)

1. Create the executor pools stored in `common.mp_pools`: a one-process `process_pool` for framework requests and an `events_pool` for event ingestion, falling back to a single `thread_pool` when the process cannot use `/dev/shm`. The pools are warmed up so their worker processes exist before the first request.
2. Create a Connexion `AsyncApp` from `spec.yaml` with strict request validation (responses are not validated), Swagger UI disabled, and Wazuh's own URI parser.
3. Add middlewares and error handlers (below).
4. Run it with uvicorn, with the TLS options from `configure_ssl`; an address already in use stops with `APIError(2010)`.

Sources: [api/scripts/wazuh_apid.py:137-180](repo://api/scripts/wazuh_apid.py#L137-L180), [api/scripts/wazuh_apid.py:207-226](repo://api/scripts/wazuh_apid.py#L207-L226)

`configure_ssl` generates a private key and a self-signed certificate on first start when the configured files do not exist, maps `ssl_protocol` (`auto`, `tls`, `tlsv1.2`, ...; TLS 1.0 and 1.1 log a deprecation warning), requires client certificates when `use_ca` is set, and applies the cipher list.

Sources: [api/scripts/wazuh_apid.py:38-100](repo://api/scripts/wazuh_apid.py#L38-L100)

## Request pipeline

### Middlewares

Each request passes through these layers before reaching a controller:

Sources: [api/scripts/wazuh_apid.py:180-206](repo://api/scripts/wazuh_apid.py#L180-L206)

| Middleware | Purpose |
| --- | --- |
| `CheckRateLimitsMiddleware` | Count requests per minute (general and events) and answer 429 over `access.max_request_per_minute` |
| `CheckExpectHeaderMiddleware` | Validate `Expect: 100-continue` uploads |
| `CheckBlockedIP` | Refuse IPs blocked after too many failed logins |
| `WazuhAccessLoggerMiddleware` | Log each request with user, method, path, body and timing; count failed logins |
| `SecureHeadersMiddleware` | Add security headers to responses |
| `ContentSizeLimitMiddleware` | Enforce `max_upload_size` |
| CORS | When `cors.enabled` |

Sources: [api/api/middlewares.py:184-290](repo://api/api/middlewares.py#L184-L290)

A login answered with 403 logs "IP blocked due to exceeded number of logins attempts"; once an IP reaches `access.max_login_attempts`, `check_blocked_ip` rejects its requests until `access.block_time` seconds have passed.

Sources: [api/api/middlewares.py:100-140](repo://api/api/middlewares.py#L100-L140), [api/api/configuration.py:68-72](repo://api/api/configuration.py#L68-L72)

### Authentication

`spec.yaml` declares two security schemes. Basic authentication is only used to obtain a token (`check_user`); every other endpoint uses a bearer JWT validated by `decode_token`.

Sources: [api/api/spec/spec.yaml:5493-5503](repo://api/api/spec/spec.yaml#L5493-L5503)

```yaml
securitySchemes:
  basicAuth:
    type: http
    scheme: basic
    x-basicInfoFunc: api.authentication.check_user
  jwt:
    type: http
    scheme: bearer
    bearerFormat: JWT
    x-bearerInfoFunc: api.authentication.decode_token
```

Sources: [api/api/spec/spec.yaml:5493-5503](repo://api/api/spec/spec.yaml#L5493-L5503)

`check_user` checks the password through the DAPI on the master (`check_user_master`). `generate_token` signs an ES512 JWT with the manager's key pair, carrying the user, its RBAC roles, the RBAC mode, `nbf`/`exp` from `auth_token_exp_timeout`, and a `run_as` flag. `decode_token` verifies the signature and audience, asks the master (`check_token`) whether the token is still valid for that user and roles, attaches the user's processed RBAC policies to the payload, and rejects tokens issued under a different RBAC mode or expiration setting, so changing security settings invalidates outstanding tokens.

Sources: [api/api/authentication.py:36-92](repo://api/api/authentication.py#L36-L92), [api/api/authentication.py:159-198](repo://api/api/authentication.py#L159-L198), [api/api/authentication.py:243-300](repo://api/api/authentication.py#L243-L300)

## Controllers

Each `operationId` in the spec names a function in `api/api/controllers/*_controller.py` (agents, rules, decoders, syscheck, syscollector, SCA, MITRE, cluster, manager, security, tasks, events, logtest, ...). A controller collects parameters, wraps the framework function in a `DistributedAPI` with the request type that function needs and the caller's RBAC policies from the token, awaits it, and returns JSON:

Sources: [api/api/spec/spec.yaml:7357-7380](repo://api/api/spec/spec.yaml#L7357-L7380), [api/api/controllers/agent_controller.py:186-196](repo://api/api/controllers/agent_controller.py#L186-L196)

```python
dapi = DistributedAPI(f=agent.get_agents,
                      f_kwargs=remove_nones_to_dict(f_kwargs),
                      request_type='local_master',
                      is_async=False,
                      wait_for_complete=wait_for_complete,
                      logger=logger,
                      rbac_permissions=request.context['token_info']['rbac_policies']
                      )
data = raise_if_exc(await dapi.distribute_function())

return json_response(data, pretty=pretty)
```

Sources: [api/api/controllers/agent_controller.py:186-196](repo://api/api/controllers/agent_controller.py#L186-L196)

The `wait_for_complete` query parameter lifts the request timeout (`intervals.request_timeout`, 10 seconds by default) for long operations. How DAPI picks the node is on [[Python Framework]] and [[Cluster]].

Sources: [api/api/configuration.py:41-43](repo://api/api/configuration.py#L41-L43), [framework/wazuh/core/cluster/dapi/dapi.py:270-276](repo://framework/wazuh/core/cluster/dapi/dapi.py#L270-L276)

## Errors

DAPI returns exceptions instead of raising them. `raise_if_exc` converts a returned exception into a problem response with the status that matches its class:

Sources: [api/api/util.py:378-394](repo://api/api/util.py#L378-L394)

| Exception | Status |
| --- | --- |
| `WazuhInternalError` (and subclasses) | 500 |
| `WazuhPermissionError` | 403 |
| `WazuhResourceNotFound` | 404 |
| `WazuhTooManyRequests` | 429 |
| `WazuhError` | 400 |

Sources: [api/api/util.py:337-375](repo://api/api/util.py#L337-L375)

Error handlers registered at startup format `ProblemException`, `HTTPException`, unauthorized and failed-expectation errors into the same JSON problem shape.

Sources: [api/scripts/wazuh_apid.py:207-212](repo://api/scripts/wazuh_apid.py#L207-L212)

## Configuration

`api/api/configuration.py` holds the defaults that `api.yaml` overrides: `host` (`0.0.0.0` and `::`), `port` (55000), `drop_privileges`, `experimental_features`, `max_upload_size` (10 MiB), `authentication_pool_size`, `intervals.request_timeout`, `https` (enabled, key, cert, CA, protocol, ciphers), `logs` (level, plain or JSON, rotation by size), `cors`, `access` (login attempts, block time, requests per minute), and `upload_configuration`, which controls whether uploaded configuration may contain remote commands for `localfile` and `wodle command`. The merged configuration is validated against a JSON schema.

Sources: [api/api/configuration.py:34-80](repo://api/api/configuration.py#L34-L80), [api/api/configuration.py:290-340](repo://api/api/configuration.py#L290-L340)
