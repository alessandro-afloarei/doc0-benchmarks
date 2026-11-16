# Files

- [Result Backends](backends.md) - How Celery stores and retrieves task state and results — backend selection from result_backend URLs, the Backend / BaseKeyValueStoreBackend / AsyncBackendMixin hierarchy, result metadata and exception serialization, retry and caching behaviour, expiry, and the specifics of the Redis, RPC and SQLAlchemy database backends.
- [Result Objects](result-objects.md) - The client-side result API in celery/result.py — AsyncResult, ResultSet, GroupResult and EagerResult — covering get()/join semantics, caching, parent chains and failure propagation, the guard against calling get() inside tasks, serialization as tuples, and how asynchronous backends deliver results through result consumers and drainers.
