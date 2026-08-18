import { assertLiveCloudflareCapacity, TARGET } from './operator-lib.mjs';

const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const freeDailyRequestLimit = 100_000;
const freeCpuMsPerInvocation = 10;
const freeSubrequestsPerInvocation = 50;
const standardMonthlyRequestLimit = 10_000_000;
const standardMonthlyCpuMsLimit = 30_000_000;

function stop(message) { throw new Error(`CLOUDFLARE CAPACITY STOP: ${message}`); }

async function cloudflare(path, init = {}) {
	if (!token || token.length < 20) stop('a process-memory CLOUDFLARE_API_TOKEN is required');
	const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
		...init,
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers }
	});
	if (!response.ok) stop(`provider request returned HTTP ${response.status}`);
	const body = await response.json();
	if (body?.success === false || body?.errors?.length) stop('provider response reported an error');
	return body;
}

const now = new Date();
const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const [settings, analytics] = await Promise.all([
	cloudflare(`/accounts/${TARGET.cloudflareAccountId}/workers/account-settings`),
	cloudflare('/graphql', {
		method: 'POST',
		body: JSON.stringify({
			query: `query Issue22WorkerCapacity($accountTag: string!, $dayStart: Time!, $monthStart: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      daily: workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $dayStart, datetime_leq: $end }) {
        sum { requests subrequests errors cpuTimeUs }
      }
      monthly: workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $monthStart, datetime_leq: $end }) {
        sum { requests subrequests errors cpuTimeUs }
      }
    }
  }
}`,
			variables: {
				accountTag: TARGET.cloudflareAccountId,
				dayStart: dayStart.toISOString(),
				monthStart: monthStart.toISOString(),
				end: now.toISOString()
			}
		})
	})
]);

const account = analytics?.data?.viewer?.accounts;
const dailyRows = account?.length === 1 ? account[0]?.daily : null;
const daily = Array.isArray(dailyRows) && dailyRows.length === 0 ? {} : dailyRows?.[0]?.sum;
const monthly = account?.length === 1 ? account[0]?.monthly?.[0]?.sum : null;
if (!daily || !monthly) stop('exact-account UTC-day/current-month Worker aggregates are unavailable');

const receipt = assertLiveCloudflareCapacity({
	accountId: TARGET.cloudflareAccountId,
	usageModel: settings?.result?.default_usage_model,
	daily: {
		currentRequests: Number(daily.requests ?? 0),
		currentSubrequests: Number(daily.subrequests ?? 0),
		currentErrors: Number(daily.errors ?? 0),
		currentCpuMs: Number(daily.cpuTimeUs ?? 0) / 1_000
	},
	monthly: {
		currentRequests: Number(monthly.requests ?? 0),
		currentSubrequests: Number(monthly.subrequests ?? 0),
		currentErrors: Number(monthly.errors ?? 0),
		currentCpuMs: Number(monthly.cpuTimeUs ?? 0) / 1_000
	},
	freeDailyRequestLimit,
	freeCpuMsPerInvocation,
	freeSubrequestsPerInvocation,
	standardMonthlyRequestLimit,
	standardMonthlyCpuMsLimit
});

console.log(JSON.stringify({
	capturedAt: now.toISOString(),
	accountId: receipt.accountId,
	usageModel: receipt.usageModel,
	executionPlan: receipt.executionPlan,
	dailyWindow: { start: dayStart.toISOString(), end: now.toISOString(), ...receipt.daily },
	monthlyWindow: { start: monthStart.toISOString(), end: now.toISOString(), ...receipt.monthly },
	limits: {
		freeDailyRequestLimit,
		freeCpuMsPerInvocation,
		freeSubrequestsPerInvocation,
		standardMonthlyRequestLimit,
		standardMonthlyCpuMsLimit
	},
	remainingDailyRequests: receipt.remainingDailyRequests,
	remainingMonthlyRequests: receipt.remainingMonthlyRequests,
	remainingMonthlyCpuMs: receipt.remainingMonthlyCpuMs,
	operatorBudget: receipt.operatorBudget
}));
