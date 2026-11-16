---
type: architecture
title: Git Provider Integrations and Issue Resolver
description: How OpenHands talks to GitHub, GitLab, and Bitbucket through per-provider services and a ProviderHandler that injects tokens into the runtime, and how the openhands/resolver package turns labeled issues and review comments into automated fixes and pull requests.
tags: [integrations, github, gitlab, bitbucket, provider-tokens, resolver, pull-requests, automation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-0e47ed60da864008f08a91c7
    resource: repo://.github/workflows/openhands-resolver.yml
  - id: openwiki-source-20d30eb50754232cae150363
    resource: repo://openhands/integrations/provider.py
  - id: openwiki-source-8359632df7bdabd0aadc77fe
    resource: repo://openhands/integrations/service_types.py
  - id: openwiki-source-a7d4117117c5bc288940f3d9
    resource: repo://openhands/resolver/issue_handler_factory.py
  - id: openwiki-source-0aa9c8cee8d147e243969427
    resource: repo://openhands/resolver/issue_resolver.py
  - id: openwiki-source-fe1bbd49a7d175aff89ad0aa
    resource: repo://openhands/resolver/resolve_issue.py
  - id: openwiki-source-52a4a23cdc5525a9cbbefc83
    resource: repo://openhands/resolver/send_pull_request.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Git Provider Integrations and Issue Resolver

OpenHands works on code that lives in hosted git repositories, so it needs to list repositories,
read branches and microagents, clone with credentials, and open pull requests. This page covers two
related parts. The first is the provider layer in `openhands/integrations/`, which gives the server and
the runtime a uniform interface over GitHub, GitLab, and Bitbucket. The second is the
`openhands/resolver/` package, which runs OpenHands without a user to fix a single issue and report
the result as a pull request. This repository does not contain an Azure DevOps integration; the
supported hosts are the three named above, plus the enterprise-only providers described in
[Enterprise SaaS Layer](../enterprise/saas-server.md).

## The provider layer

### Provider types and tokens

`ProviderType` (`openhands/integrations/service_types.py:20-24`) has the values `GITHUB`, `GITLAB`,
`BITBUCKET`, and `ENTERPRISE_SSO`. `ProviderToken` (`openhands/integrations/provider.py:41`) carries a
token together with the user ID and host for that provider. `CustomSecret` (`provider.py:70`) holds
user-defined secrets that are exposed to the runtime alongside provider tokens.

### ProviderHandler

`ProviderHandler` (`openhands/integrations/provider.py:105`) is the one object the rest of the system
uses for provider work. Its `service_class_map` (`provider.py:127-131`) maps GitHub, GitLab, and
Bitbucket to their service implementations. `_get_service` (`provider.py:149`) builds a service for one
provider with that user's token, host, and optional external-auth details. Methods on the handler then
delegate to the service:

- identity and installations: `get_user` (`provider.py:162`), `get_github_installations`,
  `get_bitbucket_workspaces`;
- discovery: `get_repositories` (`provider.py:213`), `search_repositories` (`provider.py:287`),
  `search_branches` (`provider.py:260`), and `get_suggested_tasks` (`provider.py:247`);
- repository content: `get_branches` (`provider.py:472`), `get_microagents` (`provider.py:515`),
  `get_microagent_content` (`provider.py:556`), and `get_authenticated_git_url` (`provider.py:613`),
  which builds a clone URL that carries the token;
- pull requests: `is_pr_open` (`provider.py:663`).

Each provider's service is a class assembled from feature mixins. `GitHubService`
(`openhands/integrations/github/github_service.py:21`) is one example. GitLab and Bitbucket have
their own services under `gitlab/` and `bitbucket/`. The shared HTTP client is in
`openhands/integrations/protocols/http_client.py`. Errors that the services raise are defined in
`service_types.py` (`AuthenticationError` at line 163, `RateLimitError` at line 175, and
`ResourceNotFoundError` at line 181), so callers can handle them uniformly.

### Tokens inside the runtime

The agent's shell runs inside the sandbox, and it may need `git push` or a provider API. The handler
supplies those tokens without writing them into the conversation history:

- `get_env_vars` (`provider.py:385`) returns the provider tokens, either as secrets or plain strings,
  for export into the runtime's environment. The environment variable name is derived from the
  provider, as `<provider>_token` in lowercase (`get_provider_env_key`, `provider.py:443-445`);
- before a command runs, `check_cmd_action_for_provider_token_ref` (`provider.py:426-441`) checks whether
  a `CmdRunAction` mentions one of those variables. If it does, the runtime refreshes the token first
  (`_export_latest_git_provider_tokens` in `openhands/runtime/base.py:324`). This means that a token
  expired since the conversation started is refreshed only when the agent actually uses it.

Because the token is injected as an environment variable, any command the agent runs can read it. The
sandbox boundary is what limits exposure; see [Security Model and Sandboxing](../operations/security.md).

### Repository microagents

Repositories can carry microagents under a `.openhands/microagents` directory. The handler
(`get_microagents`, `provider.py:515`) lists them through the provider API, and
`get_microagent_content` (`provider.py:556`) fetches each file. The runtime then loads them into the
prompt (see [Agents, Tools, and Microagents](../architecture/agents-and-tools.md)). The shared
microagent `microagents/address_pr_comments.md` in this repository is an example of a workflow that
depends on these integrations.

## The issue resolver

The `openhands/resolver/` package performs unattended issue resolution. Its entry points are:

- `resolve_issue.py` (`main` at line 8), which resolves one issue or one review comment and writes the
  result to an output directory. Its command-line flags include `--selected-repo`, `--token`,
  `--username`, `--runtime`, `--max-iterations`, `--issue-number`, `--comment-id`, `--output-dir`,
  `--llm-model`, `--llm-api-key`, `--llm-base-url`, `--prompt-file`, `--repo-instruction-file`,
  `--issue-type`, `--is-experimental`, and `--base-domain` (`resolve_issue.py:19-122`);
- `send_pull_request.py` (`main` at line 587), which takes the output of a run and opens or updates a
  pull request. Its flags include `--pr-type`, `--fork-owner`, `--send-on-failure`, and
  `--target-branch` (`send_pull_request.py:592-658`).

### Handler selection

`IssueHandlerFactory` (`openhands/resolver/issue_handler_factory.py:15`) chooses the handlers for the
requested platform and whether the target is an issue or a pull request. `create` (line 36) returns a
`ServiceContextIssue` or `ServiceContextPR` wrapping the matching handler:

- GitHub: `GithubIssueHandler` and `GithubPRHandler` (`resolver/interfaces/github.py`);
- GitLab: `GitlabIssueHandler` and `GitlabPRHandler` (`resolver/interfaces/gitlab.py`);
- Bitbucket: `BitbucketIssueHandler` and `BitbucketPRHandler` (`resolver/interfaces/bitbucket.py`).

Each handler knows how to download issues, read comments, check for and name branches, create pull
requests, and reply to comments. `ServiceContextPR` also exposes `guess_success`
(`resolver/interfaces/issue_definitions.py:45`), which asks the model whether the changes resolve the
issue. `Issue` (`resolver/interfaces/issue.py:12`) is the platform-neutral record of the issue, its
number, title, body, and thread comments.

### One resolution

`IssueResolver` (`openhands/resolver/issue_resolver.py:52`) runs the steps for one issue:

1. `process_issue` (line 397) copies the prepared repository into the workspace and creates an
   `LLMRegistry` from the resolver's configuration.
2. `create_runtime` (line 417) and `initialize_runtime` (line 267) prepare the sandbox. These steps set up
   the repository, the git identity, and any repository instructions.
3. `resolve_issue` (line 535) runs the agent with `run_controller`. The issue prompt is rendered from the
   Jinja templates in `resolver/prompts/resolve/`, such as `basic.jinja`. The prompt includes the issue text and comments and any repository
   instructions from `repo_instruction_file`.
4. `complete_runtime` (line 309) collects the git diff the agent produced, then the result is recorded
   as a `ResolverOutput` (`resolver/resolver_output.py:8`). It holds the issue, the instruction, the base
   commit, and the patch.
5. `send_pull_request` (`send_pull_request.py:233`) applies the patch on a fresh clone and pushes a
   branch. `update_existing_pull_request` (`send_pull_request.py:393`) handles follow-up review
   comments by updating the branch of an open pull request. `make_commit` (line 162) creates the
   commit.

`update_openhands_config` (`issue_resolver.py:178`) and `update_sandbox_config` (`issue_resolver.py:209`)
set the runtime options from the command line. `extract_issue` (line 519) fetches the issue through the
handler.

### Triggering from GitHub

The workflow `.github/workflows/openhands-resolver.yml` runs the resolver from GitHub Actions. It starts
when an issue is labeled `fix-me` or `fix-me-experimental`, when an issue comment or review comment asks
for help, or manually through `workflow_dispatch`. The workflow inputs include the target branch, the
pull request type (draft or ready), and custom sandbox environment variables. It requires `issues: write`
and pull-request permissions.

## Operational consequences

- Provider tokens are placed in the sandbox environment for the duration of a conversation. Use tokens
  with the narrowest scope that works, and prefer short-lived GitHub App tokens where possible.
- The resolver's output directory holds the copied repository and the patch. Keep it out of shared
  storage if the repository is private.
- Pull requests created by the resolver are normal pull requests. Review them as you would any change
  from an outside contributor, since the agent wrote the diff.
- `guess_success` is a model judgment, not a test run. Use the repository's test suite as the final check.

## Extension seams

- New git host: implement the `GitService` protocol (`openhands/integrations/service_types.py:437`) in a
  service directory modeled on an existing one, add a `ProviderType` value, register it in
  `ProviderHandler.service_class_map`, and add issue and pull-request handlers in `resolver/interfaces/`.
- New trigger: add an event to `openhands-resolver.yml` and map it to the same `resolve_issue` inputs.
- New prompt: add a Jinja template under `resolver/prompts/resolve/` and pass it with `--prompt-file`.

## Tests

Unit tests for the integrations are under `tests/unit/integrations/`, and resolver tests are under
`tests/unit/resolver/`. Runtime tests that exercise git hooks and GitLab microagents are in `tests/runtime/`
(`test_git_hooks.py`, `test_runtime_gitlab_microagents.py`).

## Related pages

- [Server, Routes, and Conversation Management](../architecture/server-and-conversations.md)
- [Runtime Abstraction and Execution Backends](../architecture/runtime.md)
- [Model Context Protocol Integration](mcp.md)
- [Testing and CI](../operations/testing-and-ci.md)
