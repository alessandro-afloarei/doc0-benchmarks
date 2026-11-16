---
type: workflow
title: GitHub/GitLab/Bitbucket Issue Resolver
description: How the openhands.resolver package runs OpenHands headlessly on an issue or pull request — cloning the repo, building instructions from the issue thread, running the agent, extracting a git patch, judging success with an LLM, and opening a branch or (draft) PR — plus the reusable GitHub Actions workflow that drives it.
tags: [resolver, github-actions, issues, pull-requests, automation, headless]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-0e47ed60da864008f08a91c7
    resource: repo://.github/workflows/openhands-resolver.yml
  - id: openwiki-source-3a2b5746f12b8a942ba2b7cb
    resource: repo://openhands/resolver/interfaces/issue_definitions.py
  - id: openwiki-source-a7d4117117c5bc288940f3d9
    resource: repo://openhands/resolver/issue_handler_factory.py
  - id: openwiki-source-0aa9c8cee8d147e243969427
    resource: repo://openhands/resolver/issue_resolver.py
  - id: openwiki-source-52a4a23cdc5525a9cbbefc83
    resource: repo://openhands/resolver/send_pull_request.py
  - id: openwiki-source-de574e23d9c70341591ce66c
    resource: repo://openhands/resolver/utils.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# GitHub/GitLab/Bitbucket Issue Resolver

`openhands/resolver/` turns OpenHands into an automated issue fixer. It runs entirely headlessly (no web server) using `openhands.core.main.run_controller` ([Architecture Overview](../architecture/overview.md#assembly-headless-path)) and supports GitHub, GitLab, and Bitbucket. It runs in two phases, each a CLI module:

1. `python -m openhands.resolver.resolve_issue` — attempt the fix, write `output/output.jsonl`.
2. `python -m openhands.resolver.send_pull_request` — turn the result into a branch or PR and comment back.

## Phase 1: resolving

`resolve_issue.py` parses arguments (`--selected-repo owner/repo`, `--issue-number`, `--issue-type issue|pr`, `--comment-id`, `--token`, `--username`, `--base-domain`, `--max-iterations`, `--llm-model/--llm-api-key/--llm-base-url`, `--runtime`, `--base-container-image` or `--runtime-container-image`, `--prompt-file`, `--repo-instruction-file`, `--output-dir`, `--is-experimental`) and constructs `IssueResolver` (`issue_resolver.py`):

- **Platform detection:** `identify_token(token, base_domain)` (`utils.py`) probes provider APIs to decide whether the token is GitHub, GitLab, or Bitbucket.
- **Handlers:** `IssueHandlerFactory` (`issue_handler_factory.py`) builds a provider handler (`interfaces/github.py`, `gitlab.py`, `bitbucket.py`, implementing `IssueHandlerInterface` in `interfaces/issue.py`) wrapped in `ServiceContextIssue` or `ServiceContextPR` (`interfaces/issue_definitions.py`), which add instruction rendering and success checking.
- **Config:** OpenHands config with the given LLM; sandbox uses the runtime image `ghcr.io/all-hands-ai/runtime:<version>-nikolaik` unless a base or runtime image is given (both at once is an error).

`resolve_issue()`:

1. `extract_issue()` downloads the issue/PR with its comments, review comments, review threads, and referenced issues. When `--comment-id` is set, only that comment is used; if it doesn't match, it raises `ValueError`.
2. Clones the repo into `<output_dir>/repo` (once) and records `base_commit = HEAD`. For PRs it fetches and checks out the PR head branch first.
3. Loads repository instructions from `--repo-instruction-file` or the repo's `.openhands_instructions`.
4. **Skips** the issue when `output.jsonl` already has an entry for it.
5. `process_issue()`: copies the repo into a fresh workspace, creates and connects a runtime, renders instructions from Jinja templates in `prompts/resolve/` (`basic.jinja`, `basic-with-tests.jinja`, `basic-followup.jinja` for PRs, with separate *conversation instructions* templates), and runs `run_controller` with `codeact_user_response` as the simulated user, so the agent never waits for a human.
6. `complete_runtime()` runs `git add -A` (with `sudo` as needed) and `git diff --no-color --cached <base_commit>` in the sandbox, with retries, to get `git_patch`.
7. **Success judgment:** `guess_success(issue, history, git_patch)` asks the LLM using `prompts/guess_success/*.jinja`. For issues it uses `issue-success-check`. For PRs it checks review threads, thread comments, and review bodies separately (`pr-thread-check`, `pr-feedback-check`, `pr-review-check`) and returns a success flag per item plus explanations.
8. Appends a `ResolverOutput` (`resolver_output.py`) to `output.jsonl`: the issue, its type, the instruction, `base_commit`, `git_patch`, history, metrics, `success`, `comment_success`, `result_explanation`, and `error`.

`visualize_resolver_output.py` pretty-prints these results.

## Phase 2: sending results

`send_pull_request.py`:

- Reads the issue's `ResolverOutput`, copies the repo, parses `git_patch` and applies it with the patch utilities in `patching/` (`parse_patch`/`apply_diff`), handling new, deleted, and binary files, and commits (`make_commit`).
- `--pr-type` is `branch` (push a branch only), `draft`, or `ready`. It pushes a new branch named by the handler, opens a PR or MR, optionally requests `--reviewer`, and comments on the issue with the result.
- For PR-type runs, `update_existing_pull_request` pushes to the existing PR branch, replies to the review comments that were handled, and posts a summary comment (written by the LLM from `pr-changes-summary.jinja` when an LLM config is given).
- `--send-on-failure` pushes a branch even when `success` is false, so a human can take over.

## GitHub Actions workflow

`.github/workflows/openhands-resolver.yml` is both this repository's resolver workflow and a reusable `workflow_call` that other repositories can call. `openhands/resolver/examples/openhands-resolver.yml` is a template to copy into another repository.

- **Triggers:** an issue or PR labeled `fix-me` or `fix-me-experimental`; an issue comment, PR review comment, or review containing the macro (default `@openhands-agent`, or `@openhands-agent-exp` for the experimental build); or `workflow_call`.
- **Inputs and secrets:** `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`, `PAT_TOKEN`/`PAT_USERNAME` (default username `openhands-agent`), `max_iterations`, `target_branch`, `pr_type`, `runner`, and a custom sandbox environment.
- **Steps:**
  1. Install `openhands-ai`: the latest release, or the repository's main branch for experimental runs.
  2. Set `ISSUE_TYPE` from the event: `pr` for PR events, otherwise `issue`.
  3. React or comment to acknowledge the request.
  4. Run `resolve_issue`.
  5. Check `"success":true` in `output.jsonl` and upload it as an artifact.
  6. Run `send_pull_request --pr-type draft` (or the configured type) on success, or `--pr-type branch --send-on-failure` on failure.
  7. Comment the outcome and remove the label.

The SaaS GitHub/GitLab integrations reuse the provider interfaces and resolver prompt templates (`openhands/integrations/templates/resolver/`) inside long-running cloud conversations ([Enterprise Server](../enterprise/saas-server.md)).

## Tests

`tests/unit/resolver/` covers handler factory selection, GitHub and GitLab handlers (issue and PR extraction, success guessing, PR sending), issue reference parsing, patch application (including whitespace), and `resolve_issue` end to end with mock outputs.

## Related pages

- [Git Provider Integrations](git-providers.md)
- [Command-Line Interface](../interfaces/cli.md)
- [Evaluation Harness](../evaluation/benchmarks.md): the same headless pattern and patch extraction
