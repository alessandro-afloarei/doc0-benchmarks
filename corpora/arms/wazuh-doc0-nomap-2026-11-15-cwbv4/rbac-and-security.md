---
title: "RBAC and Security"
---
## Overview

Every framework function the REST API exposes is protected by role-based access control. Users are linked to roles, roles to policies and rules, and a policy grants or denies actions (such as `agent:read`) on resources (such as `agent:id:001`). The model lives in a SQLite database managed by SQLAlchemy (`framework/wazuh/rbac/orm.py`); a preprocessor turns a user's policies into a compact permission map that travels in the API token's context; and the `expose_resources` decorator applies that map to each call, filtering the resources a function sees. This page follows those three pieces; the token itself is described on [[Server REST API]].

Sources: [framework/wazuh/rbac/orm.py:39-47](repo://framework/wazuh/rbac/orm.py#L39-L47), [framework/wazuh/rbac/decorators.py:428-500](repo://framework/wazuh/rbac/decorators.py#L428-L500)

## The data model

### Tables

The RBAC database is `rbac.db` in the security directory. Its tables are `users`, `roles`, `policies` and `rules`, the link tables `user_roles`, `roles_policies` and `roles_rules`, and three token blacklists (`users_token_blacklist`, `roles_token_blacklist`, `runas_token_blacklist`). IDs up to 99 (`MAX_ID_RESERVED`) are reserved for default objects, with part of that range kept for cloud deployments.

Sources: [framework/wazuh/rbac/orm.py:39-47](repo://framework/wazuh/rbac/orm.py#L39-L47), [framework/wazuh/rbac/orm.py:81-190](repo://framework/wazuh/rbac/orm.py#L81-L190), [framework/wazuh/rbac/orm.py:245-360](repo://framework/wazuh/rbac/orm.py#L245-L360), [framework/wazuh/rbac/orm.py:438-520](repo://framework/wazuh/rbac/orm.py#L438-L520)

Each table has a manager class (`AuthenticationManager`, `RolesManager`, `PoliciesManager`, `RulesManager`, the relationship managers, and `TokenManager`) used as a context manager. New user and role IDs start above the reserved range unless the caller explicitly asks for a reserved one.

Sources: [framework/wazuh/rbac/orm.py:576-600](repo://framework/wazuh/rbac/orm.py#L576-L600), [framework/wazuh/rbac/orm.py:845-870](repo://framework/wazuh/rbac/orm.py#L845-L870), [framework/wazuh/rbac/orm.py:1110-1135](repo://framework/wazuh/rbac/orm.py#L1110-L1135)

### Policies

A policy is a list of actions, a list of resources and an effect. Resources are written `<type>:<attribute>:<value>`, with `*` as a wildcard and `&` joining a combination that must match together. The default policies in `framework/wazuh/rbac/default/policies.yaml` show the shape:

Sources: [framework/wazuh/rbac/default/policies.yaml:1-35](repo://framework/wazuh/rbac/default/policies.yaml#L1-L35)

```yaml
agents_all:
  description: Grant full access to all agents related functionalities.
  policies:
    resourceless:
      actions: [agent:create, group:create, agent:uninstall]
      resources: ['*:*:*']
      effect: allow
    agents:
      actions: [agent:read, agent:delete, agent:modify_group, agent:reconnect, agent:restart, agent:upgrade]
      resources: ['agent:id:*', 'agent:group:*']
      effect: allow
```

Sources: [framework/wazuh/rbac/default/policies.yaml:3-26](repo://framework/wazuh/rbac/default/policies.yaml#L3-L26)

The default roles are `administrator`, `readonly`, `users_admin`, `agents_readonly`, `agents_admin`, `cluster_readonly` and `cluster_admin`; `relationships.yaml` binds them to the default policies and users.

Sources: [framework/wazuh/rbac/default/roles.yaml:1-22](repo://framework/wazuh/rbac/default/roles.yaml#L1-L22)

## From roles to a permission map

### Getting the roles

`get_permissions(user_id, auth_context)` finds the user's roles in one of two ways. Normally they are the roles linked to the user. With run-as, the API client presents an authorization context (for example, the attributes of a dashboard user from an external identity provider) and the roles are those whose rules match that context. A user without run-as enabled who presents a context is rejected with `WazuhPermissionError(6004)`.

Sources: [framework/wazuh/rbac/preprocessor.py:125-185](repo://framework/wazuh/rbac/preprocessor.py#L125-L185)

### Rules for run-as

Rules are JSON expressions evaluated by `RBAChecker` against the authorization context. `MATCH` succeeds when the rule's clause appears in the context, `MATCH$` requires an exact match, `FIND` and `FIND$` search every level of the context, and `AND`, `OR` and `NOT` combine clauses. A string value starting with `r'` is a regular expression. The default rules give administrator rights to the dashboard's built-in `elastic` and `admin` users.

Sources: [framework/wazuh/rbac/auth_context.py:13-35](repo://framework/wazuh/rbac/auth_context.py#L13-L35), [framework/wazuh/rbac/auth_context.py:326-362](repo://framework/wazuh/rbac/auth_context.py#L326-L362), [framework/wazuh/rbac/default/rules.yaml:1-14](repo://framework/wazuh/rbac/default/rules.yaml#L1-L14)

### Optimizing policies

`optimize_resources` collects the policies of all the user's roles and feeds them, in order, to `PreProcessor.process_policy`. The result is a dictionary of action to resource to effect. When a later policy covers a resource, `remove_previous_elements` drops the earlier entries it overrides; a wildcard removes all earlier specific entries of that resource type. This map is stored in the token payload as `rbac_policies`, together with the `rbac_mode`.

Sources: [framework/wazuh/rbac/preprocessor.py:14-100](repo://framework/wazuh/rbac/preprocessor.py#L14-L100), [framework/wazuh/rbac/preprocessor.py:103-123](repo://framework/wazuh/rbac/preprocessor.py#L103-L123), [api/api/authentication.py:276-282](repo://api/api/authentication.py#L276-L282)

## Enforcing permissions

### The decorator

Public framework functions declare what they need:

Sources: [framework/wazuh/agent.py:203-205](repo://framework/wazuh/agent.py#L203-L205)

```python
@expose_resources(actions=["agent:reconnect"], resources=["agent:id:{agent_list}"],
                  post_proc_kwargs={'exclude_codes': [1701, 1703, 1707]})
def reconnect_agents(agent_list: Union[list, str] = None) -> AffectedItemsWazuhResult:
```

Sources: [framework/wazuh/agent.py:203-205](repo://framework/wazuh/agent.py#L203-L205)

When the function is called, `expose_resources`:

Sources: [framework/wazuh/rbac/decorators.py:450-456](repo://framework/wazuh/rbac/decorators.py#L450-L456)

1. Resolves the resource templates against the call's arguments (`{agent_list}` becomes the requested IDs) with `_get_required_permissions`.
2. Matches them against the permission map in the `rbac` context variable with `_match_permissions`, expanding wildcards into the real resources of the system (all agent IDs, groups, rule files, users, roles, cluster nodes...) with `_expand_resource`.
3. Replaces the argument with only the allowed resources; if the caller asked for nothing, it receives every allowed resource.
4. Runs the function, then the post-processor, which by default (`list_handler`) adds a failed item with `WazuhPermissionError(4000)` for each denied resource.

Sources: [framework/wazuh/rbac/decorators.py:20-80](repo://framework/wazuh/rbac/decorators.py#L20-L80), [framework/wazuh/rbac/decorators.py:256-345](repo://framework/wazuh/rbac/decorators.py#L256-L345), [framework/wazuh/rbac/decorators.py:384-425](repo://framework/wazuh/rbac/decorators.py#L384-L425), [framework/wazuh/rbac/decorators.py:456-500](repo://framework/wazuh/rbac/decorators.py#L456-L500)

So a request for agents `001,002,003` from a user allowed only on `001` returns `001` as affected and `002`, `003` as failed with a permission error, instead of failing the whole request. Resourceless actions (`*:*:*`) either run or raise `WazuhPermissionError(4000)`.

Sources: [framework/wazuh/rbac/decorators.py:459-488](repo://framework/wazuh/rbac/decorators.py#L459-L488)

### White and black modes

`rbac_mode` sets the default. In `white` mode (the default) everything not explicitly allowed is denied. In `black` mode everything is allowed unless denied: `_black_expansion` first grants all required resources, and deny policies then remove them.

Sources: [api/api/configuration.py:28-32](repo://api/api/configuration.py#L28-L32), [framework/wazuh/rbac/decorators.py:143-166](repo://framework/wazuh/rbac/decorators.py#L143-L166), [framework/wazuh/rbac/decorators.py:256-280](repo://framework/wazuh/rbac/decorators.py#L256-L280)

## Token revocation

Changing a user's or role's permissions must invalidate tokens already issued, since they carry the old permission map. Instead of tracking every token, `TokenManager` stores a "not valid before" time per user, per role, and for run-as. `is_token_valid` accepts a token only if its `nbf` is later than each applicable time, and `decode_token` calls it on every request through `check_token`. Changing the RBAC mode or the token lifetime also invalidates outstanding tokens, as [[Server REST API]] describes.

Sources: [framework/wazuh/rbac/orm.py:596-660](repo://framework/wazuh/rbac/orm.py#L596-L660), [api/api/authentication.py:202-242](repo://api/api/authentication.py#L202-L242)

The public functions that manage all of this (users, roles, policies, rules, their links, token revocation, security configuration) are in `framework/wazuh/security.py`, protected by the same decorator with `security:*` actions such as `security:read`, `security:create_user` and `security:edit_run_as`.

Sources: [framework/wazuh/security.py:67-70](repo://framework/wazuh/security.py#L67-L70), [framework/wazuh/security.py:125-165](repo://framework/wazuh/security.py#L125-L165)
