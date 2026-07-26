import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

type StaffRole = 'moderator' | 'admin';
type ReportStatus = 'open' | 'investigating' | 'resolved' | 'dismissed';
type ReportTargetType =
	| 'profile'
	| 'brand'
	| 'listing'
	| 'offer'
	| 'conversation'
	| 'message'
	| 'deal'
	| 'review'
	| 'profile_comment';
type ModerationDecision =
	| 'keep'
	| 'hide'
	| 'remove'
	| 'suspend'
	| 'restore'
	| 'publish'
	| 'resume'
	| 'cancel';

type WorkflowErrorCode =
	| 'VALIDATION'
	| 'FORBIDDEN'
	| 'NOT_FOUND'
	| 'CONFLICT'
	| 'UNSUPPORTED'
	| 'UNAVAILABLE'
	| 'DELIVERY_FAILED'
	| 'COMPENSATION_FAILED';

export class ModerationWorkflowError extends Error {
	constructor(
		readonly code: WorkflowErrorCode,
		message: string
	) {
		super(message);
		this.name = 'ModerationWorkflowError';
	}
}

const uuidSchema = z.string().uuid();
const reportTargetSchema = z.enum([
	'profile',
	'brand',
	'listing',
	'offer',
	'conversation',
	'message',
	'deal',
	'review',
	'profile_comment'
]);
const reportRowSchema = z.object({
	id: uuidSchema,
	reporter_id: uuidSchema,
	target_type: reportTargetSchema,
	target_id: uuidSchema,
	reason_code: z.string().min(2).max(80),
	details: z.string().max(4000).nullable(),
	evidence_paths: z.unknown(),
	status: z.enum(['open', 'investigating', 'resolved', 'dismissed']),
	assigned_to: uuidSchema.nullable(),
	resolution_code: z.string().nullable(),
	resolution_notes: z.string().nullable(),
	resolved_at: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string()
});
const profileRowSchema = z.object({ id: uuidSchema, username: z.string().min(1).max(80) });
const listingRowSchema = z.object({
	id: uuidSchema,
	title: z.string().min(1).max(300),
	status: z.string()
});
const merchantApplicationRowSchema = z.object({
	id: uuidSchema,
	applicant_id: uuidSchema,
	status: z.enum(['submitted', 'under_review', 'approved', 'rejected']),
	legal_name: z.string().min(1).max(300),
	registration_number: z.string().min(1).max(120),
	registered_address: z.string().min(1).max(500),
	website_url: z.string().max(2048).nullable(),
	document_paths: z.unknown(),
	reviewer_id: uuidSchema.nullable(),
	reviewer_notes: z.string().nullable(),
	submitted_at: z.string().nullable(),
	reviewed_at: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string()
});
const auditRowSchema = z.object({
	id: z.union([z.number(), z.string()]),
	actor_id: uuidSchema,
	action: z.string().min(1).max(80),
	rationale: z.string().min(1).max(4000),
	created_at: z.string()
});
const assignInputSchema = z.object({ caseId: uuidSchema });
const decisionInputSchema = z.object({
	caseId: uuidSchema,
	decision: z.enum(['keep', 'hide', 'remove', 'suspend', 'restore', 'publish', 'resume', 'cancel']),
	rationale: z.string().trim().min(10).max(4000)
});
const inviteInputSchema = z.object({
	email: z.string().trim().toLowerCase().email().max(320),
	adminId: uuidSchema,
	appOrigin: z.string().url()
});
const merchantReviewInputSchema = z
	.object({
		applicationId: uuidSchema,
		decision: z.enum(['claim', 'approve', 'reject']),
		notes: z.string().trim().max(4000).default('')
	})
	.superRefine((value, context) => {
		if (value.decision !== 'claim' && value.notes.length < 2) {
			context.addIssue({
				code: 'custom',
				path: ['notes'],
				message: 'Final merchant decisions require review notes.'
			});
		}
	});
const inviteResultSchema = z.object({
	invite_id: uuidSchema,
	invite_token: z.string().min(32).max(256),
	invite_expires_at: z.string()
});

