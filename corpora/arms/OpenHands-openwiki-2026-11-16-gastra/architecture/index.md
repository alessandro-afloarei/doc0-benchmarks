# Files

- [Agent control and CodeAct](agent-control.md) - How AgentController schedules CodeAct steps, correlates runtime observations, enforces limits, and handles confirmation, delegation, and recovery.
- [Events and durable conversation state](events-storage.md) - Event IDs, serialization, dispatch, storage layout, secret filtering, and the separate controller checkpoint used to restore conversations.
- [Runtime execution and sandbox lifecycle](runtime.md) - How runtime adapters execute actions, manage Docker sandboxes and action servers, initialize tools, and report failures back to conversations.
- [Sessions and server APIs](sessions-api.md) - Conversation creation, Socket.IO replay and routing, agent-session startup ordering, cleanup, and server extension boundaries.
- [System architecture and execution flow](system.md) - The ownership boundaries connecting OpenHands interfaces, sessions, agent control, event persistence, LLMs, memory, and runtime execution.
