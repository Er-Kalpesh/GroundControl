# Security model

GroundControl runs commands as you, so access to its API is equivalent to a shell. This page states what it defends against.

## Threats and defences

| Threat | Defence |
|---|---|
| A web page you visit calls `http://localhost:9876` (CSRF) | `Origin` must be our own origin; mutating requests need the custom header `x-gc-actor`, which a cross-site form cannot send; no CORS headers are ever sent |
| DNS rebinding (`evil.com` resolves to 127.0.0.1) | the `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` |
| Another user on the machine | the daemon binds to `127.0.0.1`; the token file is mode `0600` inside a `0700` directory |
| A prompt-injected AI runs `rm -rf` | AI callers can only run tasks declared in `groundcontrol.json`; arbitrary commands need `policy.allowArbitraryTasks` |
| An AI kills unrelated processes | `POST /api/ports/:port/kill` is refused for AI callers; GroundControl never kills its own process or its parent |
| Silent misuse | every action is appended to `~/.groundcontrol/audit.log` with the actor (`human:cli`, `ai:<client name>`, `system:...`) |

## Authentication

- The token is 32 random bytes (hex) created on first start at `~/.groundcontrol/token`.
- CLI and MCP bridge read it from disk. The dashboard receives it once in the URL **fragment** (`/#token=...`, never sent to a server), exchanges it for an `HttpOnly; SameSite=Strict` cookie and removes it from the address bar.
- `groundcontrol ui --no-open` prints a URL that contains the token; do not share it.

## Non-goals

- Malicious code already running as your user (it can read the token file anyway).
- Remote or LAN access: there is none, by design.
- Sandboxing the commands you configure: services and tasks run with your full privileges.

## Reporting

Open a private security advisory on the repository.
