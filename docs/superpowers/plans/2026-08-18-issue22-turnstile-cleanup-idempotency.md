# Issue 22 Turnstile Cleanup Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Issue 22 hosted cleanup treat its saved Turnstile widget as already absent when both the saved sitekey and saved recovery intent are absent, while continuing to fail closed on mismatched or ambiguous live widgets.

**Architecture:** Keep the change inside `resolveSavedWidgetForCleanup()` in `scripts/issue22-hosted/operator-lib.mjs`. Reuse the existing `resolveWidgetForCleanup()` intent matcher as the ambiguity guard: a missing saved sitekey match is safe only when the intent matcher also returns no live widget; any live intent match under a different sitekey remains a hard failure.

**Tech Stack:** Node.js 22, TypeScript tests with Vitest, Cloudflare Turnstile cleanup logic using Wrangler-backed live widget inventory.

## Global Constraints

- Work on branch `issue-22-open-registration` for PR #33.
- Begin only after Repair 1 is committed and the worktree has no tracked changes.
- Use TDD: add the missing-target regression and drift/ambiguity negatives first, run them and observe RED, then change production code.
- Do not weaken `resolveWidgetForCleanup()`.
- Never select or delete an unrelated widget merely because the saved sitekey is absent.
- A live widget matching the saved recovery intent under a different sitekey must fail closed.
- Multiple saved-sitekey matches or multiple recovery-intent matches must fail closed.
- Do not edit `scripts/issue22-hosted/private/recovery-state.json` manually.
- Do not delete or modify the unrelated `uhh.com (Spin)` widget.
- Do not run `hosted-cleanup` or `hosted-execute` during this repair.
- Commit the production repair as `fix(issue22): make turnstile cleanup idempotent when target is absent`.

---

## File Structure

- Modify `tests/scripts/issue22-hosted-operator.test.ts`: expand saved-widget cleanup tests to cover already-absent, intent-drift, unrelated-widget, and ambiguity cases.
- Modify `scripts/issue22-hosted/operator-lib.mjs`: minimally handle zero saved-sitekey matches by proving zero recovery-intent matches before returning `null`.

### Task 1: Treat only a proven-absent saved widget as idempotently clean

**Files:**
- Modify: `tests/scripts/issue22-hosted-operator.test.ts` in `describe('issue-22 hosted cleanup boundary')`, around `never trusts a saved widget sitekey unless its fetched widget matches the saved intent`
- Modify: `scripts/issue22-hosted/operator-lib.mjs` in `resolveSavedWidgetForCleanup(intent, savedSitekey, widgets)`

**Interfaces:**
- Consumes: `resolveSavedWidgetForCleanup(intent: { name: string; domain: string }, savedSitekey: string | null | undefined, widgets: Array<Record<string, any>>): Record<string, any> | null`
- Produces: the same function/signature; new safe case returns `null` when the exact saved widget and the exact intent are both absent.

- [ ] **Step 1: Confirm Repair 1 is the only prior implementation change and the worktree is clean**

Run:

```powershell
Set-Location -LiteralPath 'C:\Users\Admin\Documents\Сайт парфюми.worktrees\issue-22-open-registration'
git status --porcelain --untracked-files=no
git --no-pager log -3 --oneline
```

Expected:

- tracked status is empty;
- the recent history contains `fix(issue22): accept provider-normalized disabled captcha metadata` before starting this repair.

- [ ] **Step 2: Add the failing already-absent and drift regression tests**

In the existing saved-widget test area, use this intent fixture:

```ts
const intent = { name: 'aromatika-issue22-run-abc', domain: TARGET.workerHostname };
const matching = { name: intent.name, domains: [intent.domain], sitekey: 'saved-site-key' };
```

Keep the existing exact-match success and wrong-name/wrong-domain failures, then add:

```ts
const unrelated = {
	name: 'uhh.com (Spin)',
	domains: ['127.0.0.1', 'localhost', 'uhh.com'],
	sitekey: 'unrelated-site-key'
};

expect(resolveSavedWidgetForCleanup(
	intent,
	'saved-site-key',
	[unrelated]
)).toBeNull();

expect(() => resolveSavedWidgetForCleanup(
	intent,
	'saved-site-key',
	[{ ...matching, sitekey: 'replacement-site-key' }]
)).toThrow(/recovery intent|sitekey|ambiguous/i);

expect(() => resolveSavedWidgetForCleanup(
	intent,
	'saved-site-key',
	[
		{ ...matching, sitekey: 'replacement-site-key-1' },
		{ ...matching, sitekey: 'replacement-site-key-2' }
	]
)).toThrow(/ambiguous/i);
```

