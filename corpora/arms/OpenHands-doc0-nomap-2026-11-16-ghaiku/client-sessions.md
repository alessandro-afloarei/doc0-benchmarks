---
title: "Client Sessions and Socket.IO"
---
## Overview

A client talks to a conversation over one Socket.IO connection. The connection joins a room named after the conversation id. Events the agent produces are sent to that room as `oh_event` messages, and the client sends its own actions back as `oh_user_action` messages. The usual path is that [[Conversation Lifecycle]] starts the loop over HTTP first; a connection that finds no running loop starts one when it joins.

Sources: [openhands/server/listen_socket.py:35-40](repo://openhands/server/listen_socket.py#L35-L40), [openhands/server/listen_socket.py:143-152](repo://openhands/server/listen_socket.py#L143-L152), [openhands/server/constants.py:3](repo://openhands/server/constants.py#L3)

The Socket.IO server wraps the FastAPI application, so one ASGI app serves both the REST routes and the socket endpoint.

Sources: [openhands/server/listen.py:27](repo://openhands/server/listen.py#L27)

## Connecting

The `connect` handler reads the query string. `latest_event_id` tells it where to resume the replay and defaults to -1. `conversation_id` is required, and the connection is refused without it. The handler also rejects a `session_api_key` query value that does not match the `SESSION_API_KEY` environment variable.

Sources: [openhands/server/listen_socket.py:36-64](repo://openhands/server/listen_socket.py#L36-L64)

The conversation validator checks the cookie or bearer header and returns the user id. The handler then opens an `EventStore` for the conversation. A missing store refuses the connection.

Sources: [openhands/server/listen_socket.py:66-86](repo://openhands/server/listen_socket.py#L66-L86)

## Replaying events

The handler replays the stored events starting at `latest_event_id + 1`. `NullAction`, `NullObservation` and `RecallAction` are skipped. The most recent `AgentStateChangedObservation` is held back and sent last, so the client sees the current state after the history.

Sources: [openhands/server/listen_socket.py:91-114](repo://openhands/server/listen_socket.py#L91-L114)

After the replay, the handler loads the settings for the providers in the query and calls `join_conversation`. That call enters the Socket.IO room for the conversation and records which conversation this connection id belongs to. It then calls `maybe_start_agent_loop`, so a client that joins a conversation with no running loop starts one. A `None` result refuses the connection.

Sources: [openhands/server/listen_socket.py:120-132](repo://openhands/server/listen_socket.py#L120-L132), [openhands/server/conversation_manager/standalone_conversation_manager.py:151-165](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L151-L165)

## Receiving events

`WebSession` subscribes its `on_event` method to the agent's event stream under the `SERVER` subscriber. Each event passes through `_on_event`, which filters what the client sees.

Sources: [openhands/server/session/session.py:99-101](repo://openhands/server/session/session.py#L99-L101), [openhands/server/session/session.py:311-312](repo://openhands/server/session/session.py#L311-L312)

`NullAction` and `NullObservation` are dropped. Agent and user events are sent as they are. Environment events are sent only when they are a command output, a state change or a recall, and they are relabelled with the `AGENT` source so the UI shows them as agent feedback. Error observations are relabelled the same way.

Sources: [openhands/server/session/session.py:322-351](repo://openhands/server/session/session.py#L322-L351)

`send` does not write to the socket. It puts the event on a publish queue. A monitor task takes events off that queue and emits them to the room.

Sources: [openhands/server/session/session.py:371-380](repo://openhands/server/session/session.py#L371-L380)

`_send` holds back the first emit for up to two seconds, until a client is listening in the room. It then emits `oh_event` to the room, and it marks the session as no longer alive if the emit raises a `RuntimeError`.

Sources: [openhands/server/session/session.py:382-416](repo://openhands/server/session/session.py#L382-L416)

## Sending actions

`oh_user_action` and the older `oh_action` handler do the same thing. Each passes the data to `send_to_event_stream`. The manager finds the conversation from the connection id and calls `dispatch` on that conversation's session. `oh_action` is kept for clients that have not moved to the new name.

Sources: [openhands/server/listen_socket.py:143-152](repo://openhands/server/listen_socket.py#L143-L152), [openhands/server/conversation_manager/standalone_conversation_manager.py:369-380](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L369-L380)

An action sent on a connection that never joined a conversation fails with `no_connected_session`. A message sent to a conversation with no running session fails with `no_conversation`.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:369-380](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L369-L380)

## Disconnecting

The `disconnect` handler calls `disconnect_from_session`. That method removes the connection id from the connection-to-conversation map and returns. It does not stop the conversation, so the agent keeps running when the browser closes.

Sources: [openhands/server/listen_socket.py:155-158](repo://openhands/server/listen_socket.py#L155-L158), [openhands/server/conversation_manager/standalone_conversation_manager.py:397-408](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L397-L408)

`WebSession.close` is the other end of the session's life. It tells the room the state is `STOPPED`, marks the session dead and closes the agent session. [[Conversation Lifecycle]] covers the stop endpoint that calls it.

Sources: [openhands/server/session/session.py:119-130](repo://openhands/server/session/session.py#L119-L130)

## Attaching without a loop

Routes that only read a conversation, such as `get_conversation`, do not need a running loop. They call `attach_to_conversation`, which reuses a `ServerConversation` that is active or detached, or builds one from the running session's event stream and runtime when there is one. It returns `None` when the conversation does not exist or the runtime cannot be reached.

Sources: [openhands/server/utils.py:100-104](repo://openhands/server/utils.py#L100-L104), [openhands/server/conversation_manager/standalone_conversation_manager.py:91-149](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L91-L149), [openhands/server/session/conversation.py:12-19](repo://openhands/server/session/conversation.py#L12-L19)

The loop that consumes the client's actions is described in [[Agent Controller]], and the frontend that opens this connection is described in [[Web Frontend]].

Sources: [openhands/controller/agent_controller.py:433-438](repo://openhands/controller/agent_controller.py#L433-L438), [frontend/src/context/ws-client-provider.tsx:156-156](repo://frontend/src/context/ws-client-provider.tsx#L156-L156), [frontend/src/context/ws-client-provider.tsx:342-351](repo://frontend/src/context/ws-client-provider.tsx#L342-L351)
