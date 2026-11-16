---
title: "Browser Environment"
---
## Overview

Agents browse the web through BrowserGym, a library that drives a headless Chromium with Playwright and describes each page as an accessibility tree whose elements carry short ids called `bid`s. The action server runs it in a separate process as `BrowserEnv`, sends it one action string at a time, and turns the result into a `BrowserOutputObservation` with the page text, the accessibility tree, a screenshot and a set-of-marks image that labels interactive elements with their ids.

Sources: [openhands/runtime/browser/browser_env.py:23-38](repo://openhands/runtime/browser/browser_env.py#L23-L38), [openhands/runtime/browser/browser_env.py:165-180](repo://openhands/runtime/browser/browser_env.py#L165-L180)

Two actions reach it. `BrowseURLAction(url)` is the legacy way to open a page. `BrowseInteractiveAction(browser_actions)` carries Python-like BrowserGym calls such as `goto(...)`, `click('a51')` or `fill('a12', 'text')`, which the [[CodeAct Agent]]'s `browser` tool and the browsing agents on [[Agents]] produce.

Sources: [openhands/events/action/browse.py:8-48](repo://openhands/events/action/browse.py#L8-L48)

## The browser process

### Starting

`BrowserEnv.__init__` creates a `multiprocessing` pipe and starts `browser_process` in a spawned process, then waits up to 200 seconds for it to answer an `IS_ALIVE` ping; initialisation is retried up to five times. The action server starts this in the background at boot and waits for it only when the first browse action arrives, so a slow browser does not delay the sandbox. It is skipped when the browser is disabled and on Windows.

Sources: [openhands/runtime/browser/browser_env.py:23-67](repo://openhands/runtime/browser/browser_env.py#L23-L67), [openhands/runtime/action_execution_server.py:229-267](repo://openhands/runtime/action_execution_server.py#L229-L267)

The process creates the `browsergym/openended` environment, headless, starting at `about:blank`, with downloads accepted into `/workspace/.downloads/`. In evaluation mode (`sandbox.browsergym_eval_env`) it instead creates a WebArena, VisualWebArena or MiniWoB task environment and records the task's goal text and images.

Sources: [openhands/runtime/browser/browser_env.py:69-121](repo://openhands/runtime/browser/browser_env.py#L69-L121)

### The pipe protocol

| Request | Reply |
| --- | --- |
| `(id, {'action': action_str})` | `(id, observation)` after `env.step(action_str)` |
| `('IS_ALIVE', None)` | `('ALIVE', None)` |
| `('SHUTDOWN', None)` | closes the environment and exits |
| `GET_EVAL_GOAL`, `GET_EVAL_REWARDS` actions | the evaluation goal, or the rewards collected so far |

Sources: [openhands/runtime/browser/browser_env.py:123-180](repo://openhands/runtime/browser/browser_env.py#L123-L180)

Before replying to a step, the process adds the page's text (the DOM flattened and converted to Markdown-like text with `html2text`, keeping links and replacing images with their alt text), and encodes the screenshot and the set-of-marks overlay as PNG data URLs so the observation can cross the pipe.

Sources: [openhands/runtime/browser/browser_env.py:40-49](repo://openhands/runtime/browser/browser_env.py#L40-L49), [openhands/runtime/browser/browser_env.py:165-180](repo://openhands/runtime/browser/browser_env.py#L165-L180)

On the caller's side, `step` sends a request with a fresh UUID and polls the pipe until the matching reply arrives, raising `TimeoutError` after 120 seconds. `close` sends `SHUTDOWN` and escalates to terminate and kill if the process does not exit.

Sources: [openhands/runtime/browser/browser_env.py:189-229](repo://openhands/runtime/browser/browser_env.py#L189-L229)

## From action to observation

### Executing

`browse(action, browser, workspace_dir)` turns a `BrowseURLAction` into `goto("<url>")` (a URL not starting with `http` is treated as a path relative to the current directory) and passes a `BrowseInteractiveAction`'s string through unchanged. It runs the step in a worker thread, saves the screenshot as `.browser_screenshots/screenshot_<timestamp>.png` in the workspace, and builds a `BrowserOutputObservation` with URL, screenshot and its saved path, set-of-marks image, open pages, focused element, accessibility tree, last action and its error.

Sources: [openhands/runtime/browser/utils.py:100-198](repo://openhands/runtime/browser/utils.py#L100-L198)

Unless the action asked for `return_axtree`, the bulky DOM and accessibility tree objects are dropped from the observation after its text has been built. An exception during the step becomes an observation with `error=True` and the message as content, not a failed request.

Sources: [openhands/runtime/browser/utils.py:200-223](repo://openhands/runtime/browser/utils.py#L200-L223)

### What the agent reads

`get_agent_obs_text` writes the observation's content. For an interactive action it gives the current URL, the focused element's bid, the screenshot path, either the error message or `[Action executed successfully.]`, and the accessibility tree of the complete page with a reminder to refer to elements by bid. For a plain URL visit it gives the URL, any error, and the page text.

Sources: [openhands/runtime/browser/utils.py:19-97](repo://openhands/runtime/browser/utils.py#L19-L97)

When visual browsing is enabled, [[Conversation Memory and Prompts]] also attaches the set-of-marks image, or the plain screenshot, to interactive browsing results for models with vision.

Sources: [openhands/memory/conversation_memory.py:451-470](repo://openhands/memory/conversation_memory.py#L451-L470)

### Downloads

A click that downloads a file makes the BrowserGym step fail. The action server then looks in `/workspace/.downloads` and, if a new file is there, copies it into the workspace and returns a `FileDownloadObservation` with its path instead of the error.

Sources: [openhands/runtime/action_execution_server.py:599-643](repo://openhands/runtime/action_execution_server.py#L599-L643)

## Tools that produce browser actions

### The CodeAct browser tool

The `browser` tool exposes BrowserGym's `bid` and `nav` action subsets with multi-action enabled, so one call may contain several lines, executed in order without feedback in between; the description warns that more than two or three usually fails. Assertions run at import time to check that the tool description still matches BrowserGym's action signatures.

Sources: [openhands/agenthub/codeact_agent/tools/browser.py:10-30](repo://openhands/agenthub/codeact_agent/tools/browser.py#L10-L30), [openhands/agenthub/codeact_agent/tools/browser.py:139-171](repo://openhands/agenthub/codeact_agent/tools/browser.py#L139-L171)

The tool's description also tells the model how to look at local PDFs and images: read the file viewer's URL from `/tmp/oh-server-url`, which the action server writes at startup, and open `<url>/view?path=<absolute path>` in the browser.

Sources: [openhands/agenthub/codeact_agent/tools/browser.py:27-31](repo://openhands/agenthub/codeact_agent/tools/browser.py#L27-L31), [openhands/runtime/file_viewer_server.py:76-112](repo://openhands/runtime/file_viewer_server.py#L76-L112)

### The browsing agents' parser

`BrowsingAgent` and `VisualBrowsingAgent` do not use tool calls; their replies are text with the action in a fenced block. `BrowsingResponseParser` completes a reply cut off by the stop sequence by appending the missing closing parenthesis and fence. A reply without a fenced block becomes a `send_msg_to_user` message. Otherwise the text before the block is the thought and the block is the browser actions, and if they contain `send_msg_to_user(...)` its argument is extracted into `browsergym_send_msg_to_user`, which the agent turns into a message to the user.

Sources: [openhands/agenthub/browsing_agent/response_parser.py:12-126](repo://openhands/agenthub/browsing_agent/response_parser.py#L12-L126), [openhands/agenthub/browsing_agent/browsing_agent.py:170-176](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L170-L176)

## Configuration

`enable_browser` in `[core]` (default true) controls whether the server starts a browser and whether the runtime image installs Chromium; `enable_browsing` in an agent's config controls whether the agent gets the browser tool. The CLI runtime has no browser and turns browsing off.

Sources: [openhands/core/config/openhands_config.py:77-77](repo://openhands/core/config/openhands_config.py#L77-L77), [openhands/core/config/agent_config.py:24-25](repo://openhands/core/config/agent_config.py#L24-L25), [openhands/runtime/utils/command.py:65-66](repo://openhands/runtime/utils/command.py#L65-L66), [openhands/core/config/utils.py:458-470](repo://openhands/core/config/utils.py#L458-L470)