type ReportRow = z.infer<typeof reportRowSchema>;

export interface ModerationCaseDto {
	id: string;
	reference: string;
	reason: string;
	targetType: ReportTargetType;
	targetTitle: string;
	reporter: string;
	risk: 'high' | 'medium';
	createdAt: string;
	evidenceCount: number;
	status: 'open' | 'investigating';
	assignedTo: string | null;
	isAssignedToViewer: boolean;
	canClaim: boolean;
	canDecide: boolean;
	supported: boolean;
}

export interface ModerationCaseDetailDto extends ModerationCaseDto {
	details: string | null;
	targetStatus: string;
	evidence: readonly { url: string; label: string }[];
}

export interface ModerationAuditDto {
	id: string;
	action: string;
	rationale: string;
	actor: string;
	createdAt: string;
}

export interface MerchantApplicationDto {
	id: string;
	applicant: string;
	legalName: string;
	registrationNumber: string;
	registeredAddress: string;
	websiteUrl: string | null;
	status: 'submitted' | 'under_review';
	reviewerId: string | null;
	submittedAt: string | null;
	documents: readonly { url: string; label: string }[];
	canClaim: boolean;
	canDecide: boolean;
}

export interface ModerationDashboardDto {
	cases: readonly ModerationCaseDto[];
	selected: ModerationCaseDetailDto | null;
	audit: readonly ModerationAuditDto[];
	merchantApplications: readonly MerchantApplicationDto[];
	stats: {
		open: number;
		investigating: number;
		highRisk: number;
		total: number;
		merchantPending: number;
	};
}

function workflowErrorFromDatabase(error: { code?: string } | null): ModerationWorkflowError {
	if (error?.code === '42501' || error?.code === 'PGRST301') {
		return new ModerationWorkflowError('FORBIDDEN', 'Операцията не е разрешена.');
	}
	if (error?.code === 'P0002' || error?.code === 'PGRST116') {
		return new ModerationWorkflowError('NOT_FOUND', 'Модерационният случай не е намерен.');
	}
	if (error?.code === '23505') {
		return new ModerationWorkflowError('CONFLICT', 'Операцията вече е извършена или е в конфликт.');
	}
	if (error?.code === '23514' || error?.code === '22023' || error?.code === '22P02') {
		return new ModerationWorkflowError('VALIDATION', 'Данните не отговарят на workflow правилата.');
	}
	return new ModerationWorkflowError('UNAVAILABLE', 'Модерационната услуга временно не е достъпна.');
}

function databaseResult<T>(
	data: T | null,
	error: { code?: string } | null,
	schema: z.ZodType<T>
): T {
	if (error) throw workflowErrorFromDatabase(error);
	const parsed = schema.safeParse(data);
	if (!parsed.success) {
		throw new ModerationWorkflowError('UNAVAILABLE', 'Получен е невалиден отговор от модерационната услуга.');
	}
	return parsed.data;
}

function parseRows<T>(data: unknown, schema: z.ZodType<T>): T[] {
	const parsed = z.array(schema).safeParse(data ?? []);
	if (!parsed.success) {
		throw new ModerationWorkflowError('UNAVAILABLE', 'Получени са невалидни модерационни данни.');
	}
	return parsed.data;
}

function evidencePaths(value: unknown): string[] {
	const parsed = z.array(z.string().min(1).max(1024)).max(20).safeParse(value);
	if (!parsed.success) {
		throw new ModerationWorkflowError('UNAVAILABLE', 'Доказателствата към сигнала са невалидни.');
	}
	return [...new Set(parsed.data)];
}

function shortReference(id: string): string {
	return `RPT-${id.slice(0, 8).toUpperCase()}`;
}

function reasonLabel(code: string): string {
	const labels: Record<string, string> = {
		counterfeit: 'Подозиран фалшификат',
		stolen_photos: 'Откраднати снимки',
		misleading_listing: 'Подвеждаща обява',
		wrong_fill_level: 'Неточен остатък',
		prohibited_content: 'Забранено съдържание'
	};
	return labels[code] ?? code.replaceAll('_', ' ');
}

