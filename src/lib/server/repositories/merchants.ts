import type {
	MerchantApplicationDto,
	MerchantApplicationInput,
	MerchantDirectoryInput,
	MerchantDirectoryPageDto
} from '../../contracts';
import type { Json, Tables, Views } from '../database.types';
import { toPublicProfileDto } from './profiles';
import { pageDto, requireData, throwIfError, type MarketplaceSupabaseClient } from './shared';

type ApplicationRow = Tables<'merchant_applications'>;
type ProfileRow = Views<'public_profiles'>;

export function toMerchantApplicationDto(row: ApplicationRow): MerchantApplicationDto {
	return {
		id: row.id,
		status: row.status,
		legalName: row.legal_name,
		registrationNumber: row.registration_number,
		registeredAddress: row.registered_address,
		websiteUrl: row.website_url,
		documentCount: Array.isArray(row.document_paths) ? row.document_paths.length : 0,
		declarationAcceptedAt: row.declaration_accepted_at,
		submittedAt: row.submitted_at,
		reviewedAt: row.reviewed_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export async function listVerifiedMerchants(
	client: MarketplaceSupabaseClient,
	input: MerchantDirectoryInput
): Promise<MerchantDirectoryPageDto> {
	let query = client
		.from('public_profiles')
		.select(
			'id,username,city,bio,avatar_path,account_kind,is_merchant_verified,rating_average,rating_count,completed_deals_count,member_since',
			{ count: 'exact' }
		)
		.eq('account_kind', 'merchant')
		.eq('is_merchant_verified', true)
		.order('rating_average', { ascending: false })
		.range(input.offset, input.offset + input.limit - 1);
	if (input.query) query = query.ilike('username', `%${input.query.replace(/[%_]/g, '')}%`);
	if (input.city) query = query.eq('city', input.city);
	const { data, error, count } = await query;
	throwIfError('merchants.directory', error);
	const items = ((data ?? []) as unknown as ProfileRow[]).map(toPublicProfileDto);
	return pageDto(items, count, input.limit, input.offset);
}

export async function findOwnMerchantApplication(
	client: MarketplaceSupabaseClient,
	profileId: string
): Promise<MerchantApplicationDto | null> {
	const { data, error } = await client
		.from('merchant_applications')
		.select('*')
		.eq('applicant_id', profileId)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	throwIfError('merchants.findOwnApplication', error);
	return data ? toMerchantApplicationDto(data as ApplicationRow) : null;
}

function applicationValues(input: MerchantApplicationInput, now: string) {
	const submitted = input.submit;
	return {
		legal_name: input.legalName,
		registration_number: input.registrationNumber,
		registered_address: input.registeredAddress,
		website_url: input.websiteUrl ?? null,
		document_paths: input.documentPaths as Json,
		status: submitted ? ('submitted' as const) : ('draft' as const),
		declaration_accepted_at: input.declarationAccepted ? now : null,
		submitted_at: submitted ? now : null
	};
}

export async function createMerchantApplication(
	client: MarketplaceSupabaseClient,
	profileId: string,
	input: MerchantApplicationInput,
	now = new Date().toISOString()
): Promise<MerchantApplicationDto> {
	const { data, error } = await client
		.from('merchant_applications')
		.insert({ applicant_id: profileId, ...applicationValues(input, now) })
		.select('*')
		.single();
	throwIfError('merchants.createApplication', error);
	return toMerchantApplicationDto(requireData('merchants.createApplication', data) as ApplicationRow);
}

export async function updateMerchantApplication(
	client: MarketplaceSupabaseClient,
	profileId: string,
	applicationId: string,
	input: MerchantApplicationInput,
	now = new Date().toISOString()
): Promise<MerchantApplicationDto> {
	const { data, error } = await client
		.from('merchant_applications')
		.update(applicationValues(input, now))
		.eq('id', applicationId)
		.eq('applicant_id', profileId)
		.in('status', ['draft', 'submitted'])
		.select('*')
		.single();
	throwIfError('merchants.updateApplication', error);
	return toMerchantApplicationDto(requireData('merchants.updateApplication', data) as ApplicationRow);
}

export async function withdrawMerchantApplication(
	client: MarketplaceSupabaseClient,
	profileId: string,
	applicationId: string
): Promise<void> {
	const { data, error } = await client
		.from('merchant_applications')
		.update({ status: 'withdrawn' })
		.eq('id', applicationId)
		.eq('applicant_id', profileId)
		.in('status', ['draft', 'submitted'])
		.select('id')
		.maybeSingle();
	throwIfError('merchants.withdrawApplication', error);
	requireData('merchants.withdrawApplication', data);
}
