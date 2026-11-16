# Files

- [Git Provider Integrations and Issue Resolver](git-providers-and-resolver.md) - How OpenHands talks to GitHub, GitLab, and Bitbucket through per-provider services and a ProviderHandler that injects tokens into the runtime, and how the openhands/resolver package turns labeled issues and review comments into automated fixes and pull requests.
- [Model Context Protocol (MCP) Integration](mcp.md) - How OpenHands models MCP servers as configuration, connects to them from the sandbox, exposes their tools to the agent as MCPAction events, and also runs its own FastMCP server at /mcp with git pull-request tools.
