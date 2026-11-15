# Files

- [Result Backends](result-backends.md) - How Celery stores task states and results — backend selection by URL/alias, the Backend base class (encoding, caching, retries, mark_as_* hooks), key/value stores, synchronous vs asynchronous result consumption, chord join strategies (counter, Redis sorted set, chord_unlock), expiry, and notes on the Redis, RPC and database backends.
- [Result Objects](result-objects.md) - The client-side result API in celery.result — AsyncResult, ResultSet, GroupResult and EagerResult — covering get/join semantics, the synchronous-subtask deadlock guard, parent error propagation, result trees and caching, forget/revoke, and task state precedence in celery.states.