function reportRisk(code: string): 'high' | 'medium' {
	return /(counterfeit|fraud|scam|stolen|danger)/i.test(code) ? 'high' : 'medium';
}

function auditLabel(action: string): string {
	const labels: Record<string, string> = {
		report_assigned: 'Случаят е поет за разследване',
		report_resolved: 'Случаят е приключен',
		content_hidden: 'Обявата е скрита',
		content_restored: 'Обявата остава активна',
		content_removed: 'Обявата е премахната',
		category_corrected: 'Категорията е коригирана',
		authenticity_reviewed: 'Проверката за автентичност е приключена'
	};
	return labels[action] ?? action.replaceAll('_', ' ');
}

function safeExternalUrl(value: string | null): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
	} catch {
		return null;
	}
}

function supportsDecision(targetType: ReportTargetType): boolean {
	return ['listing', 'profile', 'review', 'profile_comment', 'deal'].includes(targetType);
}

function genericTargetTitle(report: ReportRow): string {
	const labels: Record<ReportTargetType, string> = {
		profile: 'Профил',
		brand: 'Марка',
		listing: 'Обява',
		offer: 'Оферта',
		conversation: 'Разговор',
		message: 'Съобщение',
		deal: 'Сделка',
		review: 'Отзив',
		profile_comment: 'Коментар към профил'
	};
	return `${labels[report.target_type]} ${report.target_id.slice(0, 8)}`;
}

async function queryProfiles(client: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
	const uniqueIds = [...new Set(ids)];
	if (uniqueIds.length === 0) return new Map();
	const { data, error } = await client.from('profiles').select('id, username').in('id', uniqueIds);
	if (error) throw workflowErrorFromDatabase(error);
	return new Map(parseRows(data, profileRowSchema).map((row) => [row.id, row.username]));
}

async function signedEvidence(
	client: SupabaseClient,
	paths: readonly string[]
): Promise<readonly { url: string; label: string }[]> {
	if (paths.length === 0) return [];
	const { data, error } = await client.storage.from('report-evidence').createSignedUrls([...paths], 300);
	if (error || !data || data.some((item) => !item.signedUrl)) {
		throw new ModerationWorkflowError('UNAVAILABLE', 'Доказателствата временно не могат да бъдат отворени.');
	}
	return data.map((item, index) => {
		if (!item.signedUrl) {
			throw new ModerationWorkflowError(
				'UNAVAILABLE',
				'Доказателствата временно не могат да бъдат отворени.'
			);
		}
		return { url: item.signedUrl, label: `Доказателство ${index + 1}` };
	});
}

async function signedPrivateDocuments(
	client: SupabaseClient,
	paths: readonly string[]
): Promise<readonly { url: string; label: string }[]> {
	if (paths.length === 0) return [];
	const { data, error } = await client.storage
		.from('merchant-documents')
		.createSignedUrls([...paths], 300);
	if (error || !data) {
		throw new ModerationWorkflowError('UNAVAILABLE', 'Търговските документи временно не са достъпни.');
	}
	return data.map((item, index) => {
		if (!item.signedUrl) {
			throw new ModerationWorkflowError(
				'UNAVAILABLE',
				'Търговските документи временно не са достъпни.'
			);
		}
		return { url: item.signedUrl, label: `Документ ${index + 1}` };
	});
}

