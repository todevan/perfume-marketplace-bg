import type { CreateReportInput, ReportDto, ReportListInput, ReportPageDto } from '../../contracts';
import type { Database, Json } from '../database.types';
import { pageDto, throwIfError, type MarketplaceSupabaseClient } from './shared';

type ReportRow = Database['public']['Functions']['list_my_reports']['Returns'][number];

export function toReportDto(row: ReportRow): ReportDto {
	return {
		id: row.report_id,
		targetType: row.target_type,
		reasonCode: row.reason_code,
		evidenceCount: Number(row.evidence_count),
		status: row.status,
		outcome: row.outcome as ReportDto['outcome'],
		resolvedAt: row.resolved_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export async function listOwnReports(
	client: MarketplaceSupabaseClient,
	_profileId: string,
	input: ReportListInput
): Promise<ReportPageDto> {
	const { data, error } = await client.rpc('list_my_reports', {
		p_page_size: input.limit,
		p_page_offset: input.offset,
		p_status: input.status ?? null
	});
	throwIfError('reports.listOwn', error);
	const rows = data ?? [];
	const total = Number(rows[0]?.total_count ?? 0);
	return pageDto(rows.map((row) => toReportDto(row)), total, input.limit, input.offset);
}

export async function createReport(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: CreateReportInput
): Promise<ReportDto> {
	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	const { error } = await client
		.from('reports')
		.insert({
			id,
			reporter_id: profileId,
			target_type: input.targetType,
			target_id: input.targetId,
			reason_code: input.reasonCode,
			details: input.details ?? null,
			evidence_paths: input.evidencePaths as Json,
			status: 'open',
			created_at: createdAt,
			updated_at: createdAt
		});
	throwIfError('reports.create', error);
	return {
		id,
		targetType: input.targetType,
		reasonCode: input.reasonCode,
		evidenceCount: input.evidencePaths.length,
		status: 'open',
		outcome: 'pending',
		resolvedAt: null,
		createdAt,
		updatedAt: createdAt
	};
}

