/**
 * Hand-written Supabase shape kept close to the SQL migrations.
 *
 * Replace this file with `supabase gen types typescript` when a linked project is available.
 * Application/UI modules must consume DTOs from `$lib/contracts`, never these row types.
 */
export type Json =
	| string
	| number
	| boolean
	| null
	| { readonly [key: string]: Json | undefined }
	| readonly Json[];

type AccountKind = 'private' | 'merchant';
type PlatformRole = 'user' | 'moderator' | 'admin';
type MerchantApplicationStatus =
	| 'draft'
	| 'submitted'
	| 'under_review'
	| 'approved'
	| 'rejected'
	| 'withdrawn';
type BrandStatus = 'canonical' | 'pending_canonicalization' | 'merged' | 'rejected';
type BrandAliasKind =
	| 'alternate'
	| 'common_misspelling'
	| 'transliteration'
	| 'previous_name'
	| 'product_line'
	| 'acronym'
	| 'other';
type BrandCollection = 'men' | 'women' | 'unisex' | 'niche' | 'arabic';
type Audience = 'men' | 'women' | 'unisex';
type Segment = 'niche' | 'arabic';
type ListingKind = 'offer' | 'wanted';
type DealMode = 'sale' | 'swap' | 'sale_or_swap';
type ProductFormat = 'retail_bottle' | 'tester' | 'official_sample';
type Concentration = 'EDT' | 'EDP' | 'PARFUM' | 'EXTRAIT' | 'EDC' | 'OTHER_NOT_STATED';
type ListingStatus =
	| 'draft'
	| 'active'
	| 'reserved'
	| 'paused'
	| 'completed'
	| 'expired'
	| 'rejected'
	| 'removed';
type PhotoRole =
	| 'product_full'
	| 'bottle_bottom'
	| 'batch_code'
	| 'fill_level'
	| 'box_front'
	| 'box_bottom'
	| 'seal'
	| 'manufacturer_label'
	| 'manufacturer_markings'
	| 'other';
type OfferKind = 'cash' | 'swap' | 'cash_plus_swap';
type OfferStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
type ConversationStatus = 'open' | 'archived' | 'blocked';
type DealStatus = 'pending_confirmation' | 'completed' | 'disputed' | 'cancelled';
type ReviewStatus = 'published' | 'hidden' | 'removed';
type AuthenticityReviewStatus =
	| 'pending'
	| 'evidence_reviewed'
	| 'insufficient_evidence'
	| 'rejected';
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
type ReportStatus = 'open' | 'investigating' | 'resolved' | 'dismissed';
type NotificationKind =
	| 'offer_received'
	| 'offer_accepted'
	| 'offer_declined'
	| 'message_received'
	| 'deal_confirmation_needed'
	| 'deal_completed'
	| 'review_received'
	| 'listing_expiring'
	| 'listing_expired'
	| 'report_updated'
	| 'merchant_application_updated'
	| 'payment_updated';
type NotificationStatus = 'unread' | 'read' | 'archived';
type UploadQuarantineStatus = 'pending' | 'processing' | 'finalized' | 'rejected' | 'expired';
type BetaInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
type BetaMembershipStatus = 'pending' | 'active' | 'suspended' | 'revoked' | 'expired';

type Table<Row, Insert, Update = Partial<Insert>> = {
	Row: Row;
	Insert: Insert;
	Update: Update;
	Relationships: [];
};

type ProfileRow = {
	id: string;
	username: string;
	city: string | null;
	bio: string | null;
	avatar_path: string | null;
	account_kind: AccountKind;
	role: PlatformRole;
	email_verified_at: string | null;
	phone_verified_at: string | null;
	merchant_verified_at: string | null;
	is_suspended: boolean;
	rating_average: number;
	rating_count: number;
	completed_deals_count: number;
	created_at: string;
	updated_at: string;
	last_seen_at: string | null;
};

type BrandRow = {
	id: string;
	canonical_name: string;
	slug: string;
	status: BrandStatus;
	normalized_key: string;
	submitted_display_name: string | null;
	parent_brand_id: string | null;
	suggested_brand_id: string | null;
	merged_into_brand_id: string | null;
	provenance: Json;
	created_by: string | null;
	canonicalized_by: string | null;
	canonicalized_at: string | null;
	created_at: string;
	updated_at: string;
};

type FragranceRow = {
	id: string;
	brand_id: string;
	slug: string;
	name: string;
	normalized_name: string;
	audience: Audience;
	segments: Segment[];
	concentration: Concentration | null;
	concentration_label: string | null;
	fragrantica_url: string | null;
	is_active: boolean;
	created_by: string | null;
	created_at: string;
	updated_at: string;
};