async function loadMerchantApplications(
	client: SupabaseClient,
	viewer: { id: string; role: StaffRole }
): Promise<readonly MerchantApplicationDto[]> {
	const { data, error } = await client
		.from('merchant_applications')
		.select(
			'id, applicant_id, status, legal_name, registration_number, registered_address, website_url, document_paths, reviewer_id, reviewer_notes, submitted_at, reviewed_at, created_at, updated_at'
		)
		.in('status', ['submitted', 'under_review'])
		.order('submitted_at', { ascending: true, nullsFirst: false })
		.limit(20);
	if (error) throw workflowErrorFromDatabase(error);
	const rows = parseRows(data, merchantApplicationRowSchema).filter(
		(row): row is z.infer<typeof merchantApplicationRowSchema> & {
			status: 'submitted' | 'under_review';
		} => row.status === 'submitted' || row.status === 'under_review'
	);
	const applicants = await queryProfiles(
		client,
		rows.map((row) => row.applicant_id)
	);
	return Promise.all(
		rows.map(async (row) => ({
			id: row.id,
			applicant: applicants.get(row.applicant_id) ?? row.applicant_id.slice(0, 8),
			legalName: row.legal_name,
			registrationNumber: row.registration_number,
			registeredAddress: row.registered_address,
			websiteUrl: safeExternalUrl(row.website_url),
			status: row.status,
			reviewerId: row.reviewer_id,
			submittedAt: row.submitted_at,
			documents: await signedPrivateDocuments(client, evidencePaths(row.document_paths)),
			canClaim: row.status === 'submitted',
			canDecide:
				row.status === 'under_review' &&
				(row.reviewer_id === viewer.id || viewer.role === 'admin')
		}))
	);
}

export async function loadModerationDashboard(
	client: SupabaseClient,
	viewer: { id: string; role: StaffRole },
	requestedCaseId: string | null
): Promise<ModerationDashboardDto> {
	const merchantApplicationsPromise = loadMerchantApplications(client, viewer);
	const { data: reportData, error: reportError } = await client
		.from('reports')
		.select(
			'id, reporter_id, target_type, target_id, reason_code, details, evidence_paths, status, assigned_to, resolution_code, resolution_notes, resolved_at, created_at, updated_at'
		)
		.in('status', ['open', 'investigating'])
		.order('created_at', { ascending: true })
		.limit(50);
	if (reportError) throw workflowErrorFromDatabase(reportError);
	const reports = parseRows(reportData, reportRowSchema);

	const listingIds = reports
		.filter((report) => report.target_type === 'listing')
		.map((report) => report.target_id);
	const profileIds = [
		...reports.map((report) => report.reporter_id),
		...reports
			.filter((report) => report.target_type === 'profile')
			.map((report) => report.target_id)
	];
	const [reporters, listingResult] = await Promise.all([
		queryProfiles(client, profileIds),
		listingIds.length
			? client.from('listings').select('id, title, status').in('id', [...new Set(listingIds)])
			: Promise.resolve({ data: [], error: null })
	]);
	if (listingResult.error) throw workflowErrorFromDatabase(listingResult.error);
	const listings = new Map(
		parseRows(listingResult.data, listingRowSchema).map((listing) => [listing.id, listing])
	);

	const summary = (report: ReportRow): ModerationCaseDto => {
		const assignedToViewer = report.assigned_to === viewer.id;
		const supported = supportsDecision(report.target_type);
		const targetTitle =
			report.target_type === 'listing'
				? (listings.get(report.target_id)?.title ?? genericTargetTitle(report))
				: report.target_type === 'profile'
					? `@${reporters.get(report.target_id) ?? report.target_id.slice(0, 8)}`
					: genericTargetTitle(report);
		return {
			id: report.id,
			reference: shortReference(report.id),
			reason: reasonLabel(report.reason_code),
			targetType: report.target_type,
			targetTitle,
			reporter: reporters.get(report.reporter_id) ?? 'неизвестен профил',
			risk: reportRisk(report.reason_code),
			createdAt: report.created_at,
			evidenceCount: evidencePaths(report.evidence_paths).length,
			status: report.status as 'open' | 'investigating',
			assignedTo: report.assigned_to,
			isAssignedToViewer: assignedToViewer,
			canClaim: report.status === 'open' && report.assigned_to === null,
			canDecide:
				supported &&
				report.status === 'investigating' &&
				(assignedToViewer || (viewer.role === 'admin' && report.target_type !== 'deal')),
			supported
		};
	};

	const cases = reports.map(summary);
	const selectedRow =
		reports.find((report) => report.id === requestedCaseId) ?? reports[0] ?? null;
	if (!selectedRow) {
		const merchantApplications = await merchantApplicationsPromise;
		return {
			cases,
			selected: null,
			audit: [],
			merchantApplications,
			stats: {
				open: 0,
				investigating: 0,
				highRisk: 0,
				total: 0,
				merchantPending: merchantApplications.length
			}
		};
	}

	const paths = evidencePaths(selectedRow.evidence_paths);
	const [{ data: auditData, error: auditError }, evidence, merchantApplications] = await Promise.all([
		client
			.from('moderation_audit')
			.select('id, actor_id, action, rationale, created_at')
			.eq('report_id', selectedRow.id)
			.order('created_at', { ascending: true }),
		signedEvidence(client, paths),
		merchantApplicationsPromise
	]);
	if (auditError) throw workflowErrorFromDatabase(auditError);
	const auditRows = parseRows(auditData, auditRowSchema);
	const actors = await queryProfiles(client, auditRows.map((entry) => entry.actor_id));

	const selectedSummary = summary(selectedRow);
	return {
		cases,
		selected: {
			...selectedSummary,
			details: selectedRow.details,
			targetStatus:
				selectedRow.target_type === 'listing'
					? (listings.get(selectedRow.target_id)?.status ?? 'unknown')
					: selectedRow.target_type,
			evidence
		},
		audit: auditRows.map((entry) => ({
			id: String(entry.id),
			action: auditLabel(entry.action),
			rationale: entry.rationale,
			actor: actors.get(entry.actor_id) ?? 'staff',
			createdAt: entry.created_at
		})),
		merchantApplications,
		stats: {
			open: reports.filter((report) => report.status === 'open').length,
			investigating: reports.filter((report) => report.status === 'investigating').length,
			highRisk: reports.filter((report) => reportRisk(report.reason_code) === 'high').length,
			total: reports.length,
			merchantPending: merchantApplications.length
		}
	};
}

