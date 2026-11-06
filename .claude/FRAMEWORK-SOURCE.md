# Claude Code Game Studios — source, configuration and local patches

| | |
|---|---|
| Framework | Claude Code Game Studios (MIT, see `.claude/CCGS-LICENSE`) |
| Official repo | https://github.com/Donchitos/Claude-Code-Game-Studios |
| Version | **1.2.0** (tag `v1.2.0`) |
| Commit | **`05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418`** ("Release 1.2.0 — the main path, rebuilt and tested") |
| Installed | 2026-11-06, project-local only (nothing global was changed) |
| Base branch / commit | `premium/android-overhaul` @ `cda2978f7959e1c19fdb502239184bd8864fccb6` |

## Reproduce
1. `git clone https://github.com/Donchitos/Claude-Code-Game-Studios` and `git checkout 05ad7c8a5b8aa2aa86bbd3439ae7cf7295cac418`.
2. Copy `.claude/` verbatim, plus `design/registry`, `design/CLAUDE.md`, `docs/engine-reference/unity` (+ its README), `docs/registry/architecture.yaml`,
   `docs/architecture/tr-registry.yaml`, `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md`, `docs/CLAUDE.md`, `LICENSE` -> `.claude/CCGS-LICENSE`.
3. Remove the `Notification` block from `.claude/settings.json`; add the `git push ... main` deny rules (below).
4. Run `.claude/local-patches/apply-unity-subdir-rules.sh` and `.claude/local-patches/apply-code-root-override.sh` (both idempotent; re-run after any framework upgrade).
5. `project.yaml` and `CLAUDE.md` are ours (see them; they are the only hand-written parts).

**Not installed on purpose:** the framework's own `README/CHANGELOG/CONTRIBUTING/SECURITY/UPGRADING`, `studio-tests/` (its self-test specs for `/skill-test`),
`src/CLAUDE.md` (Godot-style `src/` rules; our `src/` is the legacy TypeScript game), `docs/engine-reference/{godot,unreal}`, `production/.gdignore`, the framework `.gitignore`
(Godot/Unreal-oriented; only its runtime-state entries were appended to ours). All 49 agents and 74 skills are installed unmodified (the 10 Godot/Unreal specialists are inert for Unity; delete them if you want a smaller roster).

## Hooks (15 in the framework)
Enabled (14 commands, all local file reads/writes; none touches credentials, the network or destructive Git/FS operations — audited):
SessionStart `session-start.sh`, `detect-gaps.sh` · PreToolUse `validate-commit.sh`, `validate-push.sh`, `validate-registry.sh`, `validate-write.sh`, `validate-read.sh` ·
PostToolUse `validate-assets.sh`, `validate-skill-change.sh` · PreCompact `pre-compact.sh` · Stop `session-stop.sh` (async) · SubagentStart `log-agent.sh` ·
SubagentStop `log-agent-stop.sh`, `validate-agent-artifact.sh`.
Disabled / needing your decision:
* **`notify.sh` (Notification)** — reviewed: it single-quote-escapes and truncates the message, but launches a hidden `powershell.exe` for a Windows balloon tip. Cosmetic; left OUT of `settings.json`. To opt in, add the `Notification` block from upstream `.claude/settings.json`.
* **`update-check.sh`** — the only network code (read-only GET to `api.github.com/repos/Donchitos/Claude-Code-Game-Studios/releases/latest`, cached under `~/.cache`). Disabled with `updates.check: false` in `project.yaml`.
* `log-instructions.sh` is not wired upstream either; `yaml-helper.sh` is a library.
Only the framework's `validate-commit.sh` JSON check is a hard block (exit 2); push-to-main is a reminder, so hard stops come from `permissions.deny`.

## Settings changes vs upstream `.claude/settings.json`
* removed the `Notification` hook block (above);
* added deny rules (tightening only): `git push origin main*`, `git push origin HEAD:main*`, `git push * main`, `git push * main *`, `git push origin master*` (+ PowerShell forms).
Upstream permissions add only deny rules and three narrow allows (`dir`, `python -m pytest`); nothing was broadened. Note: Claude Code ignores `permissions.allow` until the workspace is trusted interactively (deny rules still apply).

## Local patches (all in `.claude/local-patches/`, idempotent)
Our Unity project is `unity/`, not the repo root, and the repo root also holds legacy TypeScript `src/`. The framework assumes `Assets/` at the root.
1. `apply-unity-subdir-rules.sh` — adds `unity/Assets/**` twins to every `Assets/**` path in `.claude/rules/*.md` (9 one-line additions). Note: the framework's `src/gameplay/**`, `src/core/**` … rule paths also match our legacy TS code.
2. `apply-code-root-override.sh` —
   * optional `engine.code_root` in `project.yaml` (set to `unity/Assets`) honoured by `resolve_code_root` (hooks/yaml-helper.sh) and `scripts/project-state.sh`. Without it `/project-stage-detect` counted **0 source files** and would call this project greenfield; with it: 40 C# files.
   * `validate-commit.sh` blocking JSON check now covers `unity/Assets/**/*Data/*.json` (e.g. `unity/Assets/GameData/`), previously only `Assets/**/data/` and `assets/data/`.

## First session (what to do)
1. `cd` into the repo on the integration branch and start `claude` there. **Accept the workspace-trust dialog once** (otherwise `permissions.allow` is ignored).
2. Skills/agents load at session start; after any change to `.claude/` start a new session (or `/clear`).
3. Run `/project-stage-detect` (read-only analysis) before anything else; `/adopt` only if you want the framework to generate design/architecture docs from existing code — it writes files and asks first.
4. Do **not** run `/setup-engine` or `/start` blindly: `project.yaml` is already configured for Unity 6.3 URP; `/start` may rewrite `modes.*`.
