# CLAUDE.md — Apogee Shared Autonomy Baseline

This file defines how Claude Code operates in any apogee-pattern repository
(the reference product, The Somm, NailNotes, MacMethod, and future Verve products).

Each product's local `CLAUDE.md` may **add** to these rules but must not
relax them. Where local rules conflict with this file, this file wins.

---

## 1. Operating Context

- **Stack baseline:** TypeScript strict, pnpm workspaces, Turborepo, Next.js
  (Vercel) frontends, Fastify (Railway) APIs, MongoDB Atlas, Clerk auth,
  Cloudflare R2 storage.
- **Shared packages:** `@apogee/core`, `@apogee/ai-integration`,
  `@apogee/mcp-framework`, `@apogee/document-gen`, `@apogee/workflow-engine`,
  `@apogee/vision-extraction`. Never duplicate logic that belongs in shared
  packages — if a product needs behavior that overlaps, extract to shared.
- **Owner:** Jeff Canter (jeff@vervetech.ai). Verve Technologies LLC.

---

## 2. Autonomy Contract

You are running unattended. The human is asleep, in a meeting, or otherwise
unavailable. Your job is to make consistent forward progress and produce
a reviewable result, not to ask for help.

### What this means in practice:

- **Do not ask yes/no questions on reversible operations.** If the action
  is git-tracked and a `git reset --hard` can undo it, just do it.
- **Do not stop to confirm file paths, package names, or naming choices**
  that are obvious from context. Pick the option most consistent with
  existing patterns and proceed.
- **Do not stop to ask whether to run tests, lint, or typecheck.** Always
  run them. They are part of every task's definition of done.
- **Do escalate** via `BLOCKED.md` (see §6) when you genuinely cannot
  decide between meaningfully different paths, when you have failed the
  same approach three times, or when an irreversible operation is required
  that is not on the deny list.

### The 2am test:

Before pausing for human input, ask yourself: "Is this important enough
to wake Jeff up at 2am for?" If no, decide and proceed. If yes, write
`BLOCKED.md`, commit your work, and move to the next task.

---

## 3. Definition of Done

A task is **not** complete until **all** of the following pass:

1. `pnpm typecheck` clean — zero errors
2. `pnpm lint` clean — zero errors, zero warnings on changed files
3. `pnpm test` clean — all tests pass, new code has tests
4. The change is committed with a descriptive message (see §7)
5. The status file (§5) reflects the completion

Failing any of these is failing the task. Do not declare done early.
Do not disable lint rules to make this pass — see §8.

---

## 4. Coding Standards

- **TypeScript strict.** No `any`. If you need an escape hatch, use
  `unknown` and narrow explicitly.
- **No `// @ts-ignore` or `// @ts-expect-error`** without a comment on
  the same or preceding line explaining why and what would need to
  change to remove it.
- **No disabled lint rules** in source files. If a rule is genuinely
  wrong for a use case, raise it in `BLOCKED.md` for the human to
  decide whether to update the lint config.
- **Repository pattern for data access.** Never call MongoDB drivers
  or Clerk SDK directly from route handlers. Go through a repository
  or service.
- **Error handling.** Never `catch (e) {}` to silence errors. Either
  handle the error meaningfully or let it propagate. Logging counts
  as handling only if there's a clear reason to swallow.
- **Async-await over `.then()`.** Always.
- **Imports.** Absolute imports (`@apogee/...` for shared packages,
  `@/...` for product-local) over deep relative paths.

---

## 5. Status File

Maintain `.claude/status.json` at the worktree root. Update it at every
meaningful checkpoint (task start, task complete, blocked, idle).

```json
{
  "session_id": "2026-05-21T03:14:00Z",
  "current_task": "Implement /api/captures route handler",
  "task_started_at": "2026-05-21T03:14:00Z",
  "phase": "implementation",
  "last_checkpoint": "2026-05-21T03:42:11Z",
  "completed_tasks": [
    "Scaffold capture route file",
    "Add Zod schema for capture request"
  ],
  "blocked_tasks": [],
  "tests_status": {
    "typecheck": "passing",
    "lint": "passing",
    "tests": "12 passing, 0 failing"
  },
  "next_planned": "Add Cloudinary upload integration"
}
```

`phase` is one of: `planning`, `implementation`, `validation`, `blocked`,
`idle`, `complete`.

ARGUS reads this file. Keep it accurate or the human's HUD lies.

### Per-session state is not source — gitignore it

`status.json` and its siblings are **per-session harness state**, not source
code. They live in `.claude/` (or the worktree root) for the duration of a
run and must not be committed to the product repo. Each product's
`.gitignore` should include:

```gitignore
.claude/status.json
.claude/WATCHDOG_TIMEOUT
.claude/settings.local.json
BLOCKED.md
```