export async function assignReportCase(
	client: SupabaseClient,
	actorId: string,
	rawInput: unknown
): Promise<{ caseId: string; status: 'investigating' }> {
	const parsed = assignInputSchema.safeParse(rawInput);
	if (!parsed.success) throw new ModerationWorkflowError('VALIDATION', 'Невалиден номер на сигнал.');

	const { data, error } = await client
		.from('reports')
		.update({ assigned_to: actorId, status: 'investigating' })
		.eq('id', parsed.data.caseId)
		.eq('status', 'open')
		.is('assigned_to', null)
		.select('id, status, assigned_to')
		.maybeSingle();
	if (error) throw workflowErrorFromDatabase(error);
	if (!data) {
		throw new ModerationWorkflowError('CONFLICT', 'Сигналът вече е поет или е променен.');
	}

	const result = z
		.object({ id: uuidSchema, status: z.literal('investigating'), assigned_to: uuidSchema })
		.safeParse(data);
	if (!result.success || result.data.assigned_to !== actorId) {
		throw new ModerationWorkflowError('UNAVAILABLE', 'Сигналът не беше присвоен безопасно.');
	}
	return { caseId: result.data.id, status: result.data.status };
}

const listingDecisionMapping: Record<
	Extract<ModerationDecision, 'keep' | 'hide' | 'remove'>,
	{ listingStatus: 'active' | 'paused' | 'removed'; resolutionCode: string }
> = {
	keep: { listingStatus: 'active', resolutionCode: 'no_violation' },
	hide: { listingStatus: 'paused', resolutionCode: 'content_hidden' },
	remove: { listingStatus: 'removed', resolutionCode: 'content_removed' }
};

async function closeReportCase(
	client: SupabaseClient,
	reportId: string,
	resolutionCode: string,
	rationale: string
): Promise<void> {
	const { data, error } = await client
		.from('reports')
		.update({
			status: 'resolved',
			resolution_code: resolutionCode,
			resolution_notes: rationale
		})
		.eq('id', reportId)
		.eq('status', 'investigating')
		.select('id, status')
		.maybeSingle();
	if (error) throw workflowErrorFromDatabase(error);
	const closed = z.object({ id: uuidSchema, status: z.literal('resolved') }).safeParse(data);
	if (!closed.success) {
		throw new ModerationWorkflowError(
			'CONFLICT',
			'Решението е одитирано, но случаят остана отворен за проверка.'
		);
	}
}

