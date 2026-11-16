# Files

- [Agent Hub and CodeActAgent](codeact-agent.md) - The Agent abstraction and registry, how CodeActAgent turns state into an LLM call and then into Actions via function calling, which tools it exposes, and how the other agenthub agents derive from it.
- [Conversation Memory and History Condensation](memory-and-condensation.md) - How the event history is turned into LLM messages (ConversationMemory), how Views and Condensers shrink long histories, the available condenser strategies, and how the Memory class answers recall requests with workspace context and microagent knowledge.
- [Microagents and Knowledge Recall](microagents.md) - What microagents are, how their type is inferred from Markdown frontmatter, where they are loaded from (global, user, repository, organization, legacy files) and how they reach the agent through RecallAction/RecallObservation.
