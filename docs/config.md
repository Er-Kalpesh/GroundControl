# `groundcontrol.json` reference

The file lives in your project root. GroundControl finds it by walking up from the current directory.

```json
{ "version": 1, "project": "my-app", "services": { }, "tasks": { }, "policy": { } }
```

| Key | Type | Required | Meaning |
|---|---|---|---|
| `version` | `1` | yes | schema version |
| `project` | string `[A-Za-z0-9._-]+` | yes | name used in ids (`project/service`); must be unique per machine |
| `services` | object | yes (may be `{}`) | long-running processes |
| `tasks` | object | no | one-off commands AI agents may run |
| `policy.allowArbitraryTasks` | boolean (default `false`) | no | let AI agents run any command |

## Service

| Key | Default | Meaning |
|---|---|---|
| `command` | (required) | run with `/bin/sh -c`; the whole process group is managed |
| `cwd` | config directory | relative paths resolve against the config directory |
| `env` | `{}` | extra environment variables |
| `port` | none | enables port-conflict detection; also exported as env `PORT` |
| `dependsOn` | `[]` | service names that must be *ready* first |
| `health` | none | readiness probe, see below; no probe means ready as soon as it is spawned |
| `restart.policy` | `never` | `never`, `on-failure` (non-zero exit) or `always` (any unexpected exit) |
| `restart.maxRetries` | `3` | attempts before the service stays `crashed`; the counter resets after 60 s of continuous readiness |
| `restart.backoffMs` | `1000` | first delay; doubles per attempt, capped at 30 s |
| `stopCommand` | none | run before SIGTERM (for example `docker compose stop db`) |
| `stopTimeoutMs` | `10000` | wait after SIGTERM before SIGKILL |
| `autostart` | `true` | started by `daemon install` at login (only then) |

### Health probes

| `type` | Fields | Ready when |
|---|---|---|
| `http` | `url`, `expectStatus=200`, `intervalMs=2000`, `timeoutMs=60000` | GET returns the status |
| `tcp` | `port`, `host=127.0.0.1`, `intervalMs=1000`, `timeoutMs=60000` | the port accepts connections |
| `log` | `pattern` (regex), `timeoutMs=60000` | a log line matches |

If the probe times out the service becomes `unhealthy` (it keeps running) and `start` reports a failure.

## Task

| Key | Default | Meaning |
|---|---|---|
| `command` | (required) | run to completion; stdout, stderr and exit code are returned |
| `cwd` | config directory | |
| `timeoutMs` | `300000` | the whole process group is killed on timeout |

## States

`stopped` → `running` (spawned) → `ready` (probe passed) or `unhealthy` (probe failed); `crashed` after an unexpected exit; `stopping` while shutting down.

## Docker

Docker is just a service. Use `docker compose up <svc>` as the command (it stays in the foreground), `docker compose stop <svc>` as `stopCommand`, and a `tcp` probe on the published port.
