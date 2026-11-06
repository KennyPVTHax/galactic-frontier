# Claude Code Game Studios -- Game Studio Agent Architecture

Indie game development managed through 49 coordinated Claude Code subagents.
Each agent owns a specific domain, enforcing separation of concerns and quality.

## Technology Stack

- **Engine**: Unity 6.3 LTS (6000.3.28f1), Universal Render Pipeline 17.3.0
- **Language**: C#
- **Project location**: the Unity project is `unity/` (code root `unity/Assets`, set as `engine.code_root` in `project.yaml`)
- **Targets**: Windows PC and Android
- **Version Control**: Git; development on `premium/android-overhaul` and isolated branches off it. Never `main`.
- **Build / test**: Unity Test Framework 1.6.0 (EditMode tests in `unity/Assets/Tests/EditMode`)
- **Legacy**: the repo root also holds the earlier Babylon.js/TypeScript game (`src/`, `tests/`, `android/`, `npm test`). It is NOT governed by the Unity rules; keep it working, do not refactor it.

> **Note**: Engine-specialist agents exist for Godot, Unity, and Unreal with
> dedicated sub-specialists. Use the set matching your engine.

## Project Structure

@.claude/docs/directory-structure.md

## Engine Version Reference

<!-- ENGINE-REFERENCE-IMPORT: the line below is engine-specific. /setup-engine
     rewrites it to @docs/engine-reference/<engine>/VERSION.md for the chosen
     engine, so a Unity or Unreal project stops loading the Godot reference every
     session. It defaults to Godot (the template's example engine); skills that
     need the pinned version read docs/engine-reference/<engine>/VERSION.md on
     demand regardless of this import. -->
@docs/engine-reference/unity/VERSION.md


## Galactic Frontier project rules (these win over any framework default)

- **Never** merge into `main`. **Never** modify or deploy the OrbitBTC app, website or backend. No force-push, no history rewrites. Push only when the owner authorises it.
- Do not restart, regenerate or replace the Unity project, its scenes, assets, world edits or Git history. Add; do not overwrite.
- Existing saved planetary / authored-world data changes **only with a migration and migration tests**.
- Never claim a frame rate, memory or load-time figure for a device that was not measured on that device. Cloud/software-rendered numbers are labelled as such.
- Visual realism is judged by the finished in-game appearance (screenshots from the real Unity build), not by polygon counts or test counts. Hero assets are authored/licensed (record licence + credit), never primitive stand-ins.
- Third-party assets: record author, source, licence and changes before committing; no unclear or non-commercial licences.
- Workflow per task: review the checkpoint -> one bounded objective -> 1-2 relevant specialists -> short plan -> isolated branch -> automated tests -> run Unity and inspect -> record screenshots/perf/limitations -> commit tested work -> push only if authorised.
- **Token discipline:** one coordinator plus usually one or two specialists per task; never fan out many agents; reuse existing checkpoint reports in `docs/` instead of re-researching; short results (files changed, evidence, open issues). `modes.rigor: minimal` by default; use stronger QA only for critical systems (saves, economy, networking).
- Project-local setup details, disabled hooks and local patches: `.claude/FRAMEWORK-SOURCE.md`.

## Technical Preferences

`project.yaml` at the repo root is the primary config store — engine, specialists,
naming, platform, performance, modes. Skills resolve it via `resolve_config`
(see `.claude/docs/config-resolution.md`).

`.claude/docs/technical-preferences.md` is the **legacy fallback**, read on demand
when a key is absent from `project.yaml`. It is not imported here: before
`/setup-engine` runs it is almost entirely `[TO BE CONFIGURED]` placeholders, and
after it runs `project.yaml` holds the real values.

## Coordination Rules

@.claude/docs/coordination-rules.md

## Collaboration Protocol

**User-driven collaboration, not autonomous execution.**
Every task follows: **Question -> Options -> Decision -> Draft -> Approval**

- Agents MUST ask "May I write this to [filepath]?" before using Write/Edit tools
  (exempt: `active.md` appends, agent memory, a subagent's new file at the path
  its orchestrating skill named; see `.claude/rules/agent-memory.md`)
- Agents MUST show drafts or summaries before requesting approval
- Multi-file changes require explicit approval for the full changeset
- No commits without user instruction
- A skipped or dismissed question is not an answer: act on nothing, re-ask in
  plain text and wait
- Started outside this file's folder? Warn first: hooks, deny rules and the
  ask-first mode load only when Claude Code starts here

See `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md` for full protocol and examples.

> **First session?** If the project has no engine configured and no game concept,
> run `/start` to begin the guided onboarding flow.

## Coding Standards

@.claude/docs/coding-standards.md

## Context Management

Read `.claude/docs/context-management.md` on demand — it is a reference, not
session context. Two of its conventions are load-bearing and cited by name
elsewhere in the repo, so they are restated here rather than lost:

- **`production/session-state/active.md` is the session checkpoint.** The file is
  the memory, not the conversation. Read it first after any compaction, crash, or
  `/clear`.
- **Helpers in `.claude/scripts/` emit observations, never verdicts.** A script
  that scores or judges will eventually contradict a mode or override it cannot
  see. (Cited by `artifact-check.sh` and `adr-dep-graph.sh`.)