Also add a duplicate-saved-sitekey guard:

```ts
expect(() => resolveSavedWidgetForCleanup(
	intent,
	'saved-site-key',
	[matching, { ...matching }]
)).toThrow(/ambiguous/i);
```

The unrelated widget fixture intentionally mirrors the live account observation and proves it is ignored rather than selected.

- [ ] **Step 3: Run only the saved-widget cleanup test and verify RED**

Run:

```powershell
pnpm exec vitest run tests/scripts/issue22-hosted-operator.test.ts -t "never trusts a saved widget sitekey unless its fetched widget matches the saved intent"
```

Expected: FAIL on the new `[unrelated] => null` assertion because the current implementation treats zero saved-sitekey matches as an error. Existing exact-match and mismatch guards should continue behaving as before.

If the already-absent assertion unexpectedly passes before production code changes, stop and re-inspect the current branch rather than changing code.

- [ ] **Step 4: Implement the minimal proven-absence branch**

Replace the current saved-sitekey branch, which effectively requires exactly one sitekey match, with this logic:

```js
export function resolveSavedWidgetForCleanup(intent, savedSitekey, widgets) {
	if (savedSitekey) {
		const matches = widgets.filter((item) => item?.sitekey === savedSitekey);
		if (matches.length > 1) throw new Error('saved widget sitekey recovery state is ambiguous');
		if (matches.length === 1) {
			const [widget] = matches;
			if (widget.name !== intent?.name || !widget.domains?.includes(intent?.domain)) {
				throw new Error('saved widget sitekey does not match recovery intent');
			}
			return widget;
		}
		const intentMatch = resolveWidgetForCleanup(intent, widgets);
		if (intentMatch) throw new Error('saved widget sitekey does not match recovery intent');
		return null;
	}
	return resolveWidgetForCleanup(intent, widgets);
}
```

Why this is bounded:

- exact saved sitekey + exact intent still returns that widget;
- duplicate saved sitekey remains ambiguous;
- zero saved-sitekey matches delegates intent ambiguity detection to `resolveWidgetForCleanup()`;
- one live intent match under a different sitekey fails;
- multiple live intent matches fail inside `resolveWidgetForCleanup()`;
- zero sitekey match + zero intent match returns `null` as already absent;
- unrelated widgets are never selected.

Do not alter `cleanupWidget()` or the actual Wrangler delete command.

- [ ] **Step 5: Rerun the targeted test and verify GREEN**

Run:

```powershell
pnpm exec vitest run tests/scripts/issue22-hosted-operator.test.ts -t "never trusts a saved widget sitekey unless its fetched widget matches the saved intent"
```

Expected: PASS for all of these cases:

- exact saved widget found;
- already-absent saved widget with unrelated live widget returns null;
- wrong name/domain fails;
- same recovery intent under a different sitekey fails;
- ambiguous intent fails;
- duplicate saved-sitekey match fails.

- [ ] **Step 6: Run the full Issue 22 operator unit suite**

Run:

```powershell
pnpm exec vitest run tests/scripts/issue22-hosted-operator.test.ts
```

Expected: PASS with no failing Issue 22 operator tests.

- [ ] **Step 7: Review the Repair 2 diff for exact deletion safety**

Run:

```powershell
git --no-pager diff -- scripts/issue22-hosted/operator-lib.mjs tests/scripts/issue22-hosted-operator.test.ts
git status --short
```

Expected:

- only the two intended tracked files are modified for Repair 2;
- `cleanupWidget()` and the Wrangler delete command remain unchanged;
- ignored recovery files are not staged or edited;
- no provider mutation has occurred.

- [ ] **Step 8: Commit Repair 2 only**

Run:

```powershell
git add -- scripts/issue22-hosted/operator-lib.mjs tests/scripts/issue22-hosted-operator.test.ts
git diff --cached --check
git commit -m "fix(issue22): make turnstile cleanup idempotent when target is absent"
```

Expected: one bounded Repair 2 commit after the Repair 1 commit.

- [ ] **Step 9: Verify the two-repair history and clean tracked state**

Run:

```powershell
git --no-pager log -4 --oneline
git status --porcelain --untracked-files=no
```

Expected:

- the two implementation commits appear separately and in order;
- tracked status is empty;
- recovery state remains preserved locally.

- [ ] **Step 10: Run a no-hosted final local verification checkpoint**

Run:

```powershell
pnpm exec vitest run tests/scripts/issue22-hosted-operator.test.ts
git diff HEAD~2..HEAD --check
```

Expected: PASS. Stop here for engineering/security review and push. Do not invoke `hosted-cleanup` or `hosted-execute` as part of this implementation plan.