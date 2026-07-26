import type { CreateReportInput, ReportDto, ReportListInput, ReportPageDto } from '../../contracts';
import type { Json, Tables } from '../database.types';
import { pageDto, requireData, throwIfError, type MarketplaceSupabaseClient } from './shared';

type ReportRow = Tables<'reports'>;

export function toReportDto(row: ReportRow): ReportDto {
	const evidence = Array.isArray(row.evidence_paths) ? row.evidence_paths : [];
	return {
		id: row.id,
		targetType: row.target_type,
		targetId: row.target_id,
		reasonCode: row.reason_code,
		details: row.details,
		evidenceCount: evidence.length,
		status: row.status,
		resolutionCode: row.resolution_code,
		resolvedAt: row.resolved_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export async function listOwnReports(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: ReportListInput
): Promise<ReportPageDto> {
	let query = client
		.from('reports')
		.select('*', { count: 'exact' })
		.eq('reporter_id', profileId)
		.order('created_at', { ascending: false })
		.range(input.offset, input.offset + input.limit - 1);
	if (input.status) query = query.eq('status', input.status);
	const { data, error, count } = await query;
	throwIfError('reports.listOwn', error);
	return pageDto((data ?? []).map((row) => toReportDto(row as ReportRow)), count, input.limit, input.offset);
}

export async function createReport(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: CreateReportInput
): Promise<ReportDto> {
	const { data, error } = await client
		.from('reports')
		.insert({
			reporter_id: profileId,
			target_type: input.targetType,
			target_id: input.targetId,
			reason_code: input.reasonCode,
			details: input.details ?? null,
			evidence_paths: input.evidencePaths as Json,
			status: 'open'
		})
		.select('*')
		.single();
	throwIfError('reports.create', error);
	return toReportDto(requireData('reports.create', data) as ReportRow);
}

