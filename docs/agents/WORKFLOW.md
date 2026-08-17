# Agent Workflow

## Purpose
One engineering lifecycle per task. Superpowers owns the lifecycle; specialists contribute inside it.

## Work selection
Work from:
1. explicit current owner request;
2. highest-priority unblocked Launch Readiness issue;
3. genuine security/reliability defect discovered while doing authorized work.

The approved local design/product/status documents define direction. GitHub Issues are the synchronized engineering execution queue and may not redefine product truth.

Do not start speculative refactors, deferred features, or unrelated research.

Priority:
- P0 active safety/data-loss/security blocker;
- P1 core launch journey or launch monetization blocker;
- P2 launch-value UX/accessibility/performance/reliability;
- P3 later/deferred.

## Local-first startup
Before substantial work:
1. inspect `git status`;
2. fetch `origin`;
3. compare `HEAD` and `origin/main`;
4. classify sync state;
5. preserve unknown local work;
6. reconcile `Remote ahead` or `Diverged` before editing.

Never hard-reset or clean unknown local work merely to match GitHub.

## Standard lifecycle
`understand -> classify risk -> reconcile local/remote -> isolate work -> plan if needed -> implement with TDD/evidence -> verify locally -> independent review -> repair valid findings -> required CI -> merge when policy allows -> synchronize -> reconcile status/issue -> owner handoff -> next task`

## Superpowers + specialists
Use applicable Superpowers process skills first.
Automatically add relevant Matt/specialist depth inside that lifecycle.
Do not run duplicate generic planners, TDD loops, debugging loops, or completion protocols.

## Isolation
Non-trivial changes use a branch/worktree. Never develop directly on `main`. Never discard unknown work.

## TDD and evidence
For behavior changes:
1. express required behavior in a failing deterministic test where practical;
2. confirm the test fails for the intended reason;
3. implement the smallest correct change;
4. confirm focused test passes;
5. run broader affected tests;
6. run risk-required verification.

Documentation-only changes use deterministic authority/contradiction/link checks rather than fake code tests.

## Review
The implementer does not certify itself.

R1 requires independent engineering review.

R2 requires:
1. independent strong engineering review;
2. separate adversarial security review;
3. deterministic security evidence;
4. full CI.

Verify review claims technically; do not obey hallucinated feedback blindly.

## Repair budget
Default:
1. diagnose and repair with evidence;
2. retry using new evidence/different approach;
3. escalate to stronger reasoning/specialist only when justified.

After repeated evidence-based failure:
- stop;
- do not merge;
- preserve the working system;
- record the blocker;
- provide the mandatory owner handoff.

Do not ask the owner to debug code.

## GitHub issue contract
A ready issue contains:
- outcome;
- why it matters;
- acceptance criteria;
- required verification;
- risk;
- dependencies;
- out of scope.

Prefer outcome language over file chores.

## Merge behavior
R0: lightweight checks -> merge.
R1: independent review + relevant tests + required CI -> autonomous merge.
R2: strong implementation + independent strong review + adversarial security review + deterministic security tests + full CI -> autonomous merge only if all pass.
R3: repository-side work may complete, but protected real-world action remains owner-gated.

Never lower tests or protection to obtain green CI.

## End-of-task handoff
Every task ends with:
- What changed
- Your action
- Sync status
- Next autonomous steps
- Stop condition

If no owner action is needed, say exactly: `Your action: none.`
