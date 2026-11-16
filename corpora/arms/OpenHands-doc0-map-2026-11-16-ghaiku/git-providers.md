---
title: "Git Provider Integrations"
---
## Overview

OpenHands talks to GitHub, GitLab and Bitbucket through one facade, `ProviderHandler`. The facade holds the user's tokens for each provider, creates the right service for a request, and answers the calls the rest of the code makes: list repositories, list branches, verify repository access, and build an authenticated clone URL. Each provider has its own service class, and the handler chooses the class from the provider type.

Sources: [openhands/integrations/provider.py:105-112](repo://openhands/integrations/provider.py#L105-L112) [openhands/integrations/service_types.py:20-25](repo://openhands/integrations/service_types.py#L20-L25)

## Providers and their domains

`ProviderType` has four values: GitHub, GitLab, Bitbucket and an enterprise SSO type. `PROVIDER_DOMAINS` maps the three public providers to their default domains, `github.com`, `gitlab.com` and `bitbucket.org`. A self-hosted instance is reached through the host recorded on the token.

Sources: [openhands/integrations/service_types.py:20-25](repo://openhands/integrations/service_types.py#L20-L25) [openhands/integrations/provider.py:105-112](repo://openhands/integrations/provider.py#L105-L112) [openhands/integrations/provider.py:149-161](repo://openhands/integrations/provider.py#L149-L161)

## Tokens

`ProviderToken` holds a token value, the user it belongs to and the host it applies to. `from_value` accepts either a `ProviderToken` or a plain dictionary. `_get_latest_provider_token` gets the latest token for a provider, and `_get_service` passes the external token manager to the service it creates.

Sources: [openhands/integrations/provider.py:41-69](repo://openhands/integrations/provider.py#L41-L69) [openhands/integrations/provider.py:172-194](repo://openhands/integrations/provider.py#L172-L194)

`_get_service` builds a service for one provider from its token, the external authentication id and token, the token manager and the token's host. Each call to `_get_service` creates a new service object.

Sources: [openhands/integrations/provider.py:149-161](repo://openhands/integrations/provider.py#L149-L161)

## Repository calls

`get_repositories` takes a sort order, the app mode, an optional provider, paging arguments and an optional installation id.

Sources: [openhands/integrations/provider.py:213-246](repo://openhands/integrations/provider.py#L213-L246)

## Exposing tokens to the sandbox

`get_env_vars` returns the tokens as environment variables for the runtime, one per provider, either as secrets or as plain strings. `set_event_stream_secrets` passes the token values to the event stream as secrets. `check_cmd_action_for_provider_token_ref` detects a command action that refers to a provider token, and the runtime uses that to refresh the token before it runs the action.

Sources: [openhands/integrations/provider.py:338-355](repo://openhands/integrations/provider.py#L338-L355) [openhands/integrations/provider.py:385-425](repo://openhands/integrations/provider.py#L385-L425) [openhands/integrations/provider.py:426-442](repo://openhands/integrations/provider.py#L426-L442)

## The GitHub service

`GitHubService` is a combination of feature mixins: branches, features, pull requests, repositories and the resolver, plus the base and installation classes. The shared base class sends the HTTP requests and GraphQL queries, and it fetches headers with the current token.

Sources: [openhands/integrations/github/github_service.py:21-33](repo://openhands/integrations/github/github_service.py#L21-L33) [openhands/integrations/github/service/base.py:16-38](repo://openhands/integrations/github/service/base.py#L16-L38) [openhands/integrations/github/service/base.py:39-81](repo://openhands/integrations/github/service/base.py#L39-L81) [openhands/integrations/github/service/base.py:82-95](repo://openhands/integrations/github/service/base.py#L82-L95)

The GitLab and Bitbucket services are each a single class. The shared HTTP client interface is defined in `protocols`.

Sources: [openhands/integrations/gitlab/gitlab_service.py:20-24](repo://openhands/integrations/gitlab/gitlab_service.py#L20-L24) [openhands/integrations/bitbucket/bitbucket_service.py:19-23](repo://openhands/integrations/bitbucket/bitbucket_service.py#L19-L23) [openhands/integrations/protocols/http_client.py:19-30](repo://openhands/integrations/protocols/http_client.py#L19-L30)

## Clone URLs

`get_authenticated_git_url` builds an authenticated clone URL for a repository.

Sources: [openhands/integrations/provider.py:613-630](repo://openhands/integrations/provider.py#L613-L630)
