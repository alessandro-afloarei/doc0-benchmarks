---
type: integration
title: Git Provider Integrations
description: How OpenHands talks to GitHub, GitLab and Bitbucket — the ProviderHandler facade, GitService protocol and mixins, token handling and redaction, how the runtime clones repositories with authenticated URLs, token refresh, and the /api/user routes that expose provider data to the UI.
tags: [git, github, gitlab, bitbucket, tokens, provider-handler, repositories]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-61b5d6e6c4155cc8921df93e
    resource: repo://openhands/core/setup.py
  - id: openwiki-source-6554cc3bf57225936e6294f8
    resource: repo://openhands/integrations/github/github_service.py
  - id: openwiki-source-20d30eb50754232cae150363
    resource: repo://openhands/integrations/provider.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-f8228654e759fdf2fd0ec8f2
    resource: repo://openhands/server/app.py
  - id: openwiki-source-7c92f7b75c88c1cf3ef2d452
    resource: repo://openhands/server/routes/git.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Git Provider Integrations

`openhands/integrations/` abstracts the git hosting providers. It serves three consumers: the **server routes** that let the UI list repositories/branches/microagents, the **runtime**, which clones repos and exposes tokens to the agent's shell, and the **resolver** ([Issue resolver](../workflows/issue-resolver.md)).

## Types and contracts (`service_types.py`)

- `ProviderType`: `github`, `gitlab`, `bitbucket`, `enterprise_sso`.
- `GitService` is a `Protocol` (get user, search/list repositories, paginated repos/branches, suggested tasks, repository details by name, microagent listing/content, PR details, `is_pr_open`). `InstallationsService` adds `get_installations`.
- `BaseGitService` (ABC) holds shared microagent-discovery logic: it looks for `.cursorrules` and a microagents directory in a repository (`.openhands/microagents`, or `openhands-config` for org-level GitLab repos), filters valid `.md` files and parses them into `MicroagentResponse`s (see [Microagents](../agents/microagents.md)).
- Errors: `AuthenticationError`, `RateLimitError`, `ResourceNotFoundError`, `UnknownException`, `MicroagentParseError`.
- Data models: `User`, `Repository` (with `git_provider`), `Branch`, `PaginatedBranchesResponse`, `SuggestedTask` (types `MERGE_CONFLICTS`, `FAILING_CHECKS`, `UNRESOLVED_COMMENTS`, used to propose follow-up tasks on the home page), `Comment`.

Concrete services live in `github/`, `gitlab/`, `bitbucket/`. `GitHubService` is assembled from mixins by feature area (`GitHubBranchesMixin`, `FeaturesMixin`, `PRsMixin`, `ReposMixin`, `ResolverMixin`) plus the base classes, and supports GitHub Enterprise: a `base_domain` other than `github.com` switches the REST and GraphQL URLs to `https://<host>/api/v3` and `/api/graphql`. The class actually used is resolved by `get_impl` from `OPENHANDS_GITHUB_SERVICE_CLS` (default: the class above) — an **extension seam** the [enterprise edition](../enterprise/enterprise-saas.md) uses to supply `SaaSGitHubService`.

## `ProviderHandler` (`provider.py`)

`ProviderHandler(provider_tokens, external_auth_id=..., external_token_manager=..., session_api_key=..., sid=...)` is the facade used everywhere:

