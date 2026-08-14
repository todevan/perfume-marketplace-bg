# A9 Supabase Timestamp Provenance Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept exact Supabase Auth microsecond `created_at` timestamps without normalization and ensure unsupported post-create timestamps are compensated before a synthetic actor can escape transaction bookkeeping.

**Architecture:** Keep timestamp validation inside `scripts/hosted-report-evidence-operator.mjs`. Replace millisecond-only `Date#toISOString()` equality with strict UTC RFC3339 validation that allows 0–6 fractional digits while preserving the original provider string. Validate the provider `created_at` inside `createConfirmedUser()` before returning the actor; if it is parseable but outside the accepted timestamp contract, delete that exact newly-created user and confirm absence before rejecting.

**Tech Stack:** Node.js 22.x, JavaScript ESM, TypeScript Vitest tests, `@supabase/supabase-js` 2.110.x.

## Global Constraints

- Accept only UTC timestamps ending in `Z`.
- Accept 0–6 fractional-second digits.
- Preserve the exact original Supabase timestamp string; do not truncate or normalize it in the manifest.
- Reject invalid calendar/time values and unsupported timestamp forms.
- A post-create timestamp-contract failure must delete the exact synthetic Auth user and confirm it is absent.
- Errors remain sanitized; do not expose actor emails, passwords, keys, TOTP seeds, IDs, or raw provider details in new error messages.
- Change only `scripts/hosted-report-evidence-operator.mjs` and `tests/scripts/hosted-report-evidence-operator.test.ts`.
- Do not retry hosted A9 during implementation or verification.
- Do not delete the existing residual staging Reporter until the code fix has passed local verification and a separate controlled-cleanup step is approved.

---

## File Structure

- Modify: `scripts/hosted-report-evidence-operator.mjs`
  - owns strict hosted timestamp validation;
  - owns A9 post-create provider validation and compensation.
- Modify: `tests/scripts/hosted-report-evidence-operator.test.ts`
  - adds microsecond timestamp regression coverage;
  - adds strict rejection coverage;
  - adds post-create compensation regression coverage.
- No new runtime files or dependencies.

### Task 1: Lock the timestamp contract with RED tests

**Files:**
- Test: `tests/scripts/hosted-report-evidence-operator.test.ts`

**Interfaces:**
- Consumes: `registerHostedActor(manifest, role, userId, createdAt)`
- Produces: regression expectations for exact microsecond preservation and strict unsupported-form rejection.

- [ ] **Step 1: Add the microsecond preservation regression**

Place this near the existing hosted manifest / actor registration tests:

```ts
it('accepts Supabase microsecond actor timestamps without normalization', () => {
	const config = validateHostedOperatorEnvironment(baseEnvironment);
	const createdAt = '2026-08-09T12:00:00.123456Z';

	const manifest = registerHostedActor(
		createHostedRunManifest(config),
		'reporter',
		actorIds.reporter,
		createdAt
	);

	expect(manifest.actors).toHaveLength(1);
	expect(manifest.actors[0]?.createdAt).toBe(createdAt);
});
```

- [ ] **Step 2: Add strict invalid/unsupported timestamp regressions**

Add immediately after the microsecond test:

```ts
it.each([
	'2026-02-30T12:00:00Z',
	'2026-08-09T24:00:00Z',
	'2026-08-09T12:00:00.1234567Z',
	'2026-08-09T12:00:00+00:00',
	'2026-08-09 12:00:00Z'
])('rejects unsupported actor timestamp %s', (createdAt) => {
	const config = validateHostedOperatorEnvironment(baseEnvironment);

	expect(() =>
		registerHostedActor(
			createHostedRunManifest(config),
			'reporter',
			actorIds.reporter,
			createdAt
		)
	).toThrow(/actor provisioning timestamp is invalid/u);
});
```

