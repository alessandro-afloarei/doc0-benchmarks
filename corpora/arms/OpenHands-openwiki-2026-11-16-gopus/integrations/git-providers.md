---
type: integration
title: Git Provider Integrations
description: How OpenHands integrates with GitHub, GitLab, and Bitbucket — immutable provider tokens, the ProviderHandler facade, per-provider service classes and override hooks, repository/branch/suggested-task/microagent APIs, authenticated clone URLs, and how tokens reach the sandbox while staying masked in events.
tags: [git, github, gitlab, bitbucket, provider-tokens, integrations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-531d73b66cc74d76d18cbbeb
    resource: repo://openhands/integrations/bitbucket/bitbucket_service.py
  - id: openwiki-source-6554cc3bf57225936e6294f8
    resource: repo://openhands/integrations/github/github_service.py
  - id: openwiki-source-e8601b34b24d2b0f5e57e6a7
    resource: repo://openhands/integrations/gitlab/gitlab_service.py
  - id: openwiki-source-20d30eb50754232cae150363
    resource: repo://openhands/integrations/provider.py
  - id: openwiki-source-8359632df7bdabd0aadc77fe
    resource: repo://openhands/integrations/service_types.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-7c92f7b75c88c1cf3ef2d452
    resource: repo://openhands/server/routes/git.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Git Provider Integrations

`openhands/integrations/` lets OpenHands list a user's repositories, clone them into the sandbox, suggest tasks (failing checks, merge conflicts, review comments, open issues), read repository microagents, and give the agent tokens to push branches and open PRs.

## Tokens

- `ProviderType` (`service_types.py`): `github`, `gitlab`, `bitbucket`, plus `enterprise_sso`.
- `ProviderToken` (`provider.py`) is a **frozen** pydantic model: `token: SecretStr`, `user_id`, `host` (for self-hosted GitHub Enterprise / GitLab / Bitbucket domains).
- Collections are `MappingProxyType[ProviderType, ProviderToken]` (`PROVIDER_TOKEN_TYPE`) — `ProviderHandler.__init__` rejects anything else, so token maps can't be mutated after construction (`tests/unit/integrations/test_provider_immutability.py`).
- `CustomSecret` / `CUSTOM_SECRETS_TYPE` model user-defined secrets with descriptions.

In OSS, users add tokens in **Settings → Integrations** and they're persisted by the secrets store; in SaaS they come from OAuth via the token manager ([Enterprise](../enterprise/saas-server.md)).

## ProviderHandler

`ProviderHandler(provider_tokens, external_auth_id, external_auth_token, external_token_manager, session_api_key, sid)` is the single facade the server and runtime use:

- `_get_service(provider)` instantiates the provider's service with that token's `user_id`, token, and `host`.
- **Fan-out with fallback:** `get_user` returns the first provider that succeeds; `get_repositories` returns one provider's paginated repos when `selected_provider` is given, otherwise concatenates all providers' repos (logging and skipping failing providers); `get_suggested_tasks`, `search_repositories`, and `search_branches` aggregate similarly; `verify_repo_provider(repo)` tries the specified provider then every configured provider, raising `AuthenticationError` if none can access it.
- `get_authenticated_git_url(owner/repo)` resolves the provider and builds a clone URL embedding the token: `https://<token>@github.com/...`, `https://oauth2:<token>@gitlab.com/...`, Bitbucket `https://user:app_password@...` or `https://x-token-auth:<token>@...`; the token's `host` overrides the default domain; without a token it returns the public HTTPS URL.
- `get_microagents` / `get_microagent_content` read `.openhands/microagents/` (and `.cursorrules`) via provider APIs for the UI ([Microagents](../concepts/microagents.md)).
- `is_pr_open`, `get_branches`, `get_github_installations`, `get_bitbucket_workspaces`.

### Tokens in the sandbox and in events

- Env var keys are `<provider>_token` (`get_provider_env_key`); `Runtime.add_env_vars` upper-cases them, so the sandbox sees `GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_TOKEN`. `get_env_vars(expose_secrets=...)` returns typed or plain values.
- The `Runtime` creates its own `ProviderHandler` and adds the token env vars to its initial environment; `clone_or_init_repo` uses `get_authenticated_git_url` ([Runtime Architecture](../runtime/runtime-architecture.md)).
- `set_event_stream_secrets(event_stream)` registers token values as event-stream secrets so any occurrence is replaced with `<secret_hidden>` before persistence/broadcast ([Event Stream](../architecture/event-stream.md#adding-an-event)).
- **Token refresh:** before running a `CmdRunAction` that references a provider token env var (`check_cmd_action_for_provider_token_ref`), the runtime calls `get_env_vars(get_latest=True)`. When `WEB_HOST` is set, this fetches a fresh token from `https://{WEB_HOST}/api/refresh-tokens` using the session API key and `sid`, then re-exports it to the sandbox and updates event-stream secrets. This keeps short-lived OAuth tokens (SaaS) working in long conversations.

## Provider services

Each provider is a class assembled from feature mixins:

- **GitHub** — `github/github_service.py:GitHubService` composes `github/service/` mixins (`repos`, `branches_prs`, `prs`, `features` such as suggested tasks/microagents, `resolver` helpers) and uses REST plus GraphQL (`queries.py`).
- **GitLab** — `gitlab/gitlab_service.py:GitLabService` with mixins under `gitlab/service/`.
- **Bitbucket** — `bitbucket/bitbucket_service.py`.

`BaseGitService` (`service_types.py`) holds shared logic for discovering microagents and parsing their content; `GitService` is the protocol (`get_user`, `search_repositories`, `get_all_repositories`, `get_paginated_repos`, `get_suggested_tasks`, `get_repository_details_from_repo_name`, `get_branches`, `get_paginated_branches`, …). Errors map to `AuthenticationError`, `RateLimitError`, `ResourceNotFoundError`, `UnknownException`, `MicroagentParseError`.

**Extension seam:** the concrete classes are resolved with `get_impl` from `OPENHANDS_GITHUB_SERVICE_CLS` and `OPENHANDS_GITLAB_SERVICE_CLS` and `OPENHANDS_BITBUCKET_SERVICE_CLS`, which is how the enterprise package swaps in `SaaSGitHubService`-style implementations that fetch/refresh tokens from its token manager.

## Suggested tasks and prompts

`SuggestedTask` carries the provider, repo, issue/PR number, title, and `TaskType` (`MERGE_CONFLICTS`, `FAILING_CHECKS`, `UNRESOLVED_COMMENTS`, `OPEN_ISSUE`, `OPEN_PR`, `CREATE_MICROAGENT`). `get_prompt_for_task` renders Jinja templates from `templates/suggested_task/` with provider-specific terms (PR vs MR, `GITHUB_TOKEN` vs `GITLAB_TOKEN`, CLI names). `templates/resolver/` holds prompts used by resolver-style integrations (GitHub, GitLab, Jira, Linear, Slack) and a conversation summary prompt.

## Server API

`openhands/server/routes/git.py` (prefix `/api/user`), all using the authenticated user's provider tokens:

| Endpoint | Purpose |
| --- | --- |
| `GET /installations` | GitHub App installations / Bitbucket workspaces |
| `GET /repositories` | List repositories (sorted, optionally paginated per provider/installation) |
| `GET /info` | Current git user |
| `GET /search/repositories`, `GET /search/branches` | Search |
| `GET /suggested-tasks` | Aggregated suggested tasks |
| `GET /repository/branches` | Paginated branches |
| `GET /repository/{repo}/microagents`, `.../microagents/content` | Repository microagents for the UI |

## VS Code extension

`openhands/integrations/vscode/` is the source of a VS Code extension packaged into the Python wheel (`openhands-vscode-0.0.1.vsix`, built by `build_vscode.py`); the CLI can install it, preferring a release download (`openhands/cli/vscode_extension.py`) ([CLI](../interfaces/cli.md)).

## Related pages

- [Issue Resolver](issue-resolver.md) — uses provider-specific issue/PR interfaces
- [Enterprise (SaaS) Server](../enterprise/saas-server.md) — OAuth tokens and service overrides
- [Web Server](../server/web-server.md)
- [Microagents](../concepts/microagents.md) — org-level `.openhands` repositories
