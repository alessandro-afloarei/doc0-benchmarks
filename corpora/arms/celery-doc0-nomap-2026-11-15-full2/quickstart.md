---
title: "Quickstart"
---
## Overview

This page takes you from an empty virtualenv to a task that runs in a worker and returns its result. You need three things: the `celery` package, a message broker (RabbitMQ or Redis), and, if you want return values back, a result backend. The broker carries task messages from your code to the worker; the result backend carries states and return values back.

Sources: [docs/getting-started/first-steps-with-celery.rst:301-307](repo://docs/getting-started/first-steps-with-celery.rst#L301-L307), [README.rst:147-153](repo://README.rst#L147-L153)

The packaging metadata requires Python 3.10 or newer, and installing Celery pulls in `kombu`, `billiard`, `vine`, `click` and a few small libraries.

Sources: [setup.py:150-153](repo://setup.py#L150-L153), [requirements/default.txt:1-10](repo://requirements/default.txt#L1-L10)

## Install Celery

### Install with pip

Install the package from PyPI:

Sources: [README.rst:304-309](repo://README.rst#L304-L309)

```bash
pip install -U celery
```

Sources: [README.rst:307-312](repo://README.rst#L307-L312)

### Bundles (extras)

Optional dependencies are grouped into bundles that you name in brackets; several bundles can be combined with commas. Each bundle maps to a file in `requirements/extras/`: `setup.py` builds `extras_require` as `{x: extras(x + '.txt') for x in EXTENSIONS}`.

Sources: [README.rst:319-324](repo://README.rst#L319-L324), [setup.py:12-47](repo://setup.py#L12-L47), [setup.py:113-125](repo://setup.py#L113-L125)

```bash
pip install "celery[redis]"
pip install "celery[redis,auth,msgpack]"
```

Sources: [README.rst:326-331](repo://README.rst#L326-L331)

| Bundle | Installs | Use it for |
| --- | --- | --- |
| `redis` | `kombu[redis]` | Redis as broker or result backend |
| `sqs` | `boto3`, `pycurl`, `urllib3`, `kombu[sqs]` | Amazon SQS broker |
| `gcpubsub` | `kombu[gcpubsub]` | Google Pub/Sub broker |
| `librabbitmq` | `librabbitmq` (Python below 3.11 only) | The C RabbitMQ client |
| `msgpack`, `yaml` | `kombu[msgpack]`, `kombu[yaml]` | Extra serializers |
| `auth` | `cryptography` | The message-signing `auth` serializer |
| `brotli`, `zstd` | `brotli`/`brotlipy`, `zstandard` | Extra compression schemes |
| `gevent` | `gevent` | The gevent pool |
| `sqlalchemy` | `kombu[sqlalchemy]` | Database result backend |
| `mongodb`, `cassandra`, `elasticsearch`, `couchbase`, `couchdb`, `arangodb` | Each database's client | Those result backends |
| `s3`, `dynamodb`, `gcs`, `azureblockblob`, `cosmosdbsql` | `boto3`, Google Cloud or Azure clients | Cloud storage result backends |
| `memcache`, `pymemcache` | `pylibmc`, `python-memcached` | Memcached cache backend |
| `tblib` | `tblib` | `task_remote_tracebacks` |
| `pydantic` | `pydantic>=2.4` | Pydantic argument validation on tasks |
| `solar` | `ephem` | The `solar` schedule |
| `pytest` | `pytest-celery[all]` | Testing fixtures |
| `django` | `Django>=2.2.28` | Informational lowest Django version |

Sources: [setup.py:12-47](repo://setup.py#L12-L47), [requirements/extras/redis.txt:1-1](repo://requirements/extras/redis.txt#L1-L1), [requirements/extras/sqs.txt:1-5](repo://requirements/extras/sqs.txt#L1-L5), [requirements/extras/auth.txt:1-1](repo://requirements/extras/auth.txt#L1-L1), [requirements/extras/gevent.txt:1-1](repo://requirements/extras/gevent.txt#L1-L1), [requirements/extras/memcache.txt:1-1](repo://requirements/extras/memcache.txt#L1-L1), [requirements/extras/pymemcache.txt:1-1](repo://requirements/extras/pymemcache.txt#L1-L1), [requirements/extras/pydantic.txt:1-2](repo://requirements/extras/pydantic.txt#L1-L2), [requirements/extras/pytest.txt:1-1](repo://requirements/extras/pytest.txt#L1-L1), [requirements/extras/django.txt:1-1](repo://requirements/extras/django.txt#L1-L1), [README.rst:333-427](repo://README.rst#L333-L427)

> [!WARNING]
> The `eventlet` bundle only lists `eventlet` for Python below 3.10, while the package itself requires 3.10 or newer, so `celery[eventlet]` installs nothing extra: install `eventlet` yourself if you use that pool. The README also mentions `celery[amqp]` and `celery[riak]`, which are not in `EXTENSIONS` in `setup.py`.

Sources: [requirements/extras/eventlet.txt:1-1](repo://requirements/extras/eventlet.txt#L1-L1), [setup.py:12-47](repo://setup.py#L12-L47), [setup.py:150-151](repo://setup.py#L150-L151), [README.rst:356-399](repo://README.rst#L356-L399)

## Start a broker

RabbitMQ is the default choice in the tutorial and the one the examples use; Redis works just as well. Either can be started with Docker:

Sources: [docs/getting-started/first-steps-with-celery.rst:38-51](repo://docs/getting-started/first-steps-with-celery.rst#L38-L51), [docs/getting-started/first-steps-with-celery.rst:79-93](repo://docs/getting-started/first-steps-with-celery.rst#L79-L93)

```bash
docker run -d -p 5672:5672 rabbitmq
docker run -d -p 6379:6379 redis
```

Sources: [docs/getting-started/first-steps-with-celery.rst:60-68](repo://docs/getting-started/first-steps-with-celery.rst#L60-L68), [docs/getting-started/first-steps-with-celery.rst:89-93](repo://docs/getting-started/first-steps-with-celery.rst#L89-L93)

## Define an app and a task

Create `tasks.py`. The first argument to `Celery` is the main module name, used as the prefix for generated task names when tasks are defined in `__main__`; `broker` sets the broker URL. `@app.task` turns the function into a task registered on that app.

Sources: [docs/getting-started/first-steps-with-celery.rst:139-150](repo://docs/getting-started/first-steps-with-celery.rst#L139-L150), [celery/app/base.py:252-265](repo://celery/app/base.py#L252-L265)

```python
from celery import Celery

app = Celery('tasks', broker='pyamqp://guest@localhost//')

@app.task
def add(x, y):
    return x + y
```

Sources: [docs/getting-started/first-steps-with-celery.rst:129-137](repo://docs/getting-started/first-steps-with-celery.rst#L129-L137)

The task's name comes from `gen_task_name`: the module name plus the function name (here `tasks.add`). If the module is running as `__main__` and the app has a `main` name, that name replaces `__main__`, which is why the first argument matters for scripts.

Sources: [celery/utils/imports.py:122-141](repo://celery/utils/imports.py#L122-L141), [celery/app/base.py:604-604](repo://celery/app/base.py#L604-L604)

Constructor keywords that aren't named arguments are stored as configuration too, so you can set any setting inline. The bundled example app turns on `task_acks_late` this way and leaves a commented-out result backend:

Sources: [celery/app/base.py:394-401](repo://celery/app/base.py#L394-L401), [celery/app/base.py:447-450](repo://celery/app/base.py#L447-L450), [examples/app/myapp.py:29-35](repo://examples/app/myapp.py#L29-L35)

```python
app = Celery(
    'myapp',
    broker='amqp://guest@localhost//',
    # ## add result backend here if needed.
    # backend='rpc'
    task_acks_late=True
)
```

Sources: [examples/app/myapp.py:29-35](repo://examples/app/myapp.py#L29-L35)

## Start a worker

Point the `celery` command at the module with `-A`/`--app` and run the `worker` sub-command. `-A myapp` searches the module for an app instance; `-A myapp:app` names it explicitly.

Sources: [examples/app/myapp.py:13-23](repo://examples/app/myapp.py#L13-L23)

```bash
celery -A tasks worker --loglevel=INFO
```

Sources: [docs/getting-started/first-steps-with-celery.rst:157-162](repo://docs/getting-started/first-steps-with-celery.rst#L157-L162)

Common worker options are `-l/--loglevel` (default `WARNING`), `-c/--concurrency` (default `worker_concurrency`, the number of CPUs), `-P/--pool` (default `prefork`) and `-n/--hostname`. Global options before the sub-command include `-b/--broker`, `--result-backend` and `--config`; the CLI copies them into the `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` and `CELERY_CONFIG_MODULE` environment variables.

Sources: [celery/bin/worker.py:136-211](repo://celery/bin/worker.py#L136-L211), [celery/bin/celery.py:57-133](repo://celery/bin/celery.py#L57-L133)

A module can also start itself: `app.start()` runs the `celery` command line with the app preselected, so `python myapp.py worker -l INFO` works.

Sources: [examples/app/myapp.py:1-10](repo://examples/app/myapp.py#L1-L10), [examples/app/myapp.py:44-45](repo://examples/app/myapp.py#L44-L45), [celery/app/base.py:480-497](repo://celery/app/base.py#L480-L497)

## Call the task and get the result

`delay` is the star-argument shortcut for `apply_async`. It publishes a message and returns an `AsyncResult` right away; the worker picks the message up and runs `add`.

Sources: [docs/getting-started/first-steps-with-celery.rst:193-207](repo://docs/getting-started/first-steps-with-celery.rst#L193-L207), [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534)

```python
>>> from tasks import add
>>> add.delay(4, 4)
```

Sources: [docs/getting-started/first-steps-with-celery.rst:199-200](repo://docs/getting-started/first-steps-with-celery.rst#L199-L200)

To read the return value you need a result backend. Pass `backend=` to `Celery`: `rpc://` sends states back as transient messages over the broker, `redis://localhost` stores them in Redis.

Sources: [docs/getting-started/first-steps-with-celery.rst:229-233](repo://docs/getting-started/first-steps-with-celery.rst#L229-L233), [celery/app/backends.py:15-19](repo://celery/app/backends.py#L15-L19)

```python
app = Celery('tasks', backend='rpc://', broker='pyamqp://')
# or
app = Celery('tasks', backend='redis://localhost', broker='pyamqp://')
```

Sources: [docs/getting-started/first-steps-with-celery.rst:235-244](repo://docs/getting-started/first-steps-with-celery.rst#L235-L244)

Restart the worker and reopen the Python session, then keep the `AsyncResult`:

Sources: [docs/getting-started/first-steps-with-celery.rst:248-250](repo://docs/getting-started/first-steps-with-celery.rst#L248-L250)

```python
>>> result = add.delay(4, 4)
>>> result.ready()
False
>>> result.get(timeout=1)
8
>>> result.get(propagate=False)   # return the exception instead of raising it
>>> result.traceback
```

Sources: [docs/getting-started/first-steps-with-celery.rst:252-287](repo://docs/getting-started/first-steps-with-celery.rst#L252-L287)

`ready()` checks whether the state is one of the backend's `READY_STATES`, `successful()` and `failed()` compare it with `SUCCESS` and `FAILURE`, and `traceback` reads the stored traceback. `get()` returns `None` straight away for a task called with `ignore_result`, and otherwise waits on `backend.wait_for_pending`, re-raising the task's exception when `propagate` is true.

Sources: [celery/result.py:369-383](repo://celery/result.py#L369-L383), [celery/result.py:499-502](repo://celery/result.py#L499-L502), [celery/result.py:191-265](repo://celery/result.py#L191-L265)

> [!WARNING]
> Backends hold resources for every result. Call `get()` or `forget()` on every `AsyncResult` you get back.

Sources: [docs/getting-started/first-steps-with-celery.rst:289-295](repo://docs/getting-started/first-steps-with-celery.rst#L289-L295)

## Minimal configuration

### Settings on the app

Settings can be assigned on `app.conf` one at a time or many at once with `update`:

Sources: [docs/getting-started/first-steps-with-celery.rst:315-324](repo://docs/getting-started/first-steps-with-celery.rst#L315-L324)

```python
app.conf.task_serializer = 'json'

app.conf.update(
    task_serializer='json',
    accept_content=['json'],  # Ignore other content
    result_serializer='json',
    timezone='Europe/Oslo',
    enable_utc=True,
)
```

Sources: [docs/getting-started/first-steps-with-celery.rst:320-334](repo://docs/getting-started/first-steps-with-celery.rst#L320-L334)

### A configuration module

For anything bigger, keep settings in a module and load it with `config_from_object`. The module is imported lazily, the first time a setting is read.

Sources: [docs/getting-started/first-steps-with-celery.rst:343-354](repo://docs/getting-started/first-steps-with-celery.rst#L343-L354), [celery/app/base.py:703-725](repo://celery/app/base.py#L703-L725)

```python
# celeryconfig.py
broker_url = 'pyamqp://'
result_backend = 'rpc://'

task_serializer = 'json'
result_serializer = 'json'
accept_content = ['json']
timezone = 'Europe/Oslo'
enable_utc = True
```

Sources: [docs/getting-started/first-steps-with-celery.rst:356-367](repo://docs/getting-started/first-steps-with-celery.rst#L356-L367)

```python
app.config_from_object('celeryconfig')
```

Sources: [docs/getting-started/first-steps-with-celery.rst:346-348](repo://docs/getting-started/first-steps-with-celery.rst#L346-L348)

### Environment variables

The `broker_url` and `result_backend` properties check the environment first: `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` win over any configured value. `broker_read_url` and `broker_write_url` fall back to `CELERY_BROKER_READ_URL`/`CELERY_BROKER_WRITE_URL`, then their settings, then `broker_url`.

Sources: [celery/app/utils.py:84-112](repo://celery/app/utils.py#L84-L112)

The full list of settings is in [[Configuration and Settings]].

Sources: [celery/app/defaults.py:83-108](repo://celery/app/defaults.py#L83-L108)

## Troubleshooting

Every task id with no stored history reads as `PENDING`, so a result stuck in that state usually means no state was ever written. Check that the task and `task_ignore_result` don't ignore results, that no old worker without the backend is consuming the queue, and that the client and worker use the same backend (`print(result.backend)`).

Sources: [docs/getting-started/first-steps-with-celery.rst:452-487](repo://docs/getting-started/first-steps-with-celery.rst#L452-L487)

Without a backend the app falls back to `DisabledBackend`: storing results is a no-op, `result.get()` (which ends in `backend.wait_for`) and the `get_state`/`get_result`/`get_traceback` lookups raise `NotImplementedError` with "No result backend is configured.", and starting a chord raises `NotImplementedError` with "Starting chords requires a result backend to be configured."

Sources: [celery/app/backends.py:41-46](repo://celery/app/backends.py#L41-L46), [celery/backends/base.py:48-51](repo://celery/backends/base.py#L48-L51), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281), [celery/backends/base.py:900-910](repo://celery/backends/base.py#L900-L910)

## Next steps

- [[The Celery Application]]: what the `Celery` object does with these arguments.
- [[Tasks]]: task options, binding and retries.
- [[Canvas: Signatures and Workflows]]: chaining and grouping tasks.
- [[Command Line Interface]] and [[Deployment]]: running workers for real.

Sources: [celery/app/base.py:515-585](repo://celery/app/base.py#L515-L585)