type ListingRow = {
	id: string;
	slug: string;
	seller_id: string;
	kind: ListingKind;
	deal_mode: DealMode;
	product_format: ProductFormat | null;
	audience: Audience;
	segments: Segment[];
	brand_id: string;
	fragrance_id: string | null;
	fragrance_name: string;
	brand_input_text: string | null;
	brand_normalized_key: string | null;
	suggested_brand_id: string | null;
	catalog_provenance: Json;
	concentration: Concentration;
	concentration_label: string | null;
	fragrantica_url: string | null;
	title: string;
	description: string;
	city: string;
	bottle_volume_ml: number | null;
	remaining_ml: number | null;
	is_sealed: boolean;
	price_minor: number | null;
	estimated_value_minor: number | null;
	max_budget_minor: number | null;
	status: ListingStatus;
	activated_at: string | null;
	expires_at: string | null;
	completed_at: string | null;
	created_at: string;
	updated_at: string;
};

type ListingPhotoRow = {
	id: string;
	listing_id: string;
	storage_path: string;
	role: PhotoRole;
	sort_order: number;
	content_hash: string | null;
	mime_type: string | null;
	byte_size: number | null;
	width_px: number | null;
	height_px: number | null;
	sanitized_at: string | null;
	source_upload_id: string | null;
	created_at: string;
};

type UploadQuarantineRow = {
	id: string;
	uploader_id: string;
	listing_id: string;
	requested_role: PhotoRole;
	bucket_id: 'listing-image-quarantine';
	quarantine_path: string;
	declared_mime_type: string;
	declared_byte_size: number;
	status: UploadQuarantineStatus;
	processor_request_id: string | null;
	final_storage_path: string | null;
	rejection_code: string | null;
	created_at: string;
	expires_at: string;
	claimed_at: string | null;
	finalized_at: string | null;
	rejected_at: string | null;
};

type OfferRow = {
	id: string;
	listing_id: string;
	offerer_id: string;
	kind: OfferKind;
	cash_amount_minor: number | null;
	offered_listing_id: string | null;
	message: string | null;
	status: OfferStatus;
	expires_at: string | null;
	responded_at: string | null;
	created_at: string;
	updated_at: string;
};

type DealRow = {
	id: string;
	listing_id: string;
	offered_listing_id: string | null;
	accepted_offer_id: string;
	party_a_id: string;
	party_b_id: string;
	status: DealStatus;
	completed_at: string | null;
	disputed_at: string | null;
	cancelled_at: string | null;
	cancelled_by: string | null;
	cancellation_reason: string | null;
	created_at: string;
	updated_at: string;
};

