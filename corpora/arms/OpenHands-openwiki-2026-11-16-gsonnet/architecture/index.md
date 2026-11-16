# Files

- [AgentController, State and Control Flow](agent-controller.md) - How AgentController drives an Agent from event-stream callbacks — when it steps, how pending actions gate stepping, the AgentState machine, iteration/budget limits, stuck detection, delegation to sub-agents, error handling and state persistence.
- [Event Stream, Actions and Observations](event-stream.md) - The EventStream pub/sub backbone — the Event/Action/Observation model, how events are id'd, redacted, serialized and persisted as per-event JSON files with cache pages, how subscribers receive them in order on dedicated threads, and how stores are read back.
- [System Architecture Overview](overview.md) - End-to-end view of how OpenHands components cooperate — clients, server, session, controller, agent, event stream, runtime, memory and LLM — with the two assembly paths (server session and headless run_controller) and the core event-driven loop.
