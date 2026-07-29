const repository = process.env.GITHUB_REPOSITORY?.trim();
const sha = process.env.GITHUB_SHA?.trim();
const token = process.env.GITHUB_TOKEN?.trim();

if (!repository || !sha || !token || !/^[0-9a-f]{40}$/i.test(sha)) {
	throw new Error('GITHUB_REPOSITORY, exact GITHUB_SHA, and GITHUB_TOKEN are required');
}

const response = await fetch(
	`https://api.github.com/repos/${repository}/commits/${sha}/check-runs?per_page=100`,
	{
		headers: {
			accept: 'application/vnd.github+json',
			authorization: `Bearer ${token}`,
			'user-agent': 'perfume-marketplace-deploy-gate',
			'x-github-api-version': '2022-11-28'
		}
	}
);
if (!response.ok) {
	throw new Error(`Unable to read exact-SHA CI checks: HTTP ${response.status}`);
}

const payload = await response.json();
const checkRuns = Array.isArray(payload.check_runs) ? payload.check_runs : [];
const requiredChecks = ['app', 'database'];
const failures = requiredChecks.filter((name) =>
	!checkRuns.some((check) =>
		check?.name === name &&
		check?.head_sha === sha &&
		check?.app?.slug === 'github-actions' &&
		check?.status === 'completed' &&
		check?.conclusion === 'success'
	)
);

if (failures.length) {
	throw new Error(`Exact-SHA quality checks are not successful: ${failures.join(', ')}`);
}

console.log(`Exact-SHA quality gate passed for ${sha}: ${requiredChecks.join(', ')}`);
