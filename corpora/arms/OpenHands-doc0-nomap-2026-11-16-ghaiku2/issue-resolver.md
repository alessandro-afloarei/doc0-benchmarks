---
title: "Issue Resolver"
---
## Overview

The issue resolver runs the agent on one GitHub, GitLab or Bitbucket issue, or on one pull-request comment thread, and records what it did. It clones the repository into an output folder, runs the agent in a runtime on a copy of the code, takes the resulting diff, and decides whether the attempt succeeded. A separate step, `send_pull_request`, turns a recorded patch into a branch and a pull request. The resolver is a client of the same controller and runtime as the server, so it is also the clearest example of driving OpenHands from code. The provider calls it makes are on [[Git Provider Integrations]].

Sources: [openhands/resolver/resolve_issue.py:8-39](repo://openhands/resolver/resolve_issue.py#L8-L39), [openhands/resolver/issue_resolver.py:52-60](repo://openhands/resolver/issue_resolver.py#L52-L60)

## Entry point

`resolve_issue.py` parses the arguments and runs `IssueResolver.resolve_issue` with `asyncio.run`. The options cover the repository (`--selected-repo`, `--token`, `--username`, `--base-domain`), the issue (`--issue-number`, `--comment-id`, `--issue-type` for an issue or a pull request), the model (`--llm-model`, `--llm-api-key`, `--llm-base-url`), the runtime and its images, the iteration limit, the output folder, and prompt templates.

Sources: [openhands/resolver/resolve_issue.py:8-39](repo://openhands/resolver/resolve_issue.py#L8-L39), [openhands/resolver/resolve_issue.py:18-124](repo://openhands/resolver/resolve_issue.py#L18-L124)

`IssueResolver.__init__` turns those arguments into an `OpenHandsConfig`. It applies the model, the sandbox image and the runtime name, and the sandbox settings are then updated for the resolver's needs. The issue handler is chosen per provider by `IssueHandlerFactory`, which returns the issue handler or the pull-request handler for the given issue type.

Sources: [openhands/resolver/issue_resolver.py:55-120](repo://openhands/resolver/issue_resolver.py#L55-L120), [openhands/resolver/issue_resolver.py:121-177](repo://openhands/resolver/issue_resolver.py#L121-L177), [openhands/resolver/issue_resolver.py:178-266](repo://openhands/resolver/issue_resolver.py#L178-L266), [openhands/resolver/issue_handler_factory.py:15-50](repo://openhands/resolver/issue_handler_factory.py#L15-L50)

## Checking out the repository

`resolve_issue` extracts the issue, and checks that a comment ID names a comment that exists on it. Then it clones the repository into `repo` under the output folder, unless it is already there, and records the base commit. The clone URL comes from the issue handler, which puts the access token into the URL.

Sources: [openhands/resolver/issue_resolver.py:535-588](repo://openhands/resolver/issue_resolver.py#L535-L588), [openhands/resolver/issue_resolver.py:519-534](repo://openhands/resolver/issue_resolver.py#L519-L534)

Each issue is then processed in its own workspace. `process_issue` replaces the workspace folder with a fresh copy of the repository, creates a runtime, subscribes to its events for logging, and writes the repository to the workspace.

Sources: [openhands/resolver/issue_resolver.py:397-434](repo://openhands/resolver/issue_resolver.py#L397-L434)

## Running the agent

The issue handler writes the instruction from the issue, the prompt templates and any repository instruction. That text becomes a `MessageAction`, and `run_controller` runs the agent on it with the resolver's runtime and a fake user response function, so the run continues without asking a person. The same controller and runtime as the server run here, as described on [[Agent Controller]].

Sources: [openhands/resolver/issue_resolver.py:437-466](repo://openhands/resolver/issue_resolver.py#L437-L466), [openhands/resolver/utils.py:31-60](repo://openhands/resolver/utils.py#L31-L60)

A value error or runtime error from the run is caught and recorded as the attempt's error, and the run's state is set to none. A run that returns no state is an error as well.

Sources: [openhands/resolver/issue_resolver.py:459-470](repo://openhands/resolver/issue_resolver.py#L459-L470)

## Taking the patch

`complete_runtime` produces the patch. It runs `git diff --cached` against the base commit inside the runtime, retries up to five times with a growing timeout, and keeps the output when the command exits with 0. The patch is what the pull request will contain.

Sources: [openhands/resolver/issue_resolver.py:309-388](repo://openhands/resolver/issue_resolver.py#L309-L388)

The handler then judges the run with `guess_success`, which takes the history and the patch. For a pull request with comment threads, the result is a list of per-comment outcomes, and each is written to the log as a checked or unchecked item. The outcome is stored in a `ResolverOutput` with the issue, the instruction, the base commit, the patch, the history, the metrics, the success flag and any error.

Sources: [openhands/resolver/issue_resolver.py:470-534](repo://openhands/resolver/issue_resolver.py#L470-L534), [openhands/resolver/resolver_output.py:8-20](repo://openhands/resolver/resolver_output.py#L8-L20)

The outputs are written to `output.jsonl` in the output folder. That file is what the pull-request step reads.

Sources: [openhands/resolver/issue_resolver.py:600-612](repo://openhands/resolver/issue_resolver.py#L600-L612)

## Opening the pull request

`send_pull_request` processes one output at a time. An output that did not succeed is skipped unless the run asks to send failures too. Otherwise it initialises a repository for the issue, applies the recorded patch with the patch module, which parses the diff and applies it to the files, and commits it. For a pull-request comment thread it updates the existing pull request; for an issue it opens a new one.

Sources: [openhands/resolver/send_pull_request.py:28-60](repo://openhands/resolver/send_pull_request.py#L28-L60), [openhands/resolver/send_pull_request.py:162-232](repo://openhands/resolver/send_pull_request.py#L162-L232), [openhands/resolver/patching/apply.py:1-30](repo://openhands/resolver/patching/apply.py#L1-L30)

The branch is pushed with `git push` to the URL that the issue handler gives for the owner the change is pushed to, which is the fork's owner when a fork is used. The pull request itself is created through the same handler, which knows whether the target is GitHub, GitLab or Bitbucket.

Sources: [openhands/resolver/send_pull_request.py:320-345](repo://openhands/resolver/send_pull_request.py#L320-L345), [openhands/resolver/send_pull_request.py:233-260](repo://openhands/resolver/send_pull_request.py#L233-L260)
