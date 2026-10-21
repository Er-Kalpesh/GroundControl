# Releasing GroundControl

Everything below is done by the repository owner. Nothing here is automated, because publishing is irreversible and needs your accounts.

## 0. Before the first release

- [ ] `git switch main && git merge chore/release-prep` (or open a PR) and push: `git push -u origin main`.
- [ ] Watch the GitHub Actions run (`.github/workflows/ci.yml`): it must be green on **macOS and Linux**. If Linux fails, see Appendix C of `docs/superpowers/plans/2026-10-08-groundcontrol-v1.md` ("Linux differences").
- [ ] Do the manual checks from Task 20 of that plan at least once on your machine: a real project, an AI client connected, `daemon install` at login.

## 1. Publish to npm (this is what makes `npx groundcontrol-mcp` work for everyone)

```bash
npm login                       # your npm account
npm view groundcontrol-mcp      # must say 404: the name is free (it was on 2026-10-21)
npm publish --dry-run           # inspect the file list: dist/, LICENSE, README.md, package.json only
npm publish                     # prepublishOnly runs typecheck + all tests + build first
```

Use `npm publish --provenance` from GitHub Actions later if you want signed provenance. Enable 2FA on your npm account first.

## 2. Publish the Claude Code plugin

The repository root already is a plugin *and* a one-plugin marketplace (`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json`, `skills/groundcontrol/SKILL.md`). Once the repo is public on GitHub and the npm package is published, friends run:

```
/plugin marketplace add Er-Kalpesh/GroundControl
/plugin install groundcontrol@groundcontrol
```

Validate locally before every release: `claude plugin validate .` (checks the marketplace) and `claude plugin validate .claude-plugin/plugin.json`.

## 3. Tag the release (this also builds the no-npm download)

Pushing a tag that starts with `v` runs `.github/workflows/release.yml`: it runs all tests, builds the package and attaches `groundcontrol-mcp-<version>.tgz` to a GitHub Release. Friends can then install with `npm install -g <release asset URL>` even before (or without) an npm publish.


```bash
npm version patch               # bumps package.json and tags
# also bump "version" in .claude-plugin/plugin.json and .claude-plugin/marketplace.json to match
git push --follow-tags
```

## Checklist for every release

- [ ] `npm run typecheck && npm test && npm --prefix dashboard test && npm run build`
- [ ] `npm pack --dry-run` shows no `src/`, `tests/`, `dashboard/` or `docs/`
- [ ] The three version numbers agree (package.json, plugin.json, marketplace.json)
- [ ] README install commands still match reality