- `provider_tokens` **must be a `MappingProxyType`** (read-only mapping of `ProviderType → ProviderToken`) or the constructor raises `TypeError`; `ProviderToken` carries a `SecretStr` token, optional `user_id` and optional `host` for self-hosted instances. Tokens are never exposed as plain strings unless explicitly requested.
- `_get_service(provider)` builds the right service from the token; `get_user`, `get_repositories`, `search_repositories`, `search_branches`, `get_suggested_tasks`, `get_microagents` and friends fan out across providers. `search_repositories` can detect a pasted repository URL and de-duplicates results.
- `verify_repo_provider(repo, specified_provider=None)` finds which provider hosts `owner/repo` by trying the specified provider first, then each configured one; if all fail it logs the accumulated errors and raises `AuthenticationError`. The runtime also uses this to decide whether a repo is GitLab (affecting where org-level microagents live).
- `get_authenticated_git_url(repo)` builds the clone URL embedding credentials according to provider: GitHub `https://<token>@host/repo.git`, GitLab `https://oauth2:<token>@host/...`, Bitbucket either `user:app_password@` or `x-token-auth:<token>@`; it falls back to an unauthenticated HTTPS URL when no token exists, and uses the token's `host` when set.
- `get_env_vars(expose_secrets, providers, get_latest)` returns tokens (as `SecretStr` or strings) keyed by env var names `github_token`, `gitlab_token`, `bitbucket_token` (lower-case, via `get_provider_env_key`). With `get_latest=True` and a `WEB_HOST` configured it calls `https://<WEB_HOST>/api/refresh-tokens` with the session API key to obtain a fresh token — this is how SaaS keeps short-lived OAuth tokens usable in a long-running sandbox.
- `set_event_stream_secrets` registers the token values with the [event stream](../architecture/event-stream.md) so they are replaced by `<secret_hidden>` in every persisted/streamed event.

## Runtime usage

- **Startup**: `AgentSession._create_runtime` merges `ProviderHandler.get_env_vars(expose_secrets=True)` with custom secrets into the runtime's `env_vars`, so `$GITHUB_TOKEN` etc. exist in the sandbox shell (the public `github.md` microagent documents this to the agent). For `RemoteRuntime`, tokens that were supplied as custom secrets take priority over provider tokens (`override_provider_tokens_with_custom_secret`).
- **Clone**: `Runtime.clone_or_init_repo(tokens, selected_repository, selected_branch)`: with no repository selected it runs `git init` only if `init_git_in_empty_workspace`; otherwise it obtains the authenticated URL, emits a `SETTING_UP_WORKSPACE` status, runs `git clone <url> <dir>` where `<dir>` is the last path segment, then `cd <dir> && git checkout <branch>` or `git checkout -b openhands-workspace-<random8>` when no branch was chosen. Afterwards the session runs the repo's setup script and installs git hooks (`maybe_run_setup_script`, `maybe_setup_git_hooks`). Headless callers use `core/setup.py::initialize_repository_for_runtime`.
- **Token refresh on demand**: before executing any action, `Runtime._export_latest_git_provider_tokens` checks (via `check_cmd_action_for_provider_token_ref`) whether a `CmdRunAction` mentions `github_token`/`gitlab_token`/`bitbucket_token`; if so it fetches the latest tokens (`get_latest=True`), updates event-stream secrets and exports the new values into the sandbox environment. Failures only log a warning.
- **Headless token source**: `core/setup.py::get_provider_tokens` builds tokens from `GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_TOKEN` environment variables.
- **Git state in the UI**: the runtime's `GitHandler` computes changed files and diffs and the current branch, which the conversation manager uses to update stored conversation metadata when git-related commands run.

## Server routes (`server/routes/git.py`)

All use the request's `UserAuth` to obtain provider tokens and then a `ProviderHandler`: `GET /api/user/installations`, `/repositories`, `/info`, `/search/repositories`, `/search/branches`, `/suggested-tasks`, `/repository/branches`, and microagent endpoints `/repository/{name}/microagents` and `.../microagents/content`. These power the repo picker and microagent management pages in the [frontend](../clients/frontend.md). The router has prefix `/api/user` and `app.py` includes it only when `server_config.app_mode == AppMode.OSS`; in SaaS mode the enterprise server provides its own equivalents. Missing tokens yield 401/400 responses and unexpected failures are returned as HTTP 500 with an error payload.

## Security notes

- Tokens live in `SecretStr`, are wrapped in an immutable mapping, and are scrubbed from events; but they are real environment variables in the sandbox, so anything the agent runs can read them — one reason to use a confirmation mode or the Docker runtime ([Security](../security/security-and-confirmation.md)).
- The authenticated clone URL embeds the token and therefore ends up in the clone command; that command is a `CmdRunAction` whose text is redacted in the stream by the secret replacement.

Related: [Server and sessions](../server/server-and-sessions.md), [Runtime](../runtime/runtime-and-sandbox.md).
