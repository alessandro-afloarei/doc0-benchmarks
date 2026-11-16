---
title: "Issue Resolver"
---
## Overview

The issue resolver is a batch tool. It takes one issue or pull request from GitHub, GitLab or Bitbucket, lets the agent change a copy of the repository to address it, records what happened, and then, in a second step, opens or updates a pull request with the change. It runs outside the server and the terminal program. It reuses the same agent, controller, runtime and config code, but it has its own entry point and its own output folder.

Sources: [openhands/resolver/resolve_issue.py:8-16](repo://openhands/resolver/resolve_issue.py#L8-L16), [openhands/resolver/resolve_issue.py:128-131](repo://openhands/resolver/resolve_issue.py#L128-L131), [openhands/resolver/issue_resolver.py:52-56](repo://openhands/resolver/issue_resolver.py#L52-L56)

## Entry point

`resolve_issue.main` parses the command-line arguments, builds an `IssueResolver` from them and runs its `resolve_issue` coroutine with `asyncio.run`. The constructor takes the LLM config, the issue type and number, and the other run options.

Sources: [openhands/resolver/resolve_issue.py:8-16](repo://openhands/resolver/resolve_issue.py#L8-L16), [openhands/resolver/resolve_issue.py:128-131](repo://openhands/resolver/resolve_issue.py#L128-L131), [openhands/resolver/issue_resolver.py:55-72](repo://openhands/resolver/issue_resolver.py#L55-L72)

The handler for the platform is built by `IssueHandlerFactory`. It creates an issue handler or a pull request handler for the platform and issue type given. A GitHub issue gets `GithubIssueHandler`, and a GitLab one gets `GitlabIssueHandler`, with the same pattern for pull requests and Bitbucket.

Sources: [openhands/resolver/issue_handler_factory.py:15-60](repo://openhands/resolver/issue_handler_factory.py#L15-L60), [openhands/resolver/interfaces/github.py:14-20](repo://openhands/resolver/interfaces/github.py#L14-L20)

## Cloning and checking out

`resolve_issue` clones the repository into `output_dir/repo` only once. It records the base commit with `git rev-parse HEAD`, so the result can be reproduced later. For a pull request it fetches and checks out the pull request's head branch first.

Sources: [openhands/resolver/issue_resolver.py:535-591](repo://openhands/resolver/issue_resolver.py#L535-L591), [openhands/resolver/issue_resolver.py:623-650](repo://openhands/resolver/issue_resolver.py#L623-L650)

Before it starts an issue, the resolver reads `output.jsonl` in the output folder. An issue already present there is skipped with a warning. A comment ID that matches nothing in the issue raises `ValueError` before any work is done.

Sources: [openhands/resolver/issue_resolver.py:546-560](repo://openhands/resolver/issue_resolver.py#L546-L560), [openhands/resolver/issue_resolver.py:603-616](repo://openhands/resolver/issue_resolver.py#L603-L616)

## Running the agent

`process_issue` copies the cloned repository into the workspace base, creates a new runtime for it and connects that runtime. It sends the issue text as the first user message, and calls `run_controller` with that message. The resulting history is kept for the output record.

Sources: [openhands/resolver/issue_resolver.py:397-418](repo://openhands/resolver/issue_resolver.py#L397-L418), [openhands/resolver/issue_resolver.py:437-449](repo://openhands/resolver/issue_resolver.py#L437-L449)

The runtime for each issue has git configured, every file added, and the patch made against the base commit with `git diff --cached`. That patch is the result. `complete_runtime` runs these steps through the runtime's action interface, and it raises if a step fails.

Sources: [openhands/resolver/issue_resolver.py:309-388](repo://openhands/resolver/issue_resolver.py#L309-L388)

After the patch is made, the issue handler's `guess_success` judges the result from the history, the issue and the patch. A pull request that has review comments gets a separate success flag for each comment.

Sources: [openhands/resolver/issue_resolver.py:455-478](repo://openhands/resolver/issue_resolver.py#L455-L478), [openhands/resolver/issue_resolver.py:478-480](repo://openhands/resolver/issue_resolver.py#L478-L480)

The output is a `ResolverOutput`: the issue, the instruction, the base commit, the patch, the history, the metrics, the success flags and an explanation. It is appended as one JSON line to `output.jsonl`.

Sources: [openhands/resolver/resolver_output.py:8-20](repo://openhands/resolver/resolver_output.py#L8-L20), [openhands/resolver/issue_resolver.py:504-517](repo://openhands/resolver/issue_resolver.py#L504-L517), [openhands/resolver/issue_resolver.py:660-661](repo://openhands/resolver/issue_resolver.py#L660-L661)

## Sending the change

A separate step reads the output file and sends each result. `process_single_issue` skips an unsuccessful result unless the caller asks to send failures. It clones the repository again at the base commit, or at the pull request's head branch, and applies the saved patch.

Sources: [openhands/resolver/send_pull_request.py:502-547](repo://openhands/resolver/send_pull_request.py#L502-L547)

The patch becomes a commit with `make_commit`. A new issue opens a pull request with `send_pull_request`, which pushes the branch and creates the pull request with the provider's API. A pull request result is pushed to its own branch by `update_existing_pull_request`.

Sources: [openhands/resolver/send_pull_request.py:162-176](repo://openhands/resolver/send_pull_request.py#L162-L176), [openhands/resolver/send_pull_request.py:233-258](repo://openhands/resolver/send_pull_request.py#L233-L258), [openhands/resolver/send_pull_request.py:393-410](repo://openhands/resolver/send_pull_request.py#L393-L410), [openhands/resolver/send_pull_request.py:557-580](repo://openhands/resolver/send_pull_request.py#L557-L580)

The provider calls behind the handlers and the pull request are described in [[Git Providers]], and the agent loop that produces the patch is in [[Agent Controller]].

Sources: [openhands/resolver/send_pull_request.py:233-258](repo://openhands/resolver/send_pull_request.py#L233-L258), [openhands/controller/agent_controller.py:100-115](repo://openhands/controller/agent_controller.py#L100-L115)
