import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireStaffRequest } from './access.server';
import {
	assignReportCase,
	decideModerationReport,
	inspectModerationConversation,
	loadModerationDashboard,
	ModerationWorkflowError,
	reviewMerchantApplication,
	workflowHttpStatus
} from './moderation.server';

function actionFailure(action: 'assign' | 'decide' | 'inspect' | 'merchant', cause: unknown) {
	const workflowError =
		cause instanceof ModerationWorkflowError
			? cause
			: new ModerationWorkflowError('UNAVAILABLE', 'Операцията временно не може да бъде изпълнена.');
	return fail(workflowHttpStatus(workflowError), {
		ok: false as const,
		action,
		code: workflowError.code,
		message: workflowError.message
	});
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const { client, actor } = requireStaffRequest(locals, url);
	try {
		const dashboard = await loadModerationDashboard(client, actor, url.searchParams.get('case'));
		return {
			...dashboard,
			actor,
			generatedAt: new Date().toISOString()
		};
	} catch (cause) {
		if (cause instanceof ModerationWorkflowError && cause.code === 'FORBIDDEN') {
			error(403, cause.message);
		}
		error(503, 'Модерационната опашка временно не е достъпна.');
	}
};

export const actions: Actions = {
	assign: async ({ request, locals, url }) => {
		const { client, actor } = requireStaffRequest(locals, url);
		const formData = await request.formData();
		try {
			const result = await assignReportCase(client, actor.id, {
				caseId: formData.get('caseId')
			});
			return { ok: true as const, action: 'assign' as const, ...result };
		} catch (cause) {
			return actionFailure('assign', cause);
		}
	},

	decide: async ({ request, locals, url }) => {
		const { client, actor } = requireStaffRequest(locals, url);
		const formData = await request.formData();
		try {
			const result = await decideModerationReport(client, actor, {
				caseId: formData.get('caseId'),
				decision: formData.get('decision'),
				rationale: formData.get('rationale')
			});
			return { ok: true as const, action: 'decide' as const, ...result };
		} catch (cause) {
			return actionFailure('decide', cause);
		}
	},

	inspect: async ({ request, locals, url }) => {
		const { client } = requireStaffRequest(locals, url);
		const formData = await request.formData();
		try {
			const result = await inspectModerationConversation(client, {
				caseId: formData.get('caseId')
			});
			return { ok: true as const, action: 'inspect' as const, ...result };
		} catch (cause) {
			return actionFailure('inspect', cause);
		}
	},

	merchant: async ({ request, locals, url }) => {
		const { client } = requireStaffRequest(locals, url);
		const formData = await request.formData();
		try {
			const result = await reviewMerchantApplication(client, {
				applicationId: formData.get('applicationId'),
				decision: formData.get('decision'),
				notes: formData.get('notes') ?? ''
			});
			return { ok: true as const, action: 'merchant' as const, ...result };
		} catch (cause) {
			return actionFailure('merchant', cause);
		}
	}
};