export async function decideModerationReport(
	client: SupabaseClient,
	actor: { id: string; role: StaffRole },
	rawInput: unknown
): Promise<{ caseId: string; status: 'resolved'; decision: ModerationDecision }> {
	const parsed = decisionInputSchema.safeParse(rawInput);
	if (!parsed.success) {
		throw new ModerationWorkflowError(
			'VALIDATION',
			'Избери решение и добави конкретни мотиви от поне 10 знака.'
		);
	}

	const { data: caseData, error: caseError } = await client
		.from('reports')
		.select(
			'id, reporter_id, target_type, target_id, reason_code, details, evidence_paths, status, assigned_to, resolution_code, resolution_notes, resolved_at, created_at, updated_at'
		)
		.eq('id', parsed.data.caseId)
		.maybeSingle();
	if (caseError) throw workflowErrorFromDatabase(caseError);
	if (!caseData) throw new ModerationWorkflowError('NOT_FOUND', 'Сигналът не е намерен.');
	const report = databaseResult(caseData, null, reportRowSchema);
	if (report.status !== 'investigating') {
		throw new ModerationWorkflowError('CONFLICT', 'Сигналът не е в активно разследване.');
	}
	if (
		report.assigned_to !== actor.id &&
		(actor.role !== 'admin' || report.target_type === 'deal')
	) {
		throw new ModerationWorkflowError('FORBIDDEN', 'Сигналът е присвоен на друг модератор.');
	}

	let resolutionCode: string | null = null;
	let rpcName: string;
	let rpcArguments: Record<string, unknown>;

	switch (report.target_type) {
		case 'listing': {
			if (!['keep', 'hide', 'remove'].includes(parsed.data.decision)) {
				throw new ModerationWorkflowError('VALIDATION', 'Невалидно решение за обява.');
			}
			const decision = listingDecisionMapping[
				parsed.data.decision as 'keep' | 'hide' | 'remove'
			];
			rpcName = 'moderate_listing';
			rpcArguments = {
				report_case_id: report.id,
				target_listing_id: report.target_id,
				moderation_rationale: parsed.data.rationale,
				corrected_audience: null,
				corrected_segments: null,
				moderated_status: decision.listingStatus
			};
			resolutionCode = decision.resolutionCode;
			break;
		}
		case 'profile': {
			if (!['suspend', 'restore'].includes(parsed.data.decision)) {
				throw new ModerationWorkflowError('VALIDATION', 'Невалидно решение за профил.');
			}
			rpcName = 'moderate_profile';
			rpcArguments = {
				report_case_id: report.id,
				target_profile_id: report.target_id,
				suspend_profile: parsed.data.decision === 'suspend',
				moderation_rationale: parsed.data.rationale
			};
			resolutionCode = parsed.data.decision === 'suspend' ? 'user_suspended' : 'user_restored';
			break;
		}
		case 'review':
		case 'profile_comment': {
			if (!['publish', 'hide', 'remove'].includes(parsed.data.decision)) {
				throw new ModerationWorkflowError('VALIDATION', 'Невалидно решение за съдържание.');
			}
			const status =
				parsed.data.decision === 'publish'
					? 'published'
					: parsed.data.decision === 'hide'
						? 'hidden'
						: 'removed';
			rpcName = report.target_type === 'review' ? 'moderate_review' : 'moderate_profile_comment';
			rpcArguments = {
				report_case_id: report.id,
				[report.target_type === 'review' ? 'target_review_id' : 'target_comment_id']:
					report.target_id,
				moderated_status: status,
				moderation_rationale: parsed.data.rationale
			};
			resolutionCode = `content_${status}`;
			break;
		}
		case 'deal': {
			if (!['resume', 'cancel'].includes(parsed.data.decision)) {
				throw new ModerationWorkflowError('VALIDATION', 'Невалидно решение за спор.');
			}
			rpcName = 'resolve_deal_dispute';
			rpcArguments = {
				report_case_id: report.id,
				target_deal_id: report.target_id,
				resolution_status:
					parsed.data.decision === 'resume' ? 'pending_confirmation' : 'cancelled',
				rationale: parsed.data.rationale
			};
			break;
		}
		default:
			throw new ModerationWorkflowError(
				'UNSUPPORTED',
				'Този тип сигнал няма безопасен report-bound decision RPC.'
			);
	}

	const { error: moderationError } = await client.rpc(rpcName, rpcArguments);
	if (moderationError) throw workflowErrorFromDatabase(moderationError);
	if (report.target_type !== 'deal' && resolutionCode) {
		await closeReportCase(client, report.id, resolutionCode, parsed.data.rationale);
	}

	return { caseId: report.id, status: 'resolved', decision: parsed.data.decision };
}

