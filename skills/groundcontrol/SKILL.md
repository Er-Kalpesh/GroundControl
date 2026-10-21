---
name: groundcontrol
description: Use when you need to start, stop, restart or inspect the user's local dev servers (Laravel, Vite, Docker databases, queue workers), read their logs, or run project tasks like migrations and tests. GroundControl keeps services running after this AI session ends.
---

# Using GroundControl

GroundControl is a background daemon that owns the user's dev servers. You talk to it through the `groundcontrol_*` MCP tools. **Services keep running after your session ends**, so never assume you own them and never try to run them in your own shell.

## Workflow

1. **Look first.** Call `groundcontrol_get_status`. Do not start anything that is already `ready` or `running`.
2. **Start.** Call `groundcontrol_start_service`. It returns immediately; poll `groundcontrol_get_status` until the state is `ready` (or `unhealthy` / `crashed`). Do not start dependents before their dependency is `ready`.
3. **Diagnose.** Call `groundcontrol_get_logs`. It returns `nextOffset`; pass it as `since` on the next call so you only read new output instead of re-reading old lines.
4. **Run tasks.** Call `groundcontrol_list_tasks` to see what is declared, then `groundcontrol_run_task` with `task`. It blocks and returns the exit code, stdout and stderr; check the exit code before moving on (for example, confirm `migrate` succeeded before writing code that needs the new tables).
5. **Restart** with `groundcontrol_restart_service` after a config or dependency change; use `groundcontrol_stop_service` only when the user asks or the service is clearly stuck.

## Rules

- **Only run declared tasks.** You cannot run arbitrary shell commands through GroundControl unless the project sets `policy.allowArbitraryTasks`. If a command you need is not declared, tell the user and suggest adding it to the `tasks` section of `groundcontrol.json` rather than looking for a workaround.
- **Port conflicts:** if a start fails because a port is in use, report which process holds it. Retry with `killZombies=true` only if it is clearly a stale leftover; otherwise ask the user.
- **Do not stop services you did not start** without asking: the user or another AI session may be relying on them.
- **No `groundcontrol.json`?** Ask the user to run `groundcontrol init` in the project (a CLI command, not an MCP tool), then review the generated file.
- **Keep output small.** Request only the log lines you need (`lines` up to 500) and prefer `since` over repeated tail reads.

## Reading states

`stopped` (not running) → `running` (spawned) → `ready` (health check passed). `unhealthy`: it is running but its health check failed or timed out; read the logs. `crashed`: it exited unexpectedly; read the logs, fix the cause, then restart.