- [ ] **Step 3: Run only the new timestamp tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/scripts/hosted-report-evidence-operator.test.ts -t "microsecond actor timestamps|unsupported actor timestamp"
```

Expected before implementation:

- `accepts Supabase microsecond actor timestamps without normalization` fails with `actor provisioning timestamp is invalid`;
- existing/unsupported-form tests may already pass; that is acceptable;
- no hosted network mutation occurs.

- [ ] **Step 4: Do not commit yet**

Task 1 is intentionally RED. Keep the failing tests uncommitted until Task 2 makes them green.

---

### Task 2: Implement strict UTC RFC3339 validation without normalization

**Files:**
- Modify: `scripts/hosted-report-evidence-operator.mjs`
- Test: `tests/scripts/hosted-report-evidence-operator.test.ts`

**Interfaces:**
- Consumes: existing internal `requireIsoTimestamp(value: string)`
- Produces: the same function contract — returns the exact original `value` or throws `HostedEvidenceOperatorError('actor provisioning timestamp is invalid')`.

- [ ] **Step 1: Replace the millisecond-only validator**

Replace the current `requireIsoTimestamp()` body with:

```js
/** @param {string} value */
function requireIsoTimestamp(value) {
	const match =
		/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/u.exec(value);
	if (!match) {
		throw new HostedEvidenceOperatorError('actor provisioning timestamp is invalid');
	}

	const parsed = Date.parse(value);
	const milliseconds = (match[2] ?? '').padEnd(3, '0').slice(0, 3);
	const canonicalMilliseconds = `${match[1]}.${milliseconds}Z`;

	if (
		!Number.isFinite(parsed) ||
		new Date(parsed).toISOString() !== canonicalMilliseconds
	) {
		throw new HostedEvidenceOperatorError('actor provisioning timestamp is invalid');
	}

	return value;
}
```

Why this shape:

- the regex requires the exact UTC `Z` structure and caps precision at six digits;
- `Date.parse()` plus canonical millisecond comparison rejects impossible calendar/time values;
- extra microsecond digits are used only for validation compatibility and are never discarded from the returned value.

- [ ] **Step 2: Run the timestamp tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/scripts/hosted-report-evidence-operator.test.ts -t "microsecond actor timestamps|unsupported actor timestamp"
```

Expected:

```text
PASS
```

The microsecond test must prove the exact six-digit string remains in `manifest.actors[0].createdAt`.

- [ ] **Step 3: Run the entire operator test file**

Run:

```bash
pnpm exec vitest run tests/scripts/hosted-report-evidence-operator.test.ts
```

Expected:

```text
PASS
```

Do not proceed if an existing provenance or manifest test regresses.

---

### Task 3: Prevent post-create timestamp-contract failures from leaving an actor

**Files:**
- Modify: `tests/scripts/hosted-report-evidence-operator.test.ts`
- Modify: `scripts/hosted-report-evidence-operator.mjs`

**Interfaces:**
- Consumes:
  - `createSupabaseHostedA9Adapters({ config, serviceClient, createActorClient, credentialSink })`
  - `adapters.assertFreshActorAbsent({ manifest, role })`
  - `adapters.createConfirmedUser({ manifest, role })`
  - existing internal `deleteAndConfirmAbsent(userId, failureMessage)`
- Produces: `createConfirmedUser()` never returns an actor whose `created_at` violates `requireIsoTimestamp()`.

- [ ] **Step 1: Write the RED compensation regression**

Add this test in the existing A9 adapter test section:

```ts
it('compensates a created actor whose provider timestamp is outside the hosted contract', async () => {
	const config = validateHostedA9Environment(a9Environment);
	const userId = actorIds.reporter;
	const unsupportedCreatedAt = '2026-08-09T12:00:00+00:00';
	const user = {
		...provisionedUser('reporter', userId),
		created_at: unsupportedCreatedAt
	};

	const listUsers = vi.fn().mockResolvedValue({
		data: { users: [], lastPage: 1 },
		error: null
	});
	const createUser = vi.fn().mockResolvedValue({
		data: { user },
		error: null
	});
	const deleteUser = vi.fn().mockResolvedValue({ error: null });
	const getUserById = vi.fn().mockResolvedValue({
		data: { user: null },
		error: { status: 404 }
	});

	const adapters = createSupabaseHostedA9Adapters({
		config,
		serviceClient: {
			supabaseUrl: HOSTED_STAGING.supabaseUrl,
			auth: {
				admin: {
					listUsers,
					createUser,
					deleteUser,
					getUserById
				}
			}
		} as never,
		createActorClient: vi.fn() as never,
		credentialSink: noopModeratorCredentialSink()
	});

	const manifest = registerHostedActorIntent(
		createHostedRunManifest(config),
		'reporter'
	);

	await expect(
		adapters.assertFreshActorAbsent({ manifest, role: 'reporter' })
	).resolves.toEqual({ role: 'reporter', absent: true });

	await expect(
		adapters.createConfirmedUser({ manifest, role: 'reporter' })
	).rejects.toThrow(/confirmed A9 actor creation failed/u);

	expect(createUser).toHaveBeenCalledOnce();
	expect(deleteUser).toHaveBeenCalledWith(userId);
	expect(getUserById).toHaveBeenCalledWith(userId);
});
```

