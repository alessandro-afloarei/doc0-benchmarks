---
title: "Socket Sessions"
---
## Overview

The socket.io channel is how a browser or a CLI client follows a conversation while it runs. A client connects with a conversation ID, is replayed the events it missed, and then receives every new event from the conversation's stream. Its own messages travel the other way, into the same stream. The connection and the conversation are separate objects: a client can disconnect and reconnect without stopping the agent, and the conversation manager keeps the agent loop alive while any client is attached. The handlers are in `listen_socket.py`, and the per-conversation forwarding is in `WebSession`.

Sources: [openhands/server/listen_socket.py:35-41](repo://openhands/server/listen_socket.py#L35-L41), [openhands/server/session/session.py:40-60](repo://openhands/server/session/session.py#L40-L60)

## Connecting

The `connect` handler reads its query string: the conversation ID, the `latest_event_id` the client already has (defaulting to -1), and the git providers the client uses. A missing conversation ID, or an invalid session API key, refuses the connection. The conversation is then validated for the user, and its metadata is checked.

Sources: [openhands/server/listen_socket.py:35-71](repo://openhands/server/listen_socket.py#L35-L71), [openhands/server/listen_socket.py:96-110](repo://openhands/server/listen_socket.py#L96-L110)

Replay reads every stored event after `latest_event_id`. Three kinds are skipped: null actions and observations, and recall actions, which are internal. The last `AgentStateChangedObservation` is held back and sent after the others, so the client's state indicator ends on the current state. Each event goes to the connection as an `oh_event`.

Sources: [openhands/server/listen_socket.py:116-150](repo://openhands/server/listen_socket.py#L116-L150)

After replay, the handler builds the conversation's initial settings and calls `join_conversation`. Joining puts the connection in the conversation's room, records which conversation the connection belongs to, and starts the agent loop if none is running. A missing result refuses the connection.

Sources: [openhands/server/listen_socket.py:150-168](repo://openhands/server/listen_socket.py#L150-L168), [openhands/server/conversation_manager/standalone_conversation_manager.py:151-166](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L151-L166)

## Client messages

`oh_user_action` hands the client's JSON to the manager's `send_to_event_stream`, which finds the session for the connection and calls its `dispatch`. `dispatch` parses the JSON into an event, checks that an image message is allowed by the model, and adds the event to the stream with the user as its source. The conversation's controller then handles it as any user message.

Sources: [openhands/server/listen_socket.py:143-147](repo://openhands/server/listen_socket.py#L143-L147), [openhands/server/session/session.py:353-369](repo://openhands/server/session/session.py#L353-L369)

The older `oh_action` event is routed to the same handler. The code keeps it for clients that have not been updated, and it is marked for removal.

Sources: [openhands/server/listen_socket.py:148-153](repo://openhands/server/listen_socket.py#L148-L153)

## Forwarding events

`WebSession` subscribes to the conversation's stream under the server subscriber ID. Its callback forwards each event whose source is the agent or the user. Null actions and null observations are dropped, and events from the environment, such as recall observations, are not forwarded.

Sources: [openhands/server/session/session.py:97-102](repo://openhands/server/session/session.py#L97-L102), [openhands/server/session/session.py:311-352](repo://openhands/server/session/session.py#L311-L352)

Sending goes through a publish queue. A monitor task takes each message off the queue and sends it, and before the first send it waits up to two seconds for the websocket to finish opening. A session with no live socket does not send. A client that was not connected misses those live messages, and its next connection replays the stored events it lacks.

Sources: [openhands/server/session/session.py:371-417](repo://openhands/server/session/session.py#L371-L417)

## Disconnecting

The `disconnect` handler calls `disconnect_from_session` with the connection ID. The manager forgets the connection, and when no connection is left for the conversation, the conversation moves to the detached table. The agent loop keeps running, and a later reconnect finds it. The cleanup of detached loops is described on [[Conversation Lifecycle]].

Sources: [openhands/server/listen_socket.py:156-160](repo://openhands/server/listen_socket.py#L156-L160), [openhands/server/conversation_manager/standalone_conversation_manager.py:397-428](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L397-L428), [openhands/server/conversation_manager/standalone_conversation_manager.py:167-178](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L167-L178)

Replay also explains why reconnecting is cheap. The client sends the last event ID it received, so only the missed events are sent again. The session does not keep a per-client queue, so a client that was away for a long time gets its history from the stored events rather than from memory.

Sources: [openhands/server/listen_socket.py:96-120](repo://openhands/server/listen_socket.py#L96-L120), [openhands/events/async_event_store_wrapper.py:8-23](repo://openhands/events/async_event_store_wrapper.py#L8-L23)