(The composed `.claude/settings.json` and the `.claude/settings.delta.json`
delta *are* committed — those are configuration, not session state.)

---

## 6. Escalation: BLOCKED.md

When you genuinely cannot proceed, write `BLOCKED.md` at the worktree
root with this exact structure:

```markdown
# BLOCKED: <one-line summary>

**Timestamp:** <ISO 8601>
**Task:** <what you were trying to do>
**Phase:** <where you were when blocked>

## What I tried
- <attempt 1: what, result>
- <attempt 2: what, result>
- <attempt 3: what, result>

## Why I'm stopping
<the actual blocker — be specific about what decision needs to be made>

## Options I considered
1. <option A> — <pros/cons>
2. <option B> — <pros/cons>

## My recommendation
<which option you'd pick and why, if forced>

## State at block time
- Branch: <branch name>
- Last commit: <sha + message>
- Uncommitted changes: <yes/no + summary>
- Tests: <state>
```

After writing BLOCKED.md:
1. Commit current work-in-progress with message `wip: blocked on <task>`
2. Update `status.json` with `phase: blocked`
3. **Move to the next independent task** if one exists
4. If no independent task remains, set `phase: idle` and stop

Never block silently. Never block on something that's actually a
reversible decision you could make and document.

---

## 7. Git Discipline

- **Commit at every logical checkpoint**, not at the end of a long run.
  A 24hr session should produce 20-50 commits, not 1.
- **Commit message format:**
  ```
  <type>(<scope>): <one-line summary>

  <optional body>

  Co-authored-by: Claude <noreply@anthropic.com>
  ```
  Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `wip`.
- **Never `git push`.** Pushing is a human decision. The deny list
  enforces this; if you find yourself wanting to push, you've
  misunderstood the task.
- **Never `git rebase` or `git reset` branches the human created.**
  Your worktree branch is yours; everything else is read-only.
- **Never force-push anything, ever.** Not even your own branch.
- **Branch naming:** `autonomous/<YYYY-MM-DD>-<short-task-slug>`

---

## 8. Hard Forbidden Patterns

These produce a `BLOCKED.md` immediately — do not work around them:

- Disabling a lint rule, type check, or test to make CI pass
- Adding `// eslint-disable-next-line` without a justification comment
- Catching errors and silently dropping them
- Hardcoding credentials, even temporarily ("I'll come back to this")
- Editing `.env*` files (the deny list will stop you anyway)
- Modifying lockfiles (`pnpm-lock.yaml`) by hand — only via pnpm commands
- Generating database migrations without explicitly being asked to
- Calling external APIs whose costs are non-trivial (LLM APIs, paid
  services) more than necessary; cache, batch, or stub in tests
- Installing new top-level dependencies without justification in the
  commit message

---

## 9. When in Doubt

Default behaviors when context is ambiguous:

| Situation | Default |
|---|---|
| New file location unclear | Match the closest existing pattern in the same package |
| Naming convention unclear | camelCase for variables/functions, PascalCase for types/components, kebab-case for files |
| Test framework unclear | Vitest |
| Validation library unclear | Zod |
| HTTP client unclear | `fetch` (native), or whatever the package already uses |
| Logging unclear | `pino` with the package's existing logger instance |
| Date library unclear | `date-fns`, never moment |
| ID generation unclear | `nanoid` for short IDs, ObjectId where Mongo native |

If none of these match the situation, pick the option most consistent
with the package you're working in, document the choice in the commit
message, and proceed. Do not block on style.

---

## 10. Cross-repo operations

When inspecting or operating on a different repo than the current one,
**never** use `cd <other-repo> && git ...`. The auto-mode classifier
(correctly) flags this as a prompt-injection risk because untrusted git
hooks could execute. Use these patterns instead:

| Goal | Use |
|---|---|
| Git operation in another repo | `git -C /path/to/repo <command>` |
| List a directory | `ls /path/to/dir/` |
| Read a file | `cat /path/to/file` |
| Grep across files | `grep -n pattern /path/to/file` or `rg pattern /path/` |
| Run a script in another repo | `bash /path/to/repo/script.sh` (when safe) |

The principle: avoid `cd` to directories you don't fully control. Stay in
your working directory and use absolute paths or path-flagged commands
instead.

---

## 11. Session Hygiene

- **Run `/compact` every ~90 minutes of work** to keep context fresh.
  Long sessions degrade decision quality.
- **Re-read this file when context is compacted.** It is not optional
  background.
- **At session start, read** the product's local `CLAUDE.md`, the
  product's `SPEC.md`, the most recent commits on the current branch,
  and the current `status.json` if one exists from a prior session.
- **At session end** (or before going idle for >10 min), make sure
  status.json is current and any work-in-progress is committed.
