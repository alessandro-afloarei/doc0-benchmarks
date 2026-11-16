---
title: "Enterprise Integrations"
---
## Overview

OpenHands Cloud lets people start the agent from where they already work: by labelling a GitHub or GitLab issue, mentioning the agent in a comment, a Jira or Linear ticket, or a Slack message. Each integration receives the platform's webhook, decides whether the event asks for work, starts an ordinary OpenHands conversation for the right user and repository, and later posts a summary of the result back to the place the request came from.

Sources: [enterprise/integrations/manager.py:6-30](repo://enterprise/integrations/manager.py#L6-L30), [enterprise/saas_server.py:68-98](repo://enterprise/saas_server.py#L68-L98)

These integrations run inside the [[Enterprise Server]] and create conversations through the same service the web UI uses, described on [[Conversation Managers]].

Sources: [enterprise/integrations/github/github_view.py:156-180](repo://enterprise/integrations/github/github_view.py#L156-L180)

## The pattern

### Manager, view and callback

Every integration has the same three parts:

Sources: [enterprise/integrations/manager.py:6-30](repo://enterprise/integrations/manager.py#L6-L30)

| Part | Role |
| --- | --- |
| Webhook route | verifies the request and wraps the payload in a `Message` with its `SourceType` |
| `Manager` | `receive_message`, `is_job_requested`, `start_job`, `send_message` |
| View | a typed object built from the payload (issue, issue comment, PR comment, inline PR comment, Slack message...) that knows how to render instructions and create the conversation |
| Callback processor | registered on the conversation; reports back when the agent stops |

Sources: [enterprise/integrations/manager.py:6-30](repo://enterprise/integrations/manager.py#L6-L30), [enterprise/integrations/github/github_view.py:85-180](repo://enterprise/integrations/github/github_view.py#L85-L180), [enterprise/server/conversation_callback_processor/README.md:1-40](repo://enterprise/server/conversation_callback_processor/README.md#L1-L40)

### Webhook routes

| Platform | Routes |
| --- | --- |
| GitHub | `POST /integration/github/events` |
| GitLab | `POST /integration/gitlab/events` |
| Slack | `/install`, `/install-callback`, `/keycloak-callback`, `POST /on-event`, `POST /on-form-interaction` |
| Jira, Jira Data Center, Linear | `POST /events`, workspace creation, linking and unlinking, OAuth `/callback` |

Sources: [enterprise/server/routes/integration/github.py:45-80](repo://enterprise/server/routes/integration/github.py#L45-L80), [enterprise/server/routes/integration/gitlab.py:35-40](repo://enterprise/server/routes/integration/gitlab.py#L35-L40), [enterprise/server/routes/integration/slack.py:55-62](repo://enterprise/server/routes/integration/slack.py#L55-L62), [enterprise/server/routes/integration/slack.py:238-300](repo://enterprise/server/routes/integration/slack.py#L238-L300), [enterprise/server/routes/integration/jira.py:215-270](repo://enterprise/server/routes/integration/jira.py#L215-L270), [enterprise/server/routes/integration/linear.py:213-270](repo://enterprise/server/routes/integration/linear.py#L213-L270)

## GitHub

### Receiving an event

The GitHub route can be turned off with `GITHUB_WEBHOOKS_ENABLED`. It checks the `X-Hub-Signature-256` HMAC against the app's webhook secret, requires an installation id, and passes the payload and installation to `GithubManager.receive_message`.

Sources: [enterprise/server/routes/integration/github.py:1-80](repo://enterprise/server/routes/integration/github.py#L1-L80)

`receive_message` first hands the payload to a data collector, then asks `is_job_requested`. A job is requested by an issue labelled with the OpenHands label, or an issue comment, PR comment or inline review comment that mentions the agent exactly, and only when the sender has write access to the repository. Comments containing OpenHands' own failing-workflow suggestions are ignored, and eligible events can also trigger a proactive conversation starter.

Sources: [enterprise/integrations/github/github_manager.py:121-183](repo://enterprise/integrations/github/github_manager.py#L121-L183), [enterprise/integrations/github/github_view.py:431-500](repo://enterprise/integrations/github/github_view.py#L431-L500)

### Starting the job

For a requested job, the manager builds the view, stores the installation's access token, adds an "eyes" reaction to acknowledge the request, and calls `start_job`:

Sources: [enterprise/integrations/github/github_manager.py:166-183](repo://enterprise/integrations/github/github_manager.py#L166-L183)

1. It looks up the requesting GitHub user's token through the token manager; without one, it asks the user to log in to OpenHands Cloud again.
2. It initialises the conversation metadata, then, before any runtime starts, may generate a solvability summary of the issue, so its LLM cost is charged to the conversation.
3. It creates the conversation with the user's GitHub token, custom secrets, and instructions rendered from the issue or comment.
4. It registers a `GithubCallbackProcessor` for the conversation.
5. It replies "I'm on it!" with a link to track progress, plus the solvability summary if there is one, or explains a missing LLM key.

Sources: [enterprise/integrations/github/github_manager.py:157-183](repo://enterprise/integrations/github/github_manager.py#L157-L183), [enterprise/integrations/github/github_manager.py:217-335](repo://enterprise/integrations/github/github_manager.py#L217-L335), [enterprise/integrations/github/github_view.py:100-180](repo://enterprise/integrations/github/github_view.py#L100-L180)

Replies go back as an issue comment, or as a reply in the review thread for inline PR comments, using the installation token.

Sources: [enterprise/integrations/github/github_manager.py:185-215](repo://enterprise/integrations/github/github_manager.py#L185-L215)

## Slack

`SlackManager` maps the Slack user to an OpenHands user; an unknown user gets an ephemeral login link carrying a signed state, which links the accounts after Keycloak login. A new mention starts a conversation directly when the message names one of the user's repositories, and otherwise replies with a repository selection form whose answer arrives at `/on-form-interaction`. A message in an existing conversation's thread is sent to that conversation. Replies go into the same channel and thread.

Sources: [enterprise/integrations/slack/slack_manager.py:42-120](repo://enterprise/integrations/slack/slack_manager.py#L42-L120), [enterprise/integrations/slack/slack_manager.py:180-298](repo://enterprise/integrations/slack/slack_manager.py#L180-L298)

GitLab, Jira, Jira Data Center and Linear follow the same pattern with their own managers, views and callback processors; the issue-tracker integrations additionally link a workspace to OpenHands and map tracker users to OpenHands users through the workspace routes.

Sources: [enterprise/integrations/gitlab/gitlab_manager.py:1-40](repo://enterprise/integrations/gitlab/gitlab_manager.py#L1-L40), [enterprise/server/routes/integration/jira.py:267-340](repo://enterprise/server/routes/integration/jira.py#L267-L340)

## Reporting back

### Conversation callbacks

A `ConversationCallback` row in the database stores a conversation id, a status (`ACTIVE`, `COMPLETED`, `ERROR`) and a serialised processor. When a nested runtime pushes an `AgentStateChangedObservation` to the event webhook, `invoke_conversation_callbacks` loads and runs every active processor for that conversation.

Sources: [enterprise/server/conversation_callback_processor/README.md:13-40](repo://enterprise/server/conversation_callback_processor/README.md#L13-L40), [enterprise/server/utils/conversation_callback_utils.py:40-70](repo://enterprise/server/utils/conversation_callback_utils.py#L40-L70), [enterprise/server/utils/conversation_callback_utils.py:72-80](repo://enterprise/server/utils/conversation_callback_utils.py#L72-L80), [enterprise/server/utils/conversation_callback_utils.py:159-170](repo://enterprise/server/utils/conversation_callback_utils.py#L159-L170)

### The summary handshake

`GithubCallbackProcessor` acts when the agent is waiting for input or finished. The first time, it sends the agent a summary instruction as a new user message and saves itself with that step done, so the agent writes a summary of what it did. The next time, it extracts that summary from the conversation's events, appends a "View full conversation" link, posts it to the issue or PR, and marks the callback completed.

Sources: [enterprise/server/conversation_callback_processor/github_callback_processor.py:27-140](repo://enterprise/server/conversation_callback_processor/github_callback_processor.py#L27-L140), [enterprise/integrations/utils.py:77-80](repo://enterprise/integrations/utils.py#L77-L80), [enterprise/integrations/utils.py:282-306](repo://enterprise/integrations/utils.py#L282-L306)

## Solvability analysis

Before starting a resolver conversation, the GitHub integration can attach a solvability report, if enabled. `SolvabilityClassifier` uses an LLM-driven `Featurizer` to extract boolean features from the issue description, scores them with a scikit-learn random forest classifier, and explains the prediction with feature importances (SHAP, permutation or impurity); `summarize_issue_solvability` runs it with the user's LLM settings within a five-minute timeout and turns the result into a short summary for the reply.

Sources: [enterprise/integrations/solvability/models/classifier.py:20-80](repo://enterprise/integrations/solvability/models/classifier.py#L20-L80), [enterprise/integrations/github/github_solvability.py:63-95](repo://enterprise/integrations/github/github_solvability.py#L63-L95)
