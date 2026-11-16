---
title: "Git Provider Integrations"
---
## Overview

OpenHands works with repositories on GitHub, GitLab and Bitbucket, including self-hosted instances. The `openhands/integrations` package gives the rest of the code one way to talk to all three: `ProviderHandler` holds the user's tokens and picks a provider service per token, and each service implements the same `GitService` protocol for users, repositories, branches, pull requests and microagents.

Sources: [openhands/integrations/provider.py:105-160](repo://openhands/integrations/provider.py#L105-L160), [openhands/integrations/service_types.py:437-531](repo://openhands/integrations/service_types.py#L437-L531)

Three places use it. The git routes in the server list and search repositories and branches for the repository picker, as [[Web Server and REST API]] lists. The runtime uses it to clone with an authenticated URL and to put tokens into the sandbox, as [[Runtime Architecture]] describes. And the [[Issue Resolver]] uses provider-specific clients of its own to read issues and open pull requests.

Sources: [openhands/server/routes/git.py:35-104](repo://openhands/server/routes/git.py#L35-L104), [openhands/runtime/base.py:169-178](repo://openhands/runtime/base.py#L169-L178), [openhands/runtime/base.py:422-427](repo://openhands/runtime/base.py#L422-L427)

## Tokens

A `ProviderToken` holds a `token` (a `SecretStr`), an optional `user_id` and an optional `host` for self-hosted instances. The tokens for a user are a read-only `MappingProxyType` from `ProviderType` (`github`, `gitlab`, `bitbucket`) to `ProviderToken`; `ProviderHandler` refuses any other mapping type. `CustomSecret` is the companion type for user-defined secrets, a value with a description.

Sources: [openhands/integrations/provider.py:41-104](repo://openhands/integrations/provider.py#L41-L104), [openhands/integrations/provider.py:113-125](repo://openhands/integrations/provider.py#L113-L125), [openhands/integrations/service_types.py:20-26](repo://openhands/integrations/service_types.py#L20-L26)

The tokens come from different places by entry point. The web server reads them from the user's secrets store, saved through `POST /api/add-git-providers`. The headless runner and resolver read `GITHUB_TOKEN`, `GITLAB_TOKEN` and `BITBUCKET_TOKEN` from the environment.

Sources: [openhands/server/routes/secrets.py:100-160](repo://openhands/server/routes/secrets.py#L100-L160), [openhands/core/setup.py:96-121](repo://openhands/core/setup.py#L96-L121)

`validate_provider_token` works out which provider a bare token belongs to by trying to fetch the user from GitHub, then GitLab, then Bitbucket, and returning the first that succeeds.

Sources: [openhands/integrations/utils.py:10-61](repo://openhands/integrations/utils.py#L10-L61)

## ProviderHandler

`ProviderHandler` maps each provider to its service class and builds a service on demand from the stored token, user id and host. Most methods try every provider the user has a token for and combine or pick the results:

Sources: [openhands/integrations/provider.py:149-170](repo://openhands/integrations/provider.py#L149-L170)

| Method | Behaviour |
| --- | --- |
| `get_user` | The first provider whose token works; `AuthenticationError` if none |
| `get_repositories` | One provider's page when one is selected, otherwise all repositories from every provider |
| `search_repositories`, `search_branches`, `get_branches` | Search across providers, recognising repository URLs |
| `verify_repo_provider(repo)` | Repository details from the given provider, or the first one that knows it |
| `get_github_installations`, `get_bitbucket_workspaces` | App installations or workspaces to filter by |
| `get_microagents`, `get_microagent_content` | Microagents stored in a repository |
| `get_suggested_tasks` | Work items such as failing checks, merge conflicts and open issues |
| `get_authenticated_git_url(repo)` | A clone URL with the token in it |
| `is_pr_open` | Whether a pull request is still open |

Sources: [openhands/integrations/provider.py:195-300](repo://openhands/integrations/provider.py#L195-L300), [openhands/integrations/provider.py:447-556](repo://openhands/integrations/provider.py#L447-L556), [openhands/integrations/provider.py:613-688](repo://openhands/integrations/provider.py#L613-L688)

`get_authenticated_git_url` first resolves the repository's provider and full name with `verify_repo_provider`, then builds the URL for that provider's domain (or the token's host): `https://<token>@host/repo.git` for GitHub, `https://oauth2:<token>@host/repo.git` for GitLab, and for Bitbucket either `https://<user>:<app password>@...` or `https://x-token-auth:<token>@...` depending on the token's form. Without a token it returns the public URL.

Sources: [openhands/integrations/provider.py:613-661](repo://openhands/integrations/provider.py#L613-L661)

## Tokens in the sandbox

The runtime also gives the agent the tokens themselves: it exports each provider token as an environment variable named `<provider>_token` (`github_token`, upper-cased to `GITHUB_TOKEN` by `add_env_vars`) when it starts.

Sources: [openhands/integrations/provider.py:356-445](repo://openhands/integrations/provider.py#L356-L445), [openhands/runtime/base.py:169-178](repo://openhands/runtime/base.py#L169-L178), [openhands/runtime/base.py:245-246](repo://openhands/runtime/base.py#L245-L246)

Before each command, `check_cmd_action_for_provider_token_ref` looks for those variable names in the command text. When it finds one, the runtime asks `get_env_vars(get_latest=True)` for a fresh token, which `_get_latest_provider_token` fetches from `https://<WEB_HOST>/api/refresh-tokens` with the session API key when `WEB_HOST` is set, then re-exports it and adds it to the event stream's masked secrets with `set_event_stream_secrets`, so the token never appears in stored events.

Sources: [openhands/integrations/provider.py:172-193](repo://openhands/integrations/provider.py#L172-L193), [openhands/integrations/provider.py:338-354](repo://openhands/integrations/provider.py#L338-L354), [openhands/integrations/provider.py:426-440](repo://openhands/integrations/provider.py#L426-L440), [openhands/runtime/base.py:324-359](repo://openhands/runtime/base.py#L324-L359)

## The GitService protocol

`GitService` is the protocol every provider service follows: `get_latest_token`, `get_user`, `search_repositories`, `get_all_repositories`, `get_paginated_repos`, `get_suggested_tasks`, `get_repository_details_from_repo_name`, `get_branches`, `get_paginated_branches`, `search_branches`, `get_microagents`, `get_microagent_content`, `get_pr_details` and `is_pr_open`. The shared models are `User`, `Repository` (with its `git_provider`), `Branch`, `PaginatedBranchesResponse`, `Comment` and `SuggestedTask`.

Sources: [openhands/integrations/service_types.py:437-541](repo://openhands/integrations/service_types.py#L437-L541), [openhands/integrations/service_types.py:116-161](repo://openhands/integrations/service_types.py#L116-L161)

Errors are normalized across providers. `HTTPClient.handle_http_status_error` turns a 401 into `AuthenticationError`, a 404 into `ResourceNotFoundError`, a 429 into `RateLimitError` and anything else into `UnknownException`. A 401 counts as an expired token, and services with refresh enabled fetch a new token and retry the request once.

Sources: [openhands/integrations/protocols/http_client.py:28-99](repo://openhands/integrations/protocols/http_client.py#L28-L99), [openhands/integrations/service_types.py:163-191](repo://openhands/integrations/service_types.py#L163-L191), [openhands/integrations/github/service/base.py:39-80](repo://openhands/integrations/github/service/base.py#L39-L80)

The server maps `AuthenticationError` to a 401 response for the whole app.

Sources: [openhands/server/app.py:67-72](repo://openhands/server/app.py#L67-L72)

## Provider services

Each service is assembled from mixins by feature area (repositories, branches, pull requests, features, and for GitHub and GitLab, resolver helpers) and loaded through `get_impl`, so a deployment can substitute its own class with an environment variable such as `OPENHANDS_GITHUB_SERVICE_CLS`. The [[Enterprise Server]] uses this to add its own token handling.

Sources: [openhands/integrations/github/github_service.py:21-78](repo://openhands/integrations/github/github_service.py#L21-L78), [openhands/integrations/gitlab/gitlab_service.py:20-82](repo://openhands/integrations/gitlab/gitlab_service.py#L20-L82), [openhands/integrations/bitbucket/bitbucket_service.py:19-67](repo://openhands/integrations/bitbucket/bitbucket_service.py#L19-L67)

| Service | Default API | Self-hosted base | Notes |
| --- | --- | --- | --- |
| `GitHubService` | `https://api.github.com` and its GraphQL endpoint | `https://<host>/api/v3` | Bearer token |
| `GitLabService` | `https://gitlab.com/api/v4` and GraphQL | `<host>/api/v4` | Org config repository is `openhands-config` |
| `BitBucketService` | `https://api.bitbucket.org/2.0` | `https://api.<host>/2.0` | Workspaces instead of installations |

Sources: [openhands/integrations/github/github_service.py:44-72](repo://openhands/integrations/github/github_service.py#L44-L72), [openhands/integrations/github/service/base.py:24-36](repo://openhands/integrations/github/service/base.py#L24-L36), [openhands/integrations/gitlab/gitlab_service.py:42-72](repo://openhands/integrations/gitlab/gitlab_service.py#L42-L72), [openhands/integrations/bitbucket/bitbucket_service.py:45-60](repo://openhands/integrations/bitbucket/bitbucket_service.py#L45-L60)

## Microagents and suggested tasks

`BaseGitService.get_microagents` gives the UI a list of a repository's microagents without cloning it: it checks for a `.cursorrules` file and lists the `.md` files in `.openhands/microagents`, or in `microagents` for an organization's `.openhands` or `openhands-config` repository. Each provider supplies only the URLs and how to read a directory listing. These are the same files the runtime loads at conversation start, as [[Microagents]] describes.

Sources: [openhands/integrations/service_types.py:198-256](repo://openhands/integrations/service_types.py#L198-L256), [openhands/integrations/service_types.py:309-420](repo://openhands/integrations/service_types.py#L309-L420)

`SuggestedTask` describes a work item found on the user's repositories (`MERGE_CONFLICTS`, `FAILING_CHECKS`, `UNRESOLVED_COMMENTS`, `OPEN_ISSUE`, `OPEN_PR`, `CREATE_MICROAGENT`), and `get_prompt_for_task` renders the starting prompt for a conversation about it from a Jinja template, using the provider's own words for pull or merge requests.

Sources: [openhands/integrations/service_types.py:27-108](repo://openhands/integrations/service_types.py#L27-L108)
