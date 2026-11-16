---
title: "Git Providers"
---
## Overview

OpenHands talks to GitHub, GitLab and Bitbucket through one object, `ProviderHandler`. It is created with the user's tokens for each provider, asks each provider's service for what it needs, and never lets a caller pick a service class directly. The handler also decides which provider tokens reach the sandbox as environment variables. The automated issue flow that uses this handler is in [[Issue Resolver]].

Sources: [openhands/integrations/provider.py:105-143](repo://openhands/integrations/provider.py#L105-L143), [openhands/integrations/service_types.py:20-24](repo://openhands/integrations/service_types.py#L20-L24)

## Services and tokens

`ProviderType` has `github`, `gitlab`, `bitbucket` and `enterprise_sso`. The handler maps the first three to a service class. Each class is loaded with `get_impl`, and the environment variables `OPENHANDS_GITHUB_SERVICE_CLS`, `OPENHANDS_GITLAB_SERVICE_CLS` and `OPENHANDS_BITBUCKET_SERVICE_CLS` can name a different implementation. The `enterprise_sso` type has no service class in this package.

Sources: [openhands/integrations/provider.py:127-131](repo://openhands/integrations/provider.py#L127-L131), [openhands/integrations/github/github_service.py:74-78](repo://openhands/integrations/github/github_service.py#L74-L78), [openhands/integrations/bitbucket/bitbucket_service.py:62-67](repo://openhands/integrations/bitbucket/bitbucket_service.py#L62-L67)

The `provider_tokens` mapping must be a `MappingProxyType`, and anything else is refused with a `TypeError`. Each token is a `ProviderToken` with the token value, the user id and the host, so a self-hosted server can be addressed. `_get_service` builds the service from one entry of that mapping and passes the external auth data along.

Sources: [openhands/integrations/provider.py:122-125](repo://openhands/integrations/provider.py#L122-L125), [openhands/integrations/provider.py:149-160](repo://openhands/integrations/provider.py#L149-L160), [openhands/integrations/provider.py:41-50](repo://openhands/integrations/provider.py#L41-L50), [openhands/integrations/gitlab/gitlab_service.py:77-82](repo://openhands/integrations/gitlab/gitlab_service.py#L77-L82)

Each service implements the `GitService` protocol. Its methods cover the user, the repositories, paginated repository lists, and the details of a repository named as `owner/name`. The service modules split branches, pull requests, repositories and features into separate files.

Sources: [openhands/integrations/service_types.py:437-445](repo://openhands/integrations/service_types.py#L437-L445), [openhands/integrations/service_types.py:456-500](repo://openhands/integrations/service_types.py#L456-L500), [openhands/integrations/github/service/base.py:1-30](repo://openhands/integrations/github/service/base.py#L1-L30)

## Choosing a provider

`get_user` asks each provider in turn and returns the first user it finds, and raises `AuthenticationError` when none answers. `get_repositories` asks one provider when one is named and pages through it. Without a name, it asks every provider and merges the results, logging a warning for any provider that fails.

Sources: [openhands/integrations/provider.py:162-170](repo://openhands/integrations/provider.py#L162-L170), [openhands/integrations/provider.py:213-246](repo://openhands/integrations/provider.py#L213-L246)

`verify_repo_provider` checks a repository's URL or name against the named provider first, then against the others. It returns the first repository details that succeed. If all fail, it logs every error and raises `AuthenticationError`. The conversation start route uses this check before it creates a conversation.

Sources: [openhands/integrations/provider.py:447-470](repo://openhands/integrations/provider.py#L447-L470), [openhands/server/routes/manage_conversations.py:243-247](repo://openhands/server/routes/manage_conversations.py#L243-L247)

## Tokens in the sandbox

`get_env_vars` returns the tokens of the requested providers, or of all providers. Each token goes under a variable named after the provider with `_token` appended, in lower case. With `get_latest` set and a refresh URL configured, the handler fetches a fresh token from the web service first, using the session key.

Sources: [openhands/integrations/provider.py:385-423](repo://openhands/integrations/provider.py#L385-L423), [openhands/integrations/provider.py:443-445](repo://openhands/integrations/provider.py#L443-L445), [openhands/integrations/provider.py:172-193](repo://openhands/integrations/provider.py#L172-L193)

`set_event_stream_secrets` puts the exposed values in the event stream's secrets, so they are masked when events are stored. `expose_env_vars` turns the secret values into plain strings for the runtime.

Sources: [openhands/integrations/provider.py:338-366](repo://openhands/integrations/provider.py#L338-L366), [openhands/events/stream.py:215-219](repo://openhands/events/stream.py#L215-L219)

Before a command runs, the runtime checks whether it names a provider's variable. `check_cmd_action_for_provider_token_ref` looks at each `CmdRunAction` for those names. If one is found, the runtime refreshes the tokens for those providers and exports them again.

Sources: [openhands/integrations/provider.py:426-441](repo://openhands/integrations/provider.py#L426-L441), [openhands/runtime/base.py:324-348](repo://openhands/runtime/base.py#L324-L348)

The runtime side of this check is part of [[Runtime Interface]], and the masking of secrets in stored events is part of [[Events and the Event Stream]].

Sources: [openhands/runtime/base.py:361-368](repo://openhands/runtime/base.py#L361-L368), [openhands/events/stream.py:221-244](repo://openhands/events/stream.py#L221-L244)
