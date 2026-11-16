---
title: "Issue Resolver"
---
## Overview

The issue resolver is a batch tool that takes one issue or pull request from a git host and produces a patch, and then optionally a pull request, by running an agent on a copy of the repository. It reuses the agent and runtime code from the core package, and it uses the git provider integration for the issue and the pull request. `resolve_issue` is the command-line entry point, and `IssueResolver` runs the work for one issue.

Sources: [openhands/resolver/resolve_issue.py:8-10](repo://openhands/resolver/resolve_issue.py#L8-L10) [openhands/resolver/issue_resolver.py:52-54](repo://openhands/resolver/issue_resolver.py#L52-L54)

## Choosing the handler

`IssueHandlerFactory` takes the owner, the repository, the token, the platform and the issue type. Its `create` method returns a context object for an issue or for a pull request, and it picks the GitHub, GitLab or Bitbucket variant from the platform. The resolver asks that object for the clone URL.

Sources: [openhands/resolver/issue_handler_factory.py:15-35](repo://openhands/resolver/issue_handler_factory.py#L15-L35) [openhands/resolver/issue_handler_factory.py:36-40](repo://openhands/resolver/issue_handler_factory.py#L36-L40)

## One issue, end to end

`resolve_issue` creates the output directory and an `infer_logs` folder inside it. It then clones the repository into `output_dir/repo` with the handler's clone URL and records the base commit with `git rev-parse HEAD`. A clone that reports a fatal error raises a `RuntimeError`.

Sources: [openhands/resolver/issue_resolver.py:535-545](repo://openhands/resolver/issue_resolver.py#L535-L545) [openhands/resolver/issue_resolver.py:565-585](repo://openhands/resolver/issue_resolver.py#L565-L585)

`process_issue` copies that clone into the workspace folder, creates an LLM registry and a runtime, and connects the runtime. The agent then runs with an event callback attached, and the result is a `ResolverOutput`. `resolve_issue` appends that output to `output.jsonl` as one JSON line.

Sources: [openhands/resolver/issue_resolver.py:397-419](repo://openhands/resolver/issue_resolver.py#L397-L419) [openhands/resolver/issue_resolver.py:654-661](repo://openhands/resolver/issue_resolver.py#L654-L661) [openhands/resolver/issue_resolver.py:603-617](repo://openhands/resolver/issue_resolver.py#L603-L617)

`ResolverOutput` is a Pydantic model whose `git_patch` field holds the change the agent made.

Sources: [openhands/resolver/resolver_output.py:8-9](repo://openhands/resolver/resolver_output.py#L8-L9)

## From patch to pull request

`process_single_issue` takes a finished output and applies its patch to a copy of the repository through `apply_patch`.

Sources: [openhands/resolver/send_pull_request.py:502-510](repo://openhands/resolver/send_pull_request.py#L502-L510) [openhands/resolver/send_pull_request.py:547-547](repo://openhands/resolver/send_pull_request.py#L547-L547) [openhands/resolver/send_pull_request.py:28-34](repo://openhands/resolver/send_pull_request.py#L28-L34)

`make_commit` commits the applied change. The issue type then decides the next call: a pull-request target updates the existing pull request, and an issue target opens a new one with `send_pull_request`.

Sources: [openhands/resolver/send_pull_request.py:162-170](repo://openhands/resolver/send_pull_request.py#L162-L170) [openhands/resolver/send_pull_request.py:233-240](repo://openhands/resolver/send_pull_request.py#L233-L240) [openhands/resolver/send_pull_request.py:393-400](repo://openhands/resolver/send_pull_request.py#L393-L400)
