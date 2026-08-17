# Task Result Records

This directory stores owner-approved, Git-tracked records of completed, blocked or aborted repository tasks.

A result record is prepared automatically at task completion, but it is written here only after the project owner approves saving it.

## Naming

Use:

`YYYY-MM-DD-task-name.md`

Rules:

- Use the task completion date.
- Use a short lowercase kebab-case description.
- Do not include issue text, email addresses, usernames, credentials or other sensitive data in filenames.
- If the intended path already exists, append `-2`, `-3` and so on. Never overwrite an earlier result.

## Adaptive detail

- **Small task:** concise outcome, changed files, verification and any blocker/next step.
- **Normal task:** request, decisions, implementation summary, changed files, verification, scope checks, blockers and next steps.
- **High-risk task:** detailed audit record covering migrations, auth, privacy, security, release behavior, preserved invariants, rollout requirements, failure/retry history and all relevant verification layers.

Omit empty optional sections for small tasks. Do not inflate routine work into an audit report.

## Verification evidence

Record verification in a compact table:

| Command | Exit | Result |
| --- | ---: | --- |
| `command` | `0` | Concise counts or outcome |

Store command names, exit status and concise result counts. Include a short failure excerpt only when it materially explains a blocker or retry. Do not paste full build, test or deployment logs.

## Confidentiality

Never record:

- secrets, tokens, keys, passwords or credential-shaped values
- private email addresses, phone numbers or other personal data
- raw profiles, private messages or confidential database rows
- complete environment dumps or sensitive command output

Use redacted descriptions when a security-relevant fact must be preserved.

## Standard template

```markdown
# Task Result: <title>

- Date: YYYY-MM-DD
- Status: Completed | Blocked | Aborted
- Risk: Small | Normal | High

## Request

<What the owner asked for.>

## Decisions and assumptions

- <Owner decision, approved scope or material assumption.>

## Outcome

<What now works or why the task is blocked.>

## Changes

- `path/to/file`: <concise change>

## Verification

| Command | Exit | Result |
| --- | ---: | --- |
| `command` | `0` | <concise evidence> |

## Scope and safety checks

- <Preserved invariants, security checks, or explicit non-changes.>

## Blockers

- <Remaining blocker, or `None`.>

## Next steps

1. <Next action, or `None`.>
```

## Relationship to project status

Task results are historical execution records. `docs/PROJECT-STATUS.md` is the current-state summary and should be updated only when current project state, blockers or next steps materially change. A task result does not require a project-status update by itself.
