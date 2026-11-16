---
title: "Git Provider Integrations"
---
## Overview

OpenHands works with repositories hosted on GitHub, GitLab and Bitbucket. The `ProviderHandler` is the one object that the rest of the code uses for this. It holds the user's tokens for each provider, picks the service that talks to that provider's API, and answers the questions the interface and the runtime ask: who the user is, which repositories and branches exist, which microagents a repository has, and what URL to clone. Each provider's API calls are in its own service class. The issue resolver calls the same handler, as described on [[Issue Resolver]].

Sources: [openhands/integrations/provider.py:105-144](repo://openhands/integrations/provider.py#L105-L144), [openhands/integrations/service_types.py:20-26](repo://openhands/integrations/service_types.py#L20-L26)

## Tokens

A `ProviderToken` holds the token as a secret, the user ID on the provider, and an optional host for self-hosted instances. `ProviderHandler` requires its tokens as an immutable mapping keyed by provider type, and raises a `TypeError` for any other container. A dictionary from a request is converted into a `ProviderToken` by `from_value`.

Sources: [openhands/integrations/provider.py:41-69](repo://openhands/integrations/provider.py#L41-L69), [openhands/integrations/provider.py:113-128](repo://openhands/integrations/provider.py#L113-L128)

The handler creates a service only when it needs one. `_get_service` takes the token for the provider and builds the matching class, passing the user ID, the token, the host and any external authentication. The three classes are registered in a table at construction: GitHub, GitLab and Bitbucket.

Sources: [openhands/integrations/provider.py:129-160](repo://openhands/integrations/provider.py#L129-L160)

When a token is refreshed through an external auth service, the handler asks for the latest token before exporting it to the runtime. The refresh endpoint is set from the `WEB_HOST` environment variable, and without it the handler uses the stored token as it is.

Sources: [openhands/integrations/provider.py:385-425](repo://openhands/integrations/provider.py#L385-L425), [openhands/integrations/provider.py:136-144](repo://openhands/integrations/provider.py#L136-L144)

## Environment variables and masking

`get_env_vars` returns the tokens as environment variables for the sandbox, named by a fixed key for each provider. By default the values are `SecretStr` objects, and they are revealed only when the caller asks for plain strings. The variables are passed to the runtime when it starts, so the agent's shell can use them.

Sources: [openhands/integrations/provider.py:385-425](repo://openhands/integrations/provider.py#L385-L425), [openhands/integrations/provider.py:443-446](repo://openhands/integrations/provider.py#L443-L446)

`set_event_stream_secrets` gives the event stream the token values, so that they are replaced by `<secret_hidden>` before any event is stored. This is the masking path described on [[Event Stream]].

Sources: [openhands/integrations/provider.py:338-355](repo://openhands/integrations/provider.py#L338-L355), [openhands/events/stream.py:221-244](repo://openhands/events/stream.py#L221-L244)

`check_cmd_action_for_provider_token_ref` looks at each shell command and reports which providers' variables the command names. The runtime uses this to know which tokens an action needs.

Sources: [openhands/integrations/provider.py:426-442](repo://openhands/integrations/provider.py#L426-L442)

## Repository queries

`get_repositories` and `search_repositories` list repositories for the user, with the duplicates removed across providers. `get_branches` pages through a repository's branches. `verify_repo_provider` decides which provider a repository URL belongs to, and `_is_repository_url` tells a search string that is a URL from a plain name.

Sources: [openhands/integrations/provider.py:213-246](repo://openhands/integrations/provider.py#L213-L246), [openhands/integrations/provider.py:287-337](repo://openhands/integrations/provider.py#L287-L337), [openhands/integrations/provider.py:447-514](repo://openhands/integrations/provider.py#L447-L514)

`get_microagents` lists the microagent files in a repository, and `get_microagent_content` fetches one, so that the microagents of a repository can be read without cloning it. The file formats are on [[Microagents]].

Sources: [openhands/integrations/provider.py:515-612](repo://openhands/integrations/provider.py#L515-L612)

`get_authenticated_git_url` builds the URL the runtime clones from. It verifies that the repository is reachable with the token, then puts the token into the URL for GitLab as `oauth2`, and for Bitbucket in the form the token uses. Without a token it returns the public HTTPS URL. A failed authentication is raised as a plain exception that the runtime reports.

Sources: [openhands/integrations/provider.py:613-662](repo://openhands/integrations/provider.py#L613-L662), [openhands/runtime/base.py:401-430](repo://openhands/runtime/base.py#L401-L430)

## Services

Each service inherits from `BaseGitService`, which holds the request helper and the abstract methods every provider must implement. The GitHub service is composed from modules for repositories, branches and pull requests, and for features and the resolver; the GitLab and Bitbucket services follow the same protocol.

Sources: [openhands/integrations/service_types.py:198-230](repo://openhands/integrations/service_types.py#L198-L230), [openhands/integrations/github/github_service.py:1-40](repo://openhands/integrations/github/github_service.py#L1-L40)

The errors that the services raise are defined once in `service_types`. `AuthenticationError` covers a rejected token, `RateLimitError` a provider rate limit, `ResourceNotFoundError` a missing repository or file, and `UnknownException` any other failure. The server turns `AuthenticationError` into a 401 response, as described on [[Server Application]].

Sources: [openhands/integrations/service_types.py:163-192](repo://openhands/integrations/service_types.py#L163-L192), [openhands/server/app.py:68-72](repo://openhands/server/app.py#L68-L72)
