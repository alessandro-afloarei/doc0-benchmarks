---
title: "Git Provider Integrations"
---
## Overview

OpenHands works on repositories hosted on GitHub, GitLab and Bitbucket. It needs those providers' APIs to list and search the user's repositories and branches, to suggest tasks such as failing pull requests, to read microagents stored in a repository, to open pull requests, and to clone with credentials. Each provider is a service class implementing a common `GitService` protocol, and a `ProviderHandler` holds the user's tokens and fans requests out to the right services.

Sources: [openhands/integrations/service_types.py:437-541](repo://openhands/integrations/service_types.py#L437-L541), [openhands/integrations/provider.py:105-160](repo://openhands/integrations/provider.py#L105-L160)

Tokens are stored as user secrets (see [[Settings, Secrets and User Auth]]); in headless mode they come from `GITHUB_TOKEN`, `GITLAB_TOKEN` and `BITBUCKET_TOKEN`.

Sources: [openhands/core/setup.py:92-116](repo://openhands/core/setup.py#L92-L116)

## Tokens

### ProviderToken

A `ProviderToken` is an immutable record of a `token` (a `SecretStr`), the provider `user_id` and a `host` for self-hosted installations such as GitHub Enterprise or a private GitLab. A user's tokens form a read-only `MappingProxyType` from `ProviderType` to `ProviderToken`, the `PROVIDER_TOKEN_TYPE` passed throughout the server.

Sources: [openhands/integrations/provider.py:41-67](repo://openhands/integrations/provider.py#L41-L67), [openhands/integrations/provider.py:93-102](repo://openhands/integrations/provider.py#L93-L102), [openhands/integrations/service_types.py:20-24](repo://openhands/integrations/service_types.py#L20-L24)

### Tokens in the sandbox

The agent uses tokens through environment variables named `github_token`, `gitlab_token` and `bitbucket_token`, upper-cased when exported. `get_env_vars` returns them, `set_event_stream_secrets` registers their values for masking, and before running a shell command that mentions one of these names the runtime fetches the latest token from the server's refresh endpoint (when `WEB_HOST` and a session id are set) and re-exports it, so long conversations survive token expiry.

Sources: [openhands/integrations/provider.py:338-445](repo://openhands/integrations/provider.py#L338-L445), [openhands/integrations/provider.py:172-193](repo://openhands/integrations/provider.py#L172-L193), [openhands/runtime/base.py:324-359](repo://openhands/runtime/base.py#L324-L359)

### Validating a token

When a user saves a token, `validate_provider_token` works out which provider it belongs to by trying to authenticate with GitHub, then GitLab, then Bitbucket, and the secrets route rejects it if the answer does not match the provider the user chose.

Sources: [openhands/integrations/utils.py:10-61](repo://openhands/integrations/utils.py#L10-L61), [openhands/server/routes/secrets.py:57-101](repo://openhands/server/routes/secrets.py#L57-L101)

## ProviderHandler

### Building services

`ProviderHandler(provider_tokens, external_auth_id, external_auth_token, external_token_manager, session_api_key, sid)` maps each provider to its implementation class and builds a service on demand from that provider's token, user id and host. The classes are `GithubServiceImpl`, `GitLabServiceImpl` and `BitBucketServiceImpl`, each resolved from an environment variable (`OPENHANDS_GITHUB_SERVICE_CLS` and its GitLab and Bitbucket equivalents), which is how the enterprise server substitutes services that refresh OAuth tokens.

Sources: [openhands/integrations/provider.py:113-160](repo://openhands/integrations/provider.py#L113-L160), [openhands/integrations/github/github_service.py:74-78](repo://openhands/integrations/github/github_service.py#L74-L78), [openhands/integrations/gitlab/gitlab_service.py:78-82](repo://openhands/integrations/gitlab/gitlab_service.py#L78-L82), [openhands/integrations/bitbucket/bitbucket_service.py:63-67](repo://openhands/integrations/bitbucket/bitbucket_service.py#L63-L67)

### Fan-out across providers

| Method | Behaviour |
| --- | --- |
| `get_user` | first provider that answers |
| `get_repositories(sort, app_mode, selected_provider, page, per_page, installation_id)` | one provider's page, or all repositories from every provider |
| `search_repositories(selected_provider, query, ...)` | searches public repositories too when the query is a URL on the provider's host |
| `get_suggested_tasks` | tasks from every provider |
| `search_branches`, `get_branches` | branches of a repository |
| `get_github_installations`, `get_bitbucket_workspaces` | GitHub App installations, Bitbucket workspaces |
| `verify_repo_provider(repository, provider)` | finds which provider hosts a repository |
| `get_microagents`, `get_microagent_content` | microagents stored in a repository |
| `is_pr_open` | whether a PR is still open |

Sources: [openhands/integrations/provider.py:162-260](repo://openhands/integrations/provider.py#L162-L260), [openhands/integrations/provider.py:260-336](repo://openhands/integrations/provider.py#L260-L336), [openhands/integrations/provider.py:447-520](repo://openhands/integrations/provider.py#L447-L520), [openhands/integrations/provider.py:515-612](repo://openhands/integrations/provider.py#L515-L612), [openhands/integrations/provider.py:663-688](repo://openhands/integrations/provider.py#L663-L688)

Errors from one provider are logged and skipped in the fan-out methods, so a broken GitLab token does not hide GitHub repositories.

Sources: [openhands/integrations/provider.py:232-245](repo://openhands/integrations/provider.py#L232-L245)

### Cloning with credentials

`get_authenticated_git_url(repo_name)` finds the repository's provider and builds an HTTPS clone URL with the token embedded: `https://<token>@host/...` for GitHub, `https://oauth2:<token>@host/...` for GitLab, and for Bitbucket either `username:app_password@` or `x-token-auth:<token>@`. Without a token it returns the plain URL. The runtime uses this when cloning the selected repository (see [[Runtime Architecture]]).

Sources: [openhands/integrations/provider.py:613-662](repo://openhands/integrations/provider.py#L613-L662), [openhands/runtime/base.py:401-461](repo://openhands/runtime/base.py#L401-L461)

## Provider services

### Composition

Each service class is assembled from mixins by feature area, plus `BaseGitService` and the `GitService` protocol. For GitHub these are branches, features (suggested tasks and microagent content), PRs, repos and resolver helpers; GitLab and Bitbucket follow the same layout.

Sources: [openhands/integrations/github/github_service.py:21-71](repo://openhands/integrations/github/github_service.py#L21-L71), [openhands/integrations/gitlab/gitlab_service.py:1-82](repo://openhands/integrations/gitlab/gitlab_service.py#L1-L82), [openhands/integrations/bitbucket/bitbucket_service.py:1-67](repo://openhands/integrations/bitbucket/bitbucket_service.py#L1-L67)

The GitHub service talks to `api.github.com` and its GraphQL endpoint, or to `https://<host>/api/v3` on a custom host; GitLab uses `/api/v4` on its host, Bitbucket `api.<host>/2.0`. GitHub's `_make_request` retries once with a refreshed token when the response says the token expired, returns the JSON and the `Link` header for pagination, and maps HTTP failures to `AuthenticationError`, `RateLimitError`, `ResourceNotFoundError` or `UnknownException`.

Sources: [openhands/integrations/github/github_service.py:44-67](repo://openhands/integrations/github/github_service.py#L44-L67), [openhands/integrations/gitlab/gitlab_service.py:42-70](repo://openhands/integrations/gitlab/gitlab_service.py#L42-L70), [openhands/integrations/bitbucket/bitbucket_service.py:50-58](repo://openhands/integrations/bitbucket/bitbucket_service.py#L50-L58), [openhands/integrations/github/service/base.py:36-80](repo://openhands/integrations/github/service/base.py#L36-L80), [openhands/integrations/service_types.py:163-191](repo://openhands/integrations/service_types.py#L163-L191)

### Shared data types

`Repository` (id, full name, provider, visibility, stars, pushed date, owner type, main branch), `Branch`, `User` and `Comment` are provider-neutral models returned by every service, so the frontend and the agent never deal with provider-specific JSON.

Sources: [openhands/integrations/service_types.py:116-160](repo://openhands/integrations/service_types.py#L116-L160)

### Suggested tasks

`get_suggested_tasks` looks for work the user could hand to the agent: on GitHub, a GraphQL query lists the user's open pull requests with merge conflicts, failing checks or unresolved review comments, and their assigned open issues. Each `SuggestedTask` renders a ready-made prompt with `get_prompt_for_task`, using provider terms such as "Pull Request" or "Merge Request", the API name and the token variable.

Sources: [openhands/integrations/github/service/features.py:22-60](repo://openhands/integrations/github/service/features.py#L22-L60), [openhands/integrations/service_types.py:27-108](repo://openhands/integrations/service_types.py#L27-L108)

### Microagents in a repository

`BaseGitService.get_microagents` lists a repository's microagents through the API, without cloning: a `.cursorrules` file, then the Markdown files in `.openhands/microagents`, or in `microagents/` for an organization's `.openhands` or `openhands-config` repository. Contents are fetched separately with `get_microagent_content` and parsed for triggers. Each provider supplies only the URLs and how to read its directory listing.

Sources: [openhands/integrations/service_types.py:198-254](repo://openhands/integrations/service_types.py#L198-L254), [openhands/integrations/service_types.py:397-420](repo://openhands/integrations/service_types.py#L397-L420)

### Pull requests

`create_pr` on the GitHub service (and `create_mr` on GitLab, `create_pr` on Bitbucket) opens a pull request with branches, title, body, draft flag and labels. The agent reaches these through the OpenHands MCP server's tools (see [[MCP Integration]]); the [[Issue Resolver]] has its own implementation.

Sources: [openhands/integrations/github/service/prs.py:11-66](repo://openhands/integrations/github/service/prs.py#L11-L66), [openhands/server/routes/mcp.py:83-149](repo://openhands/server/routes/mcp.py#L83-L149)

## REST routes

The `/api/user` routes are only mounted in OSS mode; the enterprise server provides its own. Each builds a `ProviderHandler` from the request's provider tokens and the user's access token and id, and answers 401 when the user has no provider token.

Sources: [openhands/server/app.py:83-84](repo://openhands/server/app.py#L83-L84), [openhands/server/routes/git.py:65-102](repo://openhands/server/routes/git.py#L65-L102)

| Route | Calls |
| --- | --- |
| `GET /api/user/installations` | GitHub installations or Bitbucket workspaces |
| `GET /api/user/repositories` | `get_repositories` |
| `GET /api/user/info` | `get_user` |
| `GET /api/user/search/repositories`, `/search/branches` | search |
| `GET /api/user/suggested-tasks` | `get_suggested_tasks` |
| `GET /api/user/repository/branches` | paginated branches |
| `GET /api/user/repository/{name}/microagents`, `/microagents/content` | repository microagents |

Sources: [openhands/server/routes/git.py:35-64](repo://openhands/server/routes/git.py#L35-L64), [openhands/server/routes/git.py:105-170](repo://openhands/server/routes/git.py#L105-L170), [openhands/server/routes/git.py:167-240](repo://openhands/server/routes/git.py#L167-L240), [openhands/server/routes/git.py:292-360](repo://openhands/server/routes/git.py#L292-L360)
