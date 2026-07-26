import {
	createReportInputSchema,
	reportListInputSchema,
	type ActionResult,
	type ReportDto,
	type ReportPageDto
} from '../../contracts';
import {
	createReport as repoCreateReport,
	listOwnReports,
	type MarketplaceSupabaseClient
} from '../repositories';
import { runAuthenticatedAction } from './action';

export function getOwnReports(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ReportPageDto>> {
	return runAuthenticatedAction(client, reportListInputSchema, rawInput, (profileId, input) =>
		listOwnReports(client, profileId, input)
	);
}

export function submitReport(
	client: MarketplaceSupabaseClient,
	rawInput: unknown
): Promise<ActionResult<ReportDto>> {
	return runAuthenticatedAction(client, createReportInputSchema, rawInput, (profileId, input) =>
		repoCreateReport(client, profileId, input)
	);
}

