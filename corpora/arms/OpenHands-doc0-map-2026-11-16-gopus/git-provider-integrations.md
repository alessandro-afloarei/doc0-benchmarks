---
title: "Git Provider Integrations"
---
## Overview

OpenHands works with repositories on GitHub, GitLab and Bitbucket, including self-hosted instances. One class, `ProviderHandler`, sits in front of all three: given the user's provider tokens, it lists and searches repositories, finds branches, builds suggested tasks, fetches repository microagents, produces authenticated clone URLs, and exports the tokens into the sandbox as environment variables. Each provider has a service class implementing the same `GitService` protocol.

Sources: [openhands/integrations/provider.py:105-143](repo://openhands/integrations/provider.py#L105-L143), [openhands/integrations/service_types.py:437-535](repo://openhands/integrations/service_types.py#L437-L535)

The [[Server Application]] exposes these through `/api/user/*` routes for the repository picker, the runtime uses them to clone and to keep tokens fresh ([[Runtime Architecture]]), and the OpenHands MCP server uses the services to open pull requests ([[MCP Tools]]).

Sources: [openhands/server/routes/git.py:35-38](repo://openhands/server/routes/git.py#L35-L38), [openhands/runtime/base.py:324-359](repo://openhands/runtime/base.py#L324-L359), [openhands/server/routes/mcp.py:100-118](repo://openhands/server/routes/mcp.py#L100-L118)

## Tokens

A `ProviderToken` holds the token as a `SecretStr`, the provider's user id and an optional `host` for self-hosted instances; it is immutable. Tokens for a user are a read-only mapping from `ProviderType` (`github`, `gitlab`, `bitbucket`) to `ProviderToken`, and `ProviderHandler` refuses anything that is not a `MappingProxyType`. `CustomSecret` has the same shape for the user's own secrets: a value and a description.

Sources: [openhands/integrations/provider.py:41-103](repo://openhands/integrations/provider.py#L41-L103), [openhands/integrations/service_types.py:20-25](repo://openhands/integrations/service_types.py#L20-L25), [openhands/integrations/provider.py:122-125](repo://openhands/integrations/provider.py#L122-L125)

Where tokens come from depends on the entry point. The web server reads them from the user's secrets store through `UserAuth` ([[Storage]]); `POST /api/add-git-providers` first checks each new token by asking the provider who it belongs to, then saves it, keeping an existing token when the request leaves it blank. The headless runner and CLI read `GITHUB_TOKEN`, `GITLAB_TOKEN` and `BITBUCKET_TOKEN` from the environment.

Sources: [openhands/server/routes/secrets.py:103-150](repo://openhands/server/routes/secrets.py#L103-L150), [openhands/integrations/utils.py:13-40](repo://openhands/integrations/utils.py#L13-L40), [openhands/core/setup.py:92-116](repo://openhands/core/setup.py#L92-L116)

## ProviderHandler

`_get_service(provider)` instantiates the provider's service class with that provider's token, user id and host, plus the external auth id and token used by the hosted server. Most methods either call one selected provider or try every provider the user has a token for and combine the results, skipping providers that fail.

Sources: [openhands/integrations/provider.py:149-160](repo://openhands/integrations/provider.py#L149-L160), [openhands/integrations/provider.py:213-258](repo://openhands/integrations/provider.py#L213-L258)

| Method | Behaviour |
| --- | --- |
| `get_user` | First provider that answers |
| `get_repositories` | One provider, paginated, or all providers combined |
| `search_repositories` | Searches one or all providers; a full repository URL on the provider's host searches public repositories |
| `get_suggested_tasks` | Combined across providers |
| `search_branches`, `get_branches` | The selected provider, or the one `verify_repo_provider` finds |
| `verify_repo_provider` | Tries the named provider, then each provider, until one can see the repository; raises `AuthenticationError` otherwise |
| `get_microagents`, `get_microagent_content` | First provider that returns a result |
| `get_github_installations`, `get_bitbucket_workspaces` | GitHub App installations or Bitbucket workspaces |
| `is_pr_open` | Whether a PR is still open, assuming yes when unsure |

Sources: [openhands/integrations/provider.py:162-258](repo://openhands/integrations/provider.py#L162-L258), [openhands/integrations/provider.py:260-336](repo://openhands/integrations/provider.py#L260-L336), [openhands/integrations/provider.py:447-471](repo://openhands/integrations/provider.py#L447-L471), [openhands/integrations/provider.py:515-612](repo://openhands/integrations/provider.py#L515-L612), [openhands/integrations/provider.py:663-688](repo://openhands/integrations/provider.py#L663-L688)

## Tokens in the sandbox

The agent uses git and the providers' APIs from the sandbox shell, so it needs the tokens there. `get_provider_env_key` names the variable `<provider>_token` (`github_token`, which `add_env_vars` upper-cases to `GITHUB_TOKEN`), and `get_env_vars` returns the tokens keyed by provider or, with `expose_secrets`, as plain strings by variable name.

Sources: [openhands/integrations/provider.py:356-424](repo://openhands/integrations/provider.py#L356-L424), [openhands/integrations/provider.py:442-445](repo://openhands/integrations/provider.py#L442-L445), [openhands/runtime/base.py:245-246](repo://openhands/runtime/base.py#L245-L246)

The runtime adds these variables to the sandbox at start, and `set_event_stream_secrets` registers the same values with the event stream, so a token printed by a command is replaced with `<secret_hidden>` before it is stored or shown ([[Events and Event Stream]]).

Sources: [openhands/runtime/base.py:169-177](repo://openhands/runtime/base.py#L169-L177), [openhands/integrations/provider.py:338-354](repo://openhands/integrations/provider.py#L338-L354), [openhands/server/session/agent_session.py:150-156](repo://openhands/server/session/agent_session.py#L150-L156)

Hosted deployments may rotate tokens. Before each command, the runtime checks with `check_cmd_action_for_provider_token_ref` whether the command mentions a token variable; if so, it asks the handler for the latest tokens with `get_latest=True`, which calls `https://<WEB_HOST>/api/refresh-tokens` with the session API key, then re-exports the variables and updates the masking.

Sources: [openhands/integrations/provider.py:426-440](repo://openhands/integrations/provider.py#L426-L440), [openhands/integrations/provider.py:172-193](repo://openhands/integrations/provider.py#L172-L193), [openhands/runtime/base.py:324-359](repo://openhands/runtime/base.py#L324-L359)

## Cloning

`get_authenticated_git_url` finds which provider can see the repository and builds an HTTPS URL with the token embedded: `https://<token>@host/owner/repo.git` for GitHub, `https://oauth2:<token>@...` for GitLab, and for Bitbucket either `username:app_password@` or `x-token-auth:<token>@`. The host is the token's own `host` when set, otherwise the provider's public domain. Without a token it returns the plain public URL. `Runtime.clone_or_init_repo` clones with this URL.

Sources: [openhands/integrations/provider.py:613-661](repo://openhands/integrations/provider.py#L613-L661), [openhands/runtime/base.py:420-461](repo://openhands/runtime/base.py#L420-L461)

## Provider services

Each provider's service class combines feature mixins (repositories, branches and PRs, features, resolver helpers) over a base that makes authenticated HTTP requests. `GitHubService` calls `https://api.github.com` and its GraphQL endpoint, or `https://<host>/api/v3` for GitHub Enterprise.

Sources: [openhands/integrations/github/github_service.py:26-71](repo://openhands/integrations/github/github_service.py#L26-L71)

Requests send the token as a bearer header. On a 401, if the service supports refreshing, it fetches the latest token and retries once; HTTP errors become `AuthenticationError` (401), `ResourceNotFoundError` (404), `RateLimitError` (429) or `UnknownException`.

Sources: [openhands/integrations/github/service/base.py:30-79](repo://openhands/integrations/github/service/base.py#L30-L79), [openhands/integrations/protocols/http_client.py:60-95](repo://openhands/integrations/protocols/http_client.py#L60-L95), [openhands/integrations/service_types.py:163-191](repo://openhands/integrations/service_types.py#L163-L191)

Each service class can be replaced without code changes: `OPENHANDS_GITHUB_SERVICE_CLS` and its GitLab and Bitbucket equivalents name the implementation that `ProviderHandler` uses.

Sources: [openhands/integrations/github/github_service.py:74-78](repo://openhands/integrations/github/github_service.py#L74-L78), [openhands/integrations/gitlab/gitlab_service.py:78-82](repo://openhands/integrations/gitlab/gitlab_service.py#L78-L82), [openhands/integrations/bitbucket/bitbucket_service.py:63-67](repo://openhands/integrations/bitbucket/bitbucket_service.py#L63-L67)

## Suggested tasks

The home screen suggests work from the user's repositories. GitHub's implementation queries the user's open PRs and issues over GraphQL and labels each PR by what needs doing: merge conflicts, failing checks, unresolved review comments, or an open issue to fix.

Sources: [openhands/integrations/github/service/features.py:22-70](repo://openhands/integrations/github/service/features.py#L22-L70), [openhands/integrations/service_types.py:27-33](repo://openhands/integrations/service_types.py#L27-L33)

When the user starts a conversation from a suggestion, `SuggestedTask.get_prompt_for_task` renders the prompt from a Jinja template per task type, filling provider-specific terms such as "Pull Request" versus "Merge Request", the token variable and the CI system ([[Conversations and Sessions]]).

Sources: [openhands/integrations/service_types.py:41-107](repo://openhands/integrations/service_types.py#L41-L107), [openhands/server/routes/manage_conversations.py:212-214](repo://openhands/server/routes/manage_conversations.py#L212-L214)

## Repository microagents

The microagent management screen lists a repository's microagents without cloning it. `BaseGitService.get_microagents` checks for a `.cursorrules` file and then lists `.md` files in `.openhands/microagents`, or in `microagents` when the repository is itself an organisation's `.openhands` or `openhands-config` repository. `get_microagent_content` fetches one file and parses its triggers ([[Microagents]]).

Sources: [openhands/integrations/service_types.py:244-254](repo://openhands/integrations/service_types.py#L244-L254), [openhands/integrations/service_types.py:397-420](repo://openhands/integrations/service_types.py#L397-L420), [openhands/server/routes/git.py:292-359](repo://openhands/server/routes/git.py#L292-L359)

## API routes

The git routes are registered only in `OSS` mode and each builds a `ProviderHandler` from the request's tokens, raising `AuthenticationError` (HTTP 401) when the user has none.

Sources: [openhands/server/app.py:83-84](repo://openhands/server/app.py#L83-L84), [openhands/server/routes/git.py:38-62](repo://openhands/server/routes/git.py#L38-L62)

| Route | Handler call |
| --- | --- |
| `GET /api/user/installations?provider=` | `get_github_installations` or `get_bitbucket_workspaces` |
| `GET /api/user/repositories` | `get_repositories` |
| `GET /api/user/info` | `get_user` |
| `GET /api/user/search/repositories` | `search_repositories` |
| `GET /api/user/search/branches` | `search_branches` |
| `GET /api/user/suggested-tasks` | `get_suggested_tasks` |
| `GET /api/user/repository/branches` | `get_branches` (paginated) |
| `GET /api/user/repository/{repo}/microagents`, `.../content` | `get_microagents`, `get_microagent_content` |

Sources: [openhands/server/routes/git.py:38-132](repo://openhands/server/routes/git.py#L38-L132), [openhands/server/routes/git.py:167-239](repo://openhands/server/routes/git.py#L167-L239)
