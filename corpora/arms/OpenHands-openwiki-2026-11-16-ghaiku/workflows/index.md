# Files

- [Conversation Lifecycle End to End](conversation-lifecycle.md) - Trace of a conversation from the first user message through creation, agent-loop start, the controller and runtime step cycle, event delivery to the browser, user confirmations, stop and error paths, and cleanup, with the functions and files that implement each stage.
- [Memory, Context Condensation, and Conversation Memory](memory-and-condensation.md) - How OpenHands keeps a long conversation within the model's context window through condensers that forget or summarize events, how the agent's view of history is built from condensation events, how ConversationMemory turns events into LLM messages, and how the Memory component injects repository, runtime, and microagent knowledge.
