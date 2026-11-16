# Files

- [Runtime Architecture](runtime-architecture.md) - How OpenHands executes agent actions — the Runtime base class as an event-stream subscriber, the ActionExecutionClient HTTP protocol, the in-sandbox action_execution_server with its tmux-backed bash session, Jupyter/agent-skills/VS Code plugins, file editor and browser, plus workspace setup (clone, setup.sh, git hooks), git change tracking, and error handling.
- [Runtime Implementations and Image Building](runtime-implementations.md) - The concrete OpenHands runtimes — Docker, Remote, Local, Kubernetes, CLI, and optional third-party runtimes — how one is selected, their lifecycle, ports, and isolation trade-offs, the [sandbox] configuration, and how runtime sandbox images are built, tagged, and reused.
