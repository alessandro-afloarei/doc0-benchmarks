---
title: "VS Code Integration"
---
## Overview

OpenHands meets VS Code in two separate ways. A small VS Code extension, bundled with the Python package, starts the [[CLI]] in an editor terminal, optionally with the current file or selection as the task, so a user can hand work to the agent without leaving the editor. Separately, the web application can open a browser-based VS Code inside each sandbox; that server is the VS Code plugin described on [[Runtime Plugins]].

Sources: [openhands/integrations/vscode/package.json:20-80](repo://openhands/integrations/vscode/package.json#L20-L80), [openhands/runtime/plugins/vscode/__init__.py:19-30](repo://openhands/runtime/plugins/vscode/__init__.py#L19-L30)

This page covers the editor extension: its commands, how it runs the CLI, and how the CLI installs it.

Sources: [openhands/integrations/vscode/src/extension.ts:283-380](repo://openhands/integrations/vscode/src/extension.ts#L283-L380)

## Commands

### Contributed commands

The extension contributes three commands, available from the command palette and, for the last two, from an "OpenHands" submenu in the editor's context menu.

Sources: [openhands/integrations/vscode/package.json:20-77](repo://openhands/integrations/vscode/package.json#L20-L77)

| Command | Title | Available when | Starts the CLI with |
| --- | --- | --- | --- |
| `openhands.startConversation` | Start New Conversation | always | no task |
| `openhands.startConversationWithFileContext` | Start with File Content | an editor is open | `--file <path>` for a saved file; for an untitled file, its content as `--task` |
| `openhands.startConversationWithSelectionContext` | Start with Selected Text | text is selected | the selection, file name, language and line range as `--task` |

Sources: [openhands/integrations/vscode/package.json:20-77](repo://openhands/integrations/vscode/package.json#L20-L77), [openhands/integrations/vscode/src/extension.ts:293-375](repo://openhands/integrations/vscode/src/extension.ts#L293-L375)

An empty untitled file, or no editor at all, starts a conversation without a task. The context messages describe the file or selection with its language, so the agent knows what it is looking at; the CLI's own `--file` handling then asks the agent to read the file and ask what to do with it.

Sources: [openhands/integrations/vscode/src/extension.ts:173-228](repo://openhands/integrations/vscode/src/extension.ts#L173-L228), [openhands/cli/main.py:715-728](repo://openhands/cli/main.py#L715-L728)

## Running the CLI in a terminal

### Building the command line

`buildOpenHandsCommand` produces `openhands`, `openhands --file <path>` (quoted when the path contains spaces) or `openhands --task "<text>"` with backticks and double quotes escaped. If the workspace has a `.venv`, `venv` or `.virtualenv` folder, an activation command for it is prepended (`source .../bin/activate &&`, or the PowerShell `Activate.ps1` on Windows), so the `openhands` installed in the project's environment is used.

Sources: [openhands/integrations/vscode/src/extension.ts:137-171](repo://openhands/integrations/vscode/src/extension.ts#L137-L171), [openhands/integrations/vscode/src/extension.ts:230-253](repo://openhands/integrations/vscode/src/extension.ts#L230-L253)

### Choosing a terminal

Terminals the extension creates are named `OpenHands <time>`. It reuses the most recent one only if it knows that terminal is idle, meaning a command it started there has finished, and otherwise opens a new one, so an agent session already running in a terminal is never interrupted by typing into it. Closing a terminal removes it from the idle set.

Sources: [openhands/integrations/vscode/src/extension.ts:23-88](repo://openhands/integrations/vscode/src/extension.ts#L23-L88), [openhands/integrations/vscode/src/extension.ts:283-292](repo://openhands/integrations/vscode/src/extension.ts#L283-L292)

### Executing

When the terminal has shell integration, the command runs through `shellIntegration.executeCommand` and the terminal is marked idle again when the execution ends. Without shell integration it falls back to `sendText`, and since completion cannot be observed, the terminal is not marked idle and will not be reused.

Sources: [openhands/integrations/vscode/src/extension.ts:95-135](repo://openhands/integrations/vscode/src/extension.ts#L95-L135), [openhands/integrations/vscode/src/extension.ts:255-281](repo://openhands/integrations/vscode/src/extension.ts#L255-L281)

## Automatic installation

### From the CLI

Each time the CLI starts, `attempt_vscode_extension_install` checks whether it is running inside VS Code (`TERM_PROGRAM=vscode`) or Windsurf. If so, and no flag file `~/.openhands/.<editor>_extension_installed` exists, it checks whether the extension is already installed and otherwise tries to install it: first the `.vsix` bundled in the Python package, then the latest `.vsix` from the GitHub releases, using the editor's command line (`code` or `surf`). Success writes the flag file so later starts skip the check; failure prints instructions and tries again next time.

Sources: [openhands/cli/vscode_extension.py:58-131](repo://openhands/cli/vscode_extension.py#L58-L131), [openhands/cli/vscode_extension.py:133-145](repo://openhands/cli/vscode_extension.py#L133-L145), [openhands/cli/vscode_extension.py:13-56](repo://openhands/cli/vscode_extension.py#L13-L56), [openhands/cli/main.py:592-592](repo://openhands/cli/main.py#L592-L592)

### Building the .vsix

The package's Poetry build runs `build_vscode.py`, which runs `npm install` and `npm run package-vsix` in `openhands/integrations/vscode` to produce `openhands-vscode-<version>.vsix`, then includes it in the wheel. `SKIP_VSCODE_BUILD` skips the build and uses an existing file; a failed npm build is reported as a warning and the package is built without the extension.

Sources: [build_vscode.py:1-56](repo://build_vscode.py#L1-L56), [build_vscode.py:56-110](repo://build_vscode.py#L56-L110), [pyproject.toml:19-23](repo://pyproject.toml#L19-L23)
