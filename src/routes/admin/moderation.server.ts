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
const queueReportRowSchema = z.object({
	report_id: uuidSchema,
	target_type: reportTargetSchema,
	reason_code: z.string().min(2).max(80),
	status: z.enum(['open', 'investigating']),
	assignment_state: z.enum(['unassigned', 'assigned_to_you']),
	created_at: z.string()
});
const assignedReportRowSchema = z.object({
	report_id: uuidSchema,
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
	updated_at: z.string(),
	audit_entries: z.unknown()
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
const moderatorMessageRowSchema = z.object({
	id: uuidSchema,
	conversation_id: uuidSchema,
	sender_id: uuidSchema,
	body: z.string().max(4000),
	reply_to_id: uuidSchema.nullable(),
	created_at: z.string(),
	edited_at: z.string().nullable(),
	deleted_at: z.string().nullable()
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

type QueueReportRow = z.infer<typeof queueReportRowSchema>;
type AssignedReportRow = z.infer<typeof assignedReportRowSchema>;

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
	preview: ModerationCaseDto | null;
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
	return [
		'listing',
		'profile',
		'review',
		'profile_comment',
		'deal',
		'conversation',
		'message'
	].includes(targetType);
}

function targetTypeLabel(targetType: ReportTargetType): string {
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
	return labels[targetType];
}

function genericTargetTitle(report: Pick<AssignedReportRow, 'target_type' | 'target_id'>): string {
	return `${targetTypeLabel(report.target_type)} ${report.target_id.slice(0, 8)}`;
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
	const { data: queueData, error: queueError } = await client.rpc(
		'list_moderation_report_queue',
		{ p_page_size: 50, p_page_offset: 0 }
	);
	if (queueError) throw workflowErrorFromDatabase(queueError);
	const reports = parseRows(queueData, queueReportRowSchema);

	const summary = (report: QueueReportRow): ModerationCaseDto => {
		const assignedToViewer = report.assignment_state === 'assigned_to_you';
		const supported = supportsDecision(report.target_type);
		return {
			id: report.report_id,
			reference: shortReference(report.report_id),
			reason: reasonLabel(report.reason_code),
			targetType: report.target_type,
			targetTitle: targetTypeLabel(report.target_type),
			reporter: 'Скрит до поемане',
			risk: reportRisk(report.reason_code),
			createdAt: report.created_at,
			evidenceCount: 0,
			status: report.status,
			assignedTo: assignedToViewer ? viewer.id : null,
			isAssignedToViewer: assignedToViewer,
			canClaim: report.status === 'open' && report.assignment_state === 'unassigned',
			canDecide: supported && report.status === 'investigating' && assignedToViewer,
			supported
		};
	};

	const cases = reports.map(summary);
	const previewQueue = requestedCaseId
		? reports.find((report) => report.report_id === requestedCaseId) ?? null
		: reports[0] ?? null;
	const preview = previewQueue ? summary(previewQueue) : null;
	const selectedQueue =
		previewQueue?.assignment_state === 'assigned_to_you' ? previewQueue : null;
	if (!selectedQueue) {
		const merchantApplications = await merchantApplicationsPromise;
		return {
			cases,
			preview,
			selected: null,
			audit: [],
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

	const { data: privateData, error: privateError } = await client.rpc(
		'get_assigned_moderation_case',
		{ p_report_id: selectedQueue.report_id }
	);
	if (privateError) throw workflowErrorFromDatabase(privateError);
	const privateRows = parseRows(privateData, assignedReportRowSchema);
	if (privateRows.length !== 1) {
		throw new ModerationWorkflowError('UNAVAILABLE', 'Модерационният случай не беше зареден безопасно.');
	}
	const report = privateRows[0];
	if (
		report.report_id !== selectedQueue.report_id ||
		report.assigned_to !== viewer.id ||
		report.status !== 'investigating'
	) {
		throw new ModerationWorkflowError('FORBIDDEN', 'Операцията не е разрешена.');
	}

	const auditRows = parseRows(report.audit_entries, auditRowSchema);
	const profileIds = [
		report.reporter_id,
		...(report.target_type === 'profile' ? [report.target_id] : []),
		...auditRows.map((entry) => entry.actor_id)
	];
	const [profiles, listingResult, evidence, merchantApplications] = await Promise.all([
		queryProfiles(client, profileIds),
		report.target_type === 'listing'
			? client.from('listings').select('id, title, status').eq('id', report.target_id).limit(1)
			: Promise.resolve({ data: [], error: null }),
		signedEvidence(client, evidencePaths(report.evidence_paths)),
		merchantApplicationsPromise
	]);
	if (listingResult.error) throw workflowErrorFromDatabase(listingResult.error);
	const listing = parseRows(listingResult.data, listingRowSchema)[0];
	const selectedSummary = summary(selectedQueue);
	const targetTitle =
		report.target_type === 'listing'
			? (listing?.title ?? genericTargetTitle(report))
			: report.target_type === 'profile'
				? `@${profiles.get(report.target_id) ?? report.target_id.slice(0, 8)}`
				: genericTargetTitle(report);

	return {
		cases,
		preview: selectedSummary,
		selected: {
			...selectedSummary,
			targetTitle,
			reporter: profiles.get(report.reporter_id) ?? 'неизвестен профил',
			evidenceCount: evidencePaths(report.evidence_paths).length,
			assignedTo: report.assigned_to,
			isAssignedToViewer: true,
			canClaim: false,
			canDecide: supportsDecision(report.target_type),
			details: report.details,
			targetStatus: report.target_type === 'listing' ? (listing?.status ?? 'unknown') : report.target_type,
			evidence
		},
		audit: auditRows.map((entry) => ({
			id: String(entry.id),
			action: auditLabel(entry.action),
			rationale: entry.rationale,
			actor: profiles.get(entry.actor_id) ?? 'staff',
			createdAt: entry.created_at
		})),
		merchantApplications,
		stats: {
			open: reports.filter((item) => item.status === 'open').length,
			investigating: reports.filter((item) => item.status === 'investigating').length,
			highRisk: reports.filter((item) => reportRisk(item.reason_code) === 'high').length,
			total: reports.length,
			merchantPending: merchantApplications.length
		}
	};
}
export async function assignReportCase(
	client: SupabaseClient,
	_actorId: string,
	rawInput: unknown
): Promise<{ caseId: string; status: 'investigating' }> {
	const parsed = assignInputSchema.safeParse(rawInput);
	if (!parsed.success) throw new ModerationWorkflowError('VALIDATION', 'Невалиден номер на сигнал.');

	const { data, error } = await client.rpc('claim_moderation_report', {
		p_report_id: parsed.data.caseId
	});
	if (error) throw workflowErrorFromDatabase(error);
	const result = z.enum(['claimed', 'already_claimed_by_you', 'unavailable']).safeParse(data);
	if (!result.success) {
		throw new ModerationWorkflowError('UNAVAILABLE', 'Сигналът не беше присвоен безопасно.');
	}
	if (result.data === 'unavailable') {
		throw new ModerationWorkflowError('CONFLICT', 'Сигналът вече е поет или е променен.');
	}
	return { caseId: parsed.data.caseId, status: 'investigating' };
}

const listingDecisionMapping: Record<
	Extract<ModerationDecision, 'keep' | 'hide' | 'remove'>,
	{ listingStatus: 'active' | 'paused' | 'removed' }
> = {
	keep: { listingStatus: 'active' },
	hide: { listingStatus: 'paused' },
	remove: { listingStatus: 'removed' }
};

export async function inspectModerationConversation(
	client: SupabaseClient,
	rawInput: unknown
): Promise<{
	caseId: string;
	messages: readonly {
		id: string;
		conversationId: string;
		senderId: string;
		body: string | null;
		createdAt: string;
	}[];
}> {
	const parsed = assignInputSchema.safeParse(rawInput);
	if (!parsed.success) throw new ModerationWorkflowError('VALIDATION', 'Невалиден номер на сигнал.');
	const { data, error } = await client.rpc('moderator_read_messages', {
		report_case_id: parsed.data.caseId,
		page_size: 50
	});
	if (error) throw workflowErrorFromDatabase(error);
	const rows = parseRows(data, moderatorMessageRowSchema);
	return {
		caseId: parsed.data.caseId,
		messages: rows.map((row) => ({
			id: row.id,
			conversationId: row.conversation_id,
			senderId: row.sender_id,
			body: row.deleted_at ? null : row.body,
			createdAt: row.created_at
		}))
	};
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

	const { data: caseData, error: caseError } = await client.rpc(
		'get_assigned_moderation_case',
		{ p_report_id: parsed.data.caseId }
	);
	if (caseError) throw workflowErrorFromDatabase(caseError);
	const caseRows = parseRows(caseData, assignedReportRowSchema);
	if (caseRows.length !== 1) throw new ModerationWorkflowError('NOT_FOUND', 'Сигналът не е намерен.');
	const report = caseRows[0];
	if (report.status !== 'investigating') {
		throw new ModerationWorkflowError('CONFLICT', 'Сигналът не е в активно разследване.');
	}
	if (report.assigned_to !== actor.id) {
		throw new ModerationWorkflowError('FORBIDDEN', 'Сигналът е присвоен на друг модератор.');
	}

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
				report_case_id: report.report_id,
				target_listing_id: report.target_id,
				moderation_rationale: parsed.data.rationale,
				corrected_audience: null,
				corrected_segments: null,
				moderated_status: decision.listingStatus
			};
			break;
		}
		case 'profile': {
			if (!['suspend', 'restore'].includes(parsed.data.decision)) {
				throw new ModerationWorkflowError('VALIDATION', 'Невалидно решение за профил.');
			}
			rpcName = 'moderate_profile';
			rpcArguments = {
				report_case_id: report.report_id,
				target_profile_id: report.target_id,
				suspend_profile: parsed.data.decision === 'suspend',
				moderation_rationale: parsed.data.rationale
			};
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
				report_case_id: report.report_id,
				[report.target_type === 'review' ? 'target_review_id' : 'target_comment_id']:
					report.target_id,
				moderated_status: status,
				moderation_rationale: parsed.data.rationale
			};
			break;
		}
		case 'deal': {
			if (!['resume', 'cancel'].includes(parsed.data.decision)) {
				throw new ModerationWorkflowError('VALIDATION', 'Невалидно решение за спор.');
			}
			rpcName = 'resolve_deal_dispute';
			rpcArguments = {
				report_case_id: report.report_id,
				target_deal_id: report.target_id,
				resolution_status:
					parsed.data.decision === 'resume' ? 'pending_confirmation' : 'cancelled',
				rationale: parsed.data.rationale
			};
			break;
		}
		case 'message':
		case 'conversation': {
			if (!['keep', 'hide', 'remove'].includes(parsed.data.decision)) {
				throw new ModerationWorkflowError('VALIDATION', 'Невалидно решение за разговор.');
			}
			rpcName = 'resolve_conversation_report';
			rpcArguments = {
				report_case_id: report.report_id,
				decision:
					report.target_type === 'message'
						? parsed.data.decision === 'keep' ? 'keep' : 'remove'
						: parsed.data.decision === 'keep' ? 'keep' : 'block',
				moderation_rationale: parsed.data.rationale
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

	return { caseId: report.report_id, status: 'resolved', decision: parsed.data.decision };
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
