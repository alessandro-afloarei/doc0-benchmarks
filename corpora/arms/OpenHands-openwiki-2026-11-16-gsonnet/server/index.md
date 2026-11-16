# Files

- [Server, Sessions and Conversation Management](server-and-sessions.md) - The OpenHands web server — FastAPI app and Socket.IO listener, REST route groups, the WebSession/AgentSession pair per conversation, ConversationManager responsibilities (agent-loop start, limits, cleanup), user-auth and other pluggable classes, and how settings become runtime configuration.
- [Storage and Persistence](storage-and-persistence.md) - The FileStore abstraction and its local, in-memory, S3, Google Cloud and web-hook-wrapped backends; the on-disk layout of conversations (events, agent state, stats, metadata); and the settings, secrets and conversation-metadata stores built on top.