export type Database = {
	public: {
		Tables: {
			beta_invites: Table<
				{
					id: string;
					email: string;
					token_hash: string;
					status: BetaInviteStatus;
					created_by: string | null;
					accepted_by: string | null;
					expires_at: string;
					accepted_at: string | null;
					revoked_at: string | null;
					created_at: string;
				},
				{
					id?: string;
					email: string;
					token_hash: string;
					status?: BetaInviteStatus;
					created_by?: string | null;
					accepted_by?: string | null;
					expires_at: string;
					accepted_at?: string | null;
					revoked_at?: string | null;
					created_at?: string;
				}
			>;
			beta_memberships: Table<
				{
					profile_id: string;
					invite_id: string;
					status: BetaMembershipStatus;
					onboarding_completed_at: string | null;
					activated_at: string | null;
					expires_at: string | null;
					ended_at: string | null;
					created_at: string;
					updated_at: string;
				},
				{
					profile_id: string;
					invite_id: string;
					status?: BetaMembershipStatus;
					onboarding_completed_at?: string | null;
					activated_at?: string | null;
					expires_at?: string | null;
					ended_at?: string | null;
					created_at?: string;
					updated_at?: string;
				}
			>;
			beta_legal_documents: Table<
				{
					document_code: string;
					document_version: string;
					required_for_access: boolean;
					effective_at: string;
					retired_at: string | null;
					created_at: string;
				},
				{
					document_code: string;
					document_version: string;
					required_for_access?: boolean;
					effective_at?: string;
					retired_at?: string | null;
					created_at?: string;
				}
			>;
			profiles: Table<
				ProfileRow,
				Pick<ProfileRow, 'id' | 'username'> & Partial<Omit<ProfileRow, 'id' | 'username'>>
			>;
			merchant_applications: Table<
				{
					id: string;
					applicant_id: string;
					status: MerchantApplicationStatus;
					legal_name: string;
					registration_number: string;
					registered_address: string;
					website_url: string | null;
					document_paths: Json;
					declaration_accepted_at: string | null;
					reviewer_id: string | null;
					reviewer_notes: string | null;
					submitted_at: string | null;
					reviewed_at: string | null;
					created_at: string;
					updated_at: string;
				},
				{
					id?: string;
					applicant_id: string;
					status?: MerchantApplicationStatus;
					legal_name: string;
					registration_number: string;
					registered_address: string;
					website_url?: string | null;
					document_paths?: Json;
					declaration_accepted_at?: string | null;
					reviewer_id?: string | null;
					reviewer_notes?: string | null;
					submitted_at?: string | null;
					reviewed_at?: string | null;
					created_at?: string;
					updated_at?: string;
				}
			>;
			brands: Table<
				BrandRow,
				Pick<BrandRow, 'canonical_name' | 'slug' | 'normalized_key'> &
					Partial<Omit<BrandRow, 'canonical_name' | 'slug' | 'normalized_key'>>
			>;
			brand_aliases: Table<
				{
					id: string;
					brand_id: string;
					kind: BrandAliasKind;
					alias: string;
					normalized_alias: string;
					created_by: string | null;
					created_at: string;
				},
				{
					id?: string;
					brand_id: string;
					kind?: BrandAliasKind;
					alias: string;
					normalized_alias: string;
					created_by?: string | null;
					created_at?: string;
				}
			>;
			brand_collection_memberships: Table<
				{ brand_id: string; collection: BrandCollection; display_order: number; reviewed_at: string },
				{ brand_id: string; collection: BrandCollection; display_order: number; reviewed_at?: string }
			>;
			fragrances: Table<
				FragranceRow,
				Pick<FragranceRow, 'brand_id' | 'name' | 'normalized_name' | 'audience'> &
					Partial<Omit<FragranceRow, 'brand_id' | 'name' | 'normalized_name' | 'audience'>>
			>;
			listings: Table<
				ListingRow,
				Pick<
					ListingRow,
					| 'seller_id'
					| 'kind'
					| 'deal_mode'
					| 'audience'
					| 'brand_id'
					| 'fragrance_name'
					| 'concentration'
					| 'title'
					| 'city'
				> &
					Partial<
						Omit<
							ListingRow,
							| 'seller_id'
							| 'kind'
							| 'deal_mode'
							| 'audience'
							| 'brand_id'
							| 'fragrance_name'
							| 'concentration'
							| 'title'
							| 'city'
						>
					>
			>;
			listing_photos: Table<
				ListingPhotoRow,
				Pick<ListingPhotoRow, 'listing_id' | 'storage_path' | 'role'> &
					Partial<Omit<ListingPhotoRow, 'listing_id' | 'storage_path' | 'role'>>
			>;
			upload_quarantine: Table<
				UploadQuarantineRow,
				Pick<
					UploadQuarantineRow,
					| 'uploader_id'
					| 'listing_id'
					| 'requested_role'
					| 'quarantine_path'
					| 'declared_mime_type'
					| 'declared_byte_size'
				> &
					Partial<
						Omit<
							UploadQuarantineRow,
							| 'uploader_id'
							| 'listing_id'
							| 'requested_role'
							| 'quarantine_path'
							| 'declared_mime_type'
							| 'declared_byte_size'
						>
					>
			>;
			listing_authenticity_reviews: Table<
				{
					listing_id: string;
					requested_by: string;
					status: AuthenticityReviewStatus;
					public_note: string | null;
					reviewed_at: string | null;
					created_at: string;
					updated_at: string;
				},
				{
					listing_id: string;
					requested_by: string;
					status?: AuthenticityReviewStatus;
					public_note?: string | null;
					reviewed_at?: string | null;
					created_at?: string;
					updated_at?: string;
				}
			>;
			favorites: Table<
				{ profile_id: string; listing_id: string; created_at: string },
				{ profile_id: string; listing_id: string; created_at?: string }
			>;
			saved_searches: Table<
				{
					id: string;
					profile_id: string;
					name: string;
					filters: Json;
					notifications_enabled: boolean;
					last_notified_at: string | null;
					created_at: string;
					updated_at: string;
				},
				{
					id?: string;
					profile_id: string;
					name: string;
					filters?: Json;
					notifications_enabled?: boolean;
					last_notified_at?: string | null;
					created_at?: string;
					updated_at?: string;
				}
			>;
			offers: Table<
				OfferRow,
				Pick<OfferRow, 'listing_id' | 'offerer_id' | 'kind'> &
					Partial<Omit<OfferRow, 'listing_id' | 'offerer_id' | 'kind'>>
			>;
			conversations: Table<
				{
					id: string;
					listing_id: string;
					accepted_offer_id: string;
					status: ConversationStatus;
					created_at: string;
					updated_at: string;
				},
				{
					id?: string;
					listing_id: string;
					accepted_offer_id: string;
					status?: ConversationStatus;
					created_at?: string;
					updated_at?: string;
				}
			>;
			conversation_members: Table<
				{
					conversation_id: string;
					profile_id: string;
					joined_at: string;
					last_read_at: string | null;
					muted_at: string | null;
					blocked_at: string | null;
				},
				{
					conversation_id: string;
					profile_id: string;
					joined_at?: string;
					last_read_at?: string | null;
					muted_at?: string | null;
					blocked_at?: string | null;
				}
			>;
			messages: Table<
				{
					id: string;
					conversation_id: string;
					sender_id: string;
					body: string;
					reply_to_id: string | null;
					created_at: string;
					edited_at: string | null;
					deleted_at: string | null;
				},
				{
					id?: string;
					conversation_id: string;
					sender_id: string;
					body: string;
					reply_to_id?: string | null;
					created_at?: string;
					edited_at?: string | null;
					deleted_at?: string | null;
				}
			>;
			deals: Table<
				DealRow,
				Pick<DealRow, 'listing_id' | 'accepted_offer_id' | 'party_a_id' | 'party_b_id'> &
					Partial<Omit<DealRow, 'listing_id' | 'accepted_offer_id' | 'party_a_id' | 'party_b_id'>>
			>;
			deal_confirmations: Table<
				{ deal_id: string; profile_id: string; confirmed_at: string },
				{ deal_id: string; profile_id: string; confirmed_at?: string }
			>;
			reviews: Table<
				{
					id: string;
					deal_id: string;
					reviewer_id: string;
					reviewee_id: string;
					rating: number;
					body: string | null;
					status: ReviewStatus;
					created_at: string;
					updated_at: string;
				},
				{
					id?: string;
					deal_id: string;
					reviewer_id: string;
					reviewee_id: string;
					rating: number;
					body?: string | null;
					status?: ReviewStatus;
					created_at?: string;
					updated_at?: string;
				}
			>;
			reports: Table<
				{
					id: string;
					reporter_id: string;
					target_type: ReportTargetType;
					target_id: string;
					reason_code: string;
					details: string | null;
					evidence_paths: Json;
					status: ReportStatus;
					assigned_to: string | null;
					resolution_code: string | null;
					resolution_notes: string | null;
					resolved_at: string | null;
					created_at: string;
					updated_at: string;
				},
				{
					id?: string;
					reporter_id: string;
					target_type: ReportTargetType;
					target_id: string;
					reason_code: string;
					details?: string | null;
					evidence_paths?: Json;
					status?: ReportStatus;
					assigned_to?: string | null;
					resolution_code?: string | null;
					resolution_notes?: string | null;
					resolved_at?: string | null;
					created_at?: string;
					updated_at?: string;
				}
			>;
			notifications: Table<
				{
					id: string;
					profile_id: string;
					kind: NotificationKind;
					status: NotificationStatus;
					title: string;
					body: string;
					action_url: string | null;
					data: Json;
					read_at: string | null;
					created_at: string;
				},
				{
					id?: string;
					profile_id: string;
					kind: NotificationKind;
					status?: NotificationStatus;
					title: string;
					body?: string;
					action_url?: string | null;
					data?: Json;
					read_at?: string | null;
					created_at?: string;
				}
			>;
		};
		Views: {
			public_profiles: {
				Row: {
					id: string;
					username: string;
					city: string | null;
					bio: string | null;
					avatar_path: string | null;
					account_kind: AccountKind;
					is_merchant_verified: boolean;
					rating_average: number;
					rating_count: number;
					completed_deals_count: number;
					member_since: string;
				};
				Relationships: [];
			};
		};
		Functions: {
			accept_offer: { Args: { target_offer_id: string }; Returns: string };
			accept_beta_consent: {
				Args: { requested_document_code: string; requested_document_version: string };
				Returns: string;
			};
			cancel_deal: { Args: { target_deal_id: string; reason: string }; Returns: undefined };
			cancel_listing_upload: { Args: { target_upload_id: string }; Returns: undefined };
			claim_listing_upload: {
				Args: { target_upload_id: string; processor_request_id: string };
				Returns: UploadQuarantineRow;
			};
			confirm_deal: { Args: { target_deal_id: string }; Returns: DealRow };
			complete_beta_onboarding: {
				Args: { desired_username: string; home_city?: string | null };
				Returns: Json;
			};
			create_listing_upload: {
				Args: {
					target_listing_id: string;
					requested_role: PhotoRole;
					declared_mime_type: string;
					declared_byte_size: number;
				};
				Returns: Array<{
					upload_id: string;
					bucket_id: string;
					storage_path: string;
					expires_at: string;
				}>;
			};
			decline_offer: { Args: { target_offer_id: string }; Returns: undefined };
			effective_listing_limit: { Args: { target_profile_id: string }; Returns: number };
			finalize_listing_upload: {
				Args: {
					target_upload_id: string;
					final_storage_path: string;
					actual_content_hash: string;
					actual_mime_type: string;
					actual_byte_size: number;
					actual_width_px: number;
					actual_height_px: number;
				};
				Returns: ListingPhotoRow;
			};
			open_deal_dispute: {
				Args: { target_deal_id: string; details: string };
				Returns: Array<{ deal_id: string; report_id: string }>;
			};
			get_my_beta_access: {
				Args: Record<PropertyKey, never>;
				Returns: Array<{
					profile_id: string;
					membership_status: BetaMembershipStatus | null;
					onboarding_completed_at: string | null;
					membership_expires_at: string | null;
					email_verified_at: string | null;
					phone_verified_at: string | null;
					merchant_verified_at: string | null;
					role: PlatformRole | null;
					is_suspended: boolean | null;
					username: string | null;
					account_kind: AccountKind | null;
					has_current_consents: boolean;
					is_active: boolean;
				}>;
			};
			publish_listing: { Args: { target_listing_id: string }; Returns: ListingRow };
			search_catalog: {
				Args: { search_query: string; page_size?: number };
				Returns: Array<{
					entity_type: string;
					id: string;
					brand_id: string;
					label: string;
					slug: string;
					secondary_label: string | null;
					relevance: number;
				}>;
			};
			search_listings: {
				Args: {
					search_query?: string | null;
					filter_audience?: Audience | null;
					filter_segments?: Segment[] | null;
					filter_deal_mode?: DealMode | null;
					filter_city?: string | null;
					min_price_minor?: number | null;
					max_price_minor?: number | null;
					page_size?: number;
					cursor_activated_at?: string | null;
					cursor_id?: string | null;
				};
				Returns: Array<{
					listing_id: string;
					slug: string;
					activated_at: string;
					relevance: number;
				}>;
			};
			redeem_beta_invite: {
				Args: { invite_token: string };
				Returns: Database['public']['Tables']['beta_memberships']['Row'];
			};
			reject_listing_upload: {
				Args: { target_upload_id: string; rejection_code: string };
				Returns: undefined;
			};
		};
		Enums: {
			account_kind: AccountKind;
			platform_role: PlatformRole;
			merchant_application_status: MerchantApplicationStatus;
			brand_status: BrandStatus;
			brand_alias_kind: BrandAliasKind;
			brand_collection: BrandCollection;
			audience: Audience;
			segment: Segment;
			listing_kind: ListingKind;
			deal_mode: DealMode;
			product_format: ProductFormat;
			concentration: Concentration;
			listing_status: ListingStatus;
			photo_role: PhotoRole;
			offer_kind: OfferKind;
			offer_status: OfferStatus;
			conversation_status: ConversationStatus;
			deal_status: DealStatus;
			review_status: ReviewStatus;
			authenticity_review_status: AuthenticityReviewStatus;
			report_target_type: ReportTargetType;
			report_status: ReportStatus;
			notification_kind: NotificationKind;
			notification_status: NotificationStatus;
			upload_quarantine_status: UploadQuarantineStatus;
			beta_invite_status: BetaInviteStatus;
			beta_membership_status: BetaMembershipStatus;
		};
		CompositeTypes: Record<never, never>;
	};
};

export type Tables<
	TableName extends keyof Database['public']['Tables']
> = Database['public']['Tables'][TableName]['Row'];

export type TablesInsert<
	TableName extends keyof Database['public']['Tables']
> = Database['public']['Tables'][TableName]['Insert'];

export type TablesUpdate<
	TableName extends keyof Database['public']['Tables']
> = Database['public']['Tables'][TableName]['Update'];

export type Views<
	ViewName extends keyof Database['public']['Views']
> = Database['public']['Views'][ViewName]['Row'];
