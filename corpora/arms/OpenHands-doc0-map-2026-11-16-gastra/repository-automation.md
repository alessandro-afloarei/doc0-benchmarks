---
title: "Repository Automation"
---
## Overview

Repository automation starts with provider credentials and a prepared working tree. Ordinary conversations clone through the runtime's provider handler; the issue resolver prepares its own repository copy, runs an agent and writes a patch with diagnostic output. A separate publication command applies that patch, commits it and pushes a branch or pull request. [[Sandbox Runtimes]] explains action execution, and [[CLI and Headless Runs]] explains the controller runner reused by the resolver.

Sources: [openhands/runtime/base.py:401-461](repo://openhands/runtime/base.py#L401-L461), [openhands/resolver/issue_resolver.py:411-446](repo://openhands/resolver/issue_resolver.py#L411-L446), [openhands/resolver/issue_resolver.py:503-517](repo://openhands/resolver/issue_resolver.py#L503-L517), [openhands/resolver/send_pull_request.py:530-584](repo://openhands/resolver/send_pull_request.py#L530-L584)

## Select a provider and credentials

`ProviderHandler` maps GitHub, GitLab and Bitbucket to their service implementations. Its token collection must be a read-only mapping, and each token model carries a secret value, optional user ID and optional host. Repository verification tries an explicitly selected provider first, then available providers, collecting failures before raising an authentication error if none can access the repository.

Sources: [openhands/integrations/provider.py:41-49](repo://openhands/integrations/provider.py#L41-L49), [openhands/integrations/provider.py:105-160](repo://openhands/integrations/provider.py#L105-L160), [openhands/integrations/provider.py:447-470](repo://openhands/integrations/provider.py#L447-L470)

Authenticated clone URLs use the verified provider and repository name, with a token-specific host overriding the default domain. Credential formatting differs between providers. The handler can also expose provider secrets as runtime environment values and register them with the event stream for masking. [[Events and Persistence]] describes the scope of that masking; obtaining an authenticated URL does not make arbitrary application logs a sanitized output channel.

Sources: [openhands/integrations/provider.py:613-661](repo://openhands/integrations/provider.py#L613-L661), [openhands/integrations/provider.py:338-367](repo://openhands/integrations/provider.py#L338-L367)

## Prepare the ordinary runtime workspace

Without a selected repository, runtime preparation optionally initializes Git according to `init_git_in_empty_workspace`. With a repository, it clones into the repository's final path component and checks out the selected branch, or creates a random `openhands-workspace-` branch. The shared initialization helper follows cloning with setup-script execution and hook installation. This is the path used by general runtime initialization, separate from the resolver's copied workspace.

Sources: [openhands/runtime/base.py:401-461](repo://openhands/runtime/base.py#L401-L461), [openhands/core/setup.py:119-154](repo://openhands/core/setup.py#L119-L154)

If readable, `.openhands/setup.sh` is made executable and sourced through a hidden, blocking environment action with a 600-second hard timeout. If `.openhands/pre-commit.sh` exists, hook setup creates the hook directory and makes the script executable. An existing hook without the OpenHands marker is moved to `pre-commit.local`; the generated replacement sources the OpenHands script. The generated hook does not itself invoke the preserved local file.

Sources: [openhands/runtime/base.py:463-488](repo://openhands/runtime/base.py#L463-L488), [openhands/runtime/base.py:495-521](repo://openhands/runtime/base.py#L495-L521), [openhands/runtime/base.py:523-584](repo://openhands/runtime/base.py#L523-L584)

## Configure an issue-resolution run

The resolver requires a repository in owner/repository form and an issue number. It supports issue mode or pull-request feedback mode, with an optional comment ID. Constructor credentials come from `--token`, then GitHub, GitLab or Bitbucket token environment variables; username comes from the argument or `GIT_USERNAME`. Both are required. Provider identification uses the token and optional base domain.

Sources: [openhands/resolver/resolve_issue.py:18-35](repo://openhands/resolver/resolve_issue.py#L18-L35), [openhands/resolver/resolve_issue.py:60-77](repo://openhands/resolver/resolve_issue.py#L60-L77), [openhands/resolver/resolve_issue.py:109-131](repo://openhands/resolver/resolve_issue.py#L109-L131), [openhands/resolver/issue_resolver.py:74-97](repo://openhands/resolver/issue_resolver.py#L74-L97)

The resolver loads application configuration, selects CodeActAgent, sets the task budget to 4 and applies the requested maximum iterations, which defaults to 50. It also selects its workspace and adjusts sandbox settings. Supplying both a base container image and a runtime container image is rejected. Model configuration should be supplied through the application configuration path: although the parser exposes LLM override flags, the constructor shown here loads application configuration without applying those individual flags.

Sources: [openhands/resolver/resolve_issue.py:54-59](repo://openhands/resolver/resolve_issue.py#L54-L59), [openhands/resolver/resolve_issue.py:79-96](repo://openhands/resolver/resolve_issue.py#L79-L96), [openhands/resolver/issue_resolver.py:143-175](repo://openhands/resolver/issue_resolver.py#L143-L175), [openhands/resolver/issue_resolver.py:178-217](repo://openhands/resolver/issue_resolver.py#L178-L217)

With credentials and application model configuration already available, a resolution invocation has this shape. Replace the repository and issue number with the intended target. The output directory retains the checkout and result record used by the publication command.

Sources: [openhands/resolver/resolve_issue.py:18-35](repo://openhands/resolver/resolve_issue.py#L18-L35), [openhands/resolver/resolve_issue.py:60-77](repo://openhands/resolver/resolve_issue.py#L60-L77), [openhands/resolver/issue_resolver.py:571-603](repo://openhands/resolver/issue_resolver.py#L571-L603)

```bash
poetry run python -m openhands.resolver.resolve_issue \
  --selected-repo owner/repository \
  --issue-number 123 \
  --output-dir output
```

Sources: [openhands/resolver/resolve_issue.py:18-22](repo://openhands/resolver/resolve_issue.py#L18-L22), [openhands/resolver/resolve_issue.py:60-77](repo://openhands/resolver/resolve_issue.py#L60-L77), [openhands/resolver/resolve_issue.py:128-135](repo://openhands/resolver/resolve_issue.py#L128-L135)

## Produce a patch and result record

The resolver fetches the requested issue and validates any requested comment match. It creates output directories, clones into `output/repo` only if that directory is absent, and records the checkout's commit. Reusing an output directory therefore reuses its existing checkout rather than automatically refreshing it. If no explicit repository instructions were supplied, it reads `.openhands_instructions` when present.

Sources: [openhands/resolver/issue_resolver.py:519-560](repo://openhands/resolver/issue_resolver.py#L519-L560), [openhands/resolver/issue_resolver.py:562-600](repo://openhands/resolver/issue_resolver.py#L562-L600)

Before execution, it checks `output.jsonl` and skips an issue number already recorded there. PR mode fetches and checks out the head branch and recomputes the base commit. Processing replaces the per-issue workspace with a copy of the saved checkout, connects a runtime, prepares setup scripts and hooks, and renders issue instructions into a user action with optional images.

Sources: [openhands/resolver/issue_resolver.py:606-652](repo://openhands/resolver/issue_resolver.py#L606-L652), [openhands/resolver/issue_resolver.py:411-438](repo://openhands/resolver/issue_resolver.py#L411-L438), [openhands/resolver/issue_resolver.py:267-307](repo://openhands/resolver/issue_resolver.py#L267-L307)

After the controller run, completion stages all changes and extracts a cached diff against the base commit, retrying diff collection up to five times. The output includes the issue, instructions, base commit, patch, history, metrics, success assessment and error. It is appended to JSONL and flushed. For issue mode, success is an LLM assessment of issue context, the last message and patch; an unparseable assessment becomes failure. This flag is not an independent test-suite result.

Sources: [openhands/resolver/issue_resolver.py:350-386](repo://openhands/resolver/issue_resolver.py#L350-L386), [openhands/resolver/issue_resolver.py:440-476](repo://openhands/resolver/issue_resolver.py#L440-L476), [openhands/resolver/issue_resolver.py:503-517](repo://openhands/resolver/issue_resolver.py#L503-L517), [openhands/resolver/issue_resolver.py:654-665](repo://openhands/resolver/issue_resolver.py#L654-L665), [openhands/resolver/interfaces/issue_definitions.py:370-410](repo://openhands/resolver/interfaces/issue_definitions.py#L370-L410)

## Publish the saved changes

Publication loads a numeric issue number from `output.jsonl`. It skips unsuccessful results unless `--send-on-failure` is enabled. It copies the repository into an issue-specific patches directory, checks out the recorded base commit or PR head, applies the saved patch and commits changes. An empty working-tree change set raises an error rather than producing an empty commit.

Sources: [openhands/resolver/send_pull_request.py:124-159](repo://openhands/resolver/send_pull_request.py#L124-L159), [openhands/resolver/send_pull_request.py:197-230](repo://openhands/resolver/send_pull_request.py#L197-L230), [openhands/resolver/send_pull_request.py:522-555](repo://openhands/resolver/send_pull_request.py#L522-L555), [openhands/resolver/send_pull_request.py:719-725](repo://openhands/resolver/send_pull_request.py#L719-L725)

| Publication mode | Remote result for an issue |
| --- | --- |
| `branch` | Push a new branch and return a comparison URL |
| `draft` | Push a new branch and create a draft pull request; this is the parser default |
| `ready` | Push a new branch and create a regular pull request |

Sources: [openhands/resolver/send_pull_request.py:299-343](repo://openhands/resolver/send_pull_request.py#L299-L343), [openhands/resolver/send_pull_request.py:354-379](repo://openhands/resolver/send_pull_request.py#L354-L379), [openhands/resolver/send_pull_request.py:615-620](repo://openhands/resolver/send_pull_request.py#L615-L620)

An explicit target branch must exist; otherwise publication uses the repository default branch. Fork ownership changes the push destination, and an optional reviewer is requested after pull-request creation. For PR-feedback results, publication instead pushes to the existing head branch and can post a summary and thread replies. The `branch` choice is therefore a publishing operation, not a local preview.

Sources: [openhands/resolver/send_pull_request.py:305-343](repo://openhands/resolver/send_pull_request.py#L305-L343), [openhands/resolver/send_pull_request.py:381-384](repo://openhands/resolver/send_pull_request.py#L381-L384), [openhands/resolver/send_pull_request.py:435-497](repo://openhands/resolver/send_pull_request.py#L435-L497), [openhands/resolver/send_pull_request.py:557-567](repo://openhands/resolver/send_pull_request.py#L557-L567)

## Checkout-specific limitations

The publication parser mentions `all_successful`, but its implementation rejects nonnumeric issue numbers. Its environment fallback reads GitHub and GitLab tokens, unlike the resolver's additional Bitbucket fallback. New-PR creation has a Bitbucket handler, but existing-PR updates select GitHub or GitLab only. Check these concrete branches when integrating another provider, and supply an explicit domain where the default-domain handling is insufficient.

Sources: [openhands/resolver/send_pull_request.py:622-627](repo://openhands/resolver/send_pull_request.py#L622-L627), [openhands/resolver/send_pull_request.py:695-725](repo://openhands/resolver/send_pull_request.py#L695-L725), [openhands/resolver/send_pull_request.py:277-297](repo://openhands/resolver/send_pull_request.py#L277-L297), [openhands/resolver/send_pull_request.py:420-433](repo://openhands/resolver/send_pull_request.py#L420-L433), [openhands/resolver/send_pull_request.py:519-521](repo://openhands/resolver/send_pull_request.py#L519-L521)

