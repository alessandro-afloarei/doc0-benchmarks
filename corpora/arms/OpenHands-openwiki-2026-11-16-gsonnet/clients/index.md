# Files

- [CLI and Headless Entry Points](cli.md) - The `openhands` command (cli and serve subcommands), its fast-help path, how the interactive terminal session assembles runtime/agent/memory/controller, CLI-specific defaults (cli runtime, confirmation mode, LLM analyzer), slash commands, and the lower-level headless run_controller entry point.
- [Frontend Web App](frontend.md) - Structure of the React 19 / React Router 7 SPA in frontend/ — routes, Redux and React Query state, the Socket.IO client that mirrors the backend event stream, API access, tests and tooling — plus the separate openhands-ui component library.