- [ ] **Step 2: Run only this test and verify RED**

Run:

```bash
pnpm exec vitest run tests/scripts/hosted-report-evidence-operator.test.ts -t "compensates a created actor whose provider timestamp"
```

Expected before implementation:

- FAIL because `createConfirmedUser()` currently accepts the parseable `+00:00` timestamp and resolves instead of compensating.

- [ ] **Step 3: Add pre-return timestamp validation with compensation**

Inside `createConfirmedUser(scope)`, after `requireUuid(user.id, 'actor ID');` and before constructing/returning the actor, add:

```js
			try {
				requireIsoTimestamp(user.created_at);
			} catch {
				await deleteAndConfirmAbsent(user.id, 'A9 actor creation compensation failed');
				throw new HostedEvidenceOperatorError('confirmed A9 actor creation failed');
			}
```

Keep the error sanitized. Do not include `user.created_at`, email, user ID, provider payload, or credentials in the error text.

- [ ] **Step 4: Run the compensation test and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/scripts/hosted-report-evidence-operator.test.ts -t "compensates a created actor whose provider timestamp"
```

Expected:

```text
PASS
```

- [ ] **Step 5: Run all focused A9/operator tests**

Run:

```bash
pnpm exec vitest run \
  tests/scripts/hosted-report-evidence-operator.test.ts \
  tests/scripts/hosted-a9-runner.test.ts
```

Expected:

```text
PASS
```

- [ ] **Step 6: Commit the code fix**

Inspect the diff first:

```bash
git diff -- \
  scripts/hosted-report-evidence-operator.mjs \
  tests/scripts/hosted-report-evidence-operator.test.ts
```

Then commit only the two reviewed files:

```bash
git add \
  scripts/hosted-report-evidence-operator.mjs \
  tests/scripts/hosted-report-evidence-operator.test.ts

git commit -m "fix: accept Supabase microsecond actor timestamps"
```

Do not add any untracked wizard scripts to this commit.

---

### Task 4: Verification gate before any hosted cleanup or retry

**Files:**
- No implementation changes expected.
- Read-only verification only.

**Interfaces:**
- Produces: evidence that the code fix is locally complete and isolated from unrelated working-tree files.

- [ ] **Step 1: Re-run focused tests from a clean command**

Run:

```bash
pnpm exec vitest run \
  tests/scripts/hosted-report-evidence-operator.test.ts \
  tests/scripts/hosted-a9-runner.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository static check**

Run:

```bash
pnpm check
```

Expected: exit 0.

If `pnpm check` fails because of unrelated pre-existing work, stop and classify the failures before changing anything else.

- [ ] **Step 3: Verify commit scope and preserve untracked operator scripts**

Run:

```bash
git status --short
git show --stat --oneline HEAD
```

Expected:

- the timestamp-fix commit contains only:
  - `scripts/hosted-report-evidence-operator.mjs`
  - `tests/scripts/hosted-report-evidence-operator.test.ts`
- existing untracked wizard scripts remain untracked and untouched.

- [ ] **Step 4: Stop before hosted mutation**

Do not run:

```bash
./scripts/a9-close-hosted-runner-wizard.sh
```

Do not manually delete the residual Reporter.

The next operational phase is a separately reviewed, target-locked cleanup of the exact residual synthetic Reporter, followed by read-only absence verification. Only after that cleanup succeeds should a new A9 provisioning attempt be considered.