export async function createBetaInviteAndSendEmail(
	serviceClient: SupabaseClient,
	rawInput: unknown
): Promise<{ email: string; expiresAt: string }> {
	const parsed = inviteInputSchema.safeParse(rawInput);
	if (!parsed.success) {
		throw new ModerationWorkflowError('VALIDATION', 'Въведи валиден имейл адрес.');
	}

	const { data, error } = await serviceClient.rpc('create_beta_invite', {
		invited_email: parsed.data.email,
		invited_by: parsed.data.adminId,
		valid_for: '7 days'
	});
	if (error) throw workflowErrorFromDatabase(error);
	const inviteRows = parseRows(data, inviteResultSchema);
	if (inviteRows.length !== 1) {
		throw new ModerationWorkflowError('UNAVAILABLE', 'Поканата не беше създадена безопасно.');
	}
	const invite = inviteRows[0];

	const callback = new URL('/auth/callback', parsed.data.appOrigin);
	callback.searchParams.set('invite_token', invite.invite_token);
	const { error: deliveryError } = await serviceClient.auth.admin.inviteUserByEmail(
		parsed.data.email,
		{ redirectTo: callback.toString() }
	);

	if (deliveryError) {
		const { error: compensationError } = await serviceClient.rpc('revoke_beta_invite', {
			target_invite_id: invite.invite_id
		});
		if (compensationError) {
			throw new ModerationWorkflowError(
				'COMPENSATION_FAILED',
				'Доставката се провали и поканата изисква административна проверка.'
			);
		}
		throw new ModerationWorkflowError('DELIVERY_FAILED', 'Имейлът с поканата не беше изпратен.');
	}

	return { email: parsed.data.email, expiresAt: invite.invite_expires_at };
}

export async function reviewMerchantApplication(
	client: SupabaseClient,
	rawInput: unknown
): Promise<{
	applicationId: string;
	status: 'under_review' | 'approved' | 'rejected';
}> {
	const parsed = merchantReviewInputSchema.safeParse(rawInput);
	if (!parsed.success) {
		throw new ModerationWorkflowError(
			'VALIDATION',
			'Избери валидно решение и добави мотиви при одобрение или отказ.'
		);
	}
	const targetStatus =
		parsed.data.decision === 'claim'
			? 'under_review'
			: parsed.data.decision === 'approve'
				? 'approved'
				: 'rejected';
	const { data, error } = await client.rpc('review_merchant_application', {
		target_application_id: parsed.data.applicationId,
		target_status: targetStatus,
		review_notes: parsed.data.notes || null
	});
	if (error) throw workflowErrorFromDatabase(error);

	const responseSchema = z.object({ id: uuidSchema, status: z.literal(targetStatus) });
	const direct = responseSchema.safeParse(data);
	const array = z.array(responseSchema).length(1).safeParse(data);
	const result = direct.success ? direct.data : array.success ? array.data[0] : null;
	if (!result) {
		throw new ModerationWorkflowError('UNAVAILABLE', 'Merchant review RPC върна невалиден отговор.');
	}
	return { applicationId: result.id, status: result.status };
}

export function workflowHttpStatus(error: ModerationWorkflowError): 400 | 403 | 404 | 409 | 503 {
	switch (error.code) {
		case 'VALIDATION':
			return 400;
		case 'FORBIDDEN':
			return 403;
		case 'NOT_FOUND':
			return 404;
		case 'CONFLICT':
		case 'UNSUPPORTED':
			return 409;
		default:
			return 503;
	}
}
