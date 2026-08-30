/**
 * Generated from the hosted Frankfurt staging schema
 * (`nuhkpqjjyuygiemrxbdp`) with Supabase CLI.
 *
 * Regenerate after every applied schema migration. Application and UI modules
 * continue to consume DTOs from `$lib/contracts`, not raw database rows.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      beta_auth_events: {
        Row: {
          email_verified_at: string | null
          event_type: string
          id: number
          occurred_at: string
          phone_verified_at: string | null
          profile_id: string
        }
        Insert: {
          email_verified_at?: string | null
          event_type?: string
          id?: never
          occurred_at?: string
          phone_verified_at?: string | null
          profile_id: string
        }
        Update: {
          email_verified_at?: string | null
          event_type?: string
          id?: never
          occurred_at?: string
          phone_verified_at?: string | null
          profile_id?: string
        }
        Relationships: []
      }
      beta_consent_events: {
        Row: {
          accepted_at: string
          document_code: string
          document_version: string
          id: number
          profile_id: string
          source: string
        }
        Insert: {
          accepted_at?: string
          document_code: string
          document_version: string
          id?: never
          profile_id: string
          source?: string
        }
        Update: {
          accepted_at?: string
          document_code?: string
          document_version?: string
          id?: never
          profile_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_consent_events_document_code_document_version_fkey"
            columns: ["document_code", "document_version"]
            isOneToOne: false
            referencedRelation: "beta_legal_documents"
            referencedColumns: ["document_code", "document_version"]
          },
        ]
      }
      beta_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          revoked_at: string | null
          status: Database["public"]["Enums"]["beta_invite_status"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at: string
          id?: string
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["beta_invite_status"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["beta_invite_status"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_legal_documents: {
        Row: {
          created_at: string
          document_code: string
          document_version: string
          effective_at: string
          required_for_access: boolean
          retired_at: string | null
        }
        Insert: {
          created_at?: string
          document_code: string
          document_version: string
          effective_at?: string
          required_for_access?: boolean
          retired_at?: string | null
        }
        Update: {
          created_at?: string
          document_code?: string
          document_version?: string
          effective_at?: string
          required_for_access?: boolean
          retired_at?: string | null
        }
        Relationships: []
      }
      beta_memberships: {
        Row: {
          activated_at: string | null
          created_at: string
          ended_at: string | null
          expires_at: string | null
          invite_id: string | null
          onboarding_completed_at: string | null
          profile_id: string
          status: Database["public"]["Enums"]["beta_membership_status"]
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          ended_at?: string | null
          expires_at?: string | null
          invite_id?: string | null
          onboarding_completed_at?: string | null
          profile_id: string
          status?: Database["public"]["Enums"]["beta_membership_status"]
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          ended_at?: string | null
          expires_at?: string | null
          invite_id?: string | null
          onboarding_completed_at?: string | null
          profile_id?: string
          status?: Database["public"]["Enums"]["beta_membership_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_memberships_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: true
            referencedRelation: "beta_invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_aliases: {
        Row: {
          alias: string
          brand_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["brand_alias_kind"]
          normalized_alias: string
          provenance: Json
        }
        Insert: {
          alias: string
          brand_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["brand_alias_kind"]
          normalized_alias: string
          provenance?: Json
        }
        Update: {
          alias?: string
          brand_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["brand_alias_kind"]
          normalized_alias?: string
          provenance?: Json
        }
        Relationships: [
          {
            foreignKeyName: "brand_aliases_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_collection_memberships: {
        Row: {
          brand_id: string
          collection: Database["public"]["Enums"]["brand_collection"]
          display_order: number
          provenance: Json
          reviewed_at: string
        }
        Insert: {
          brand_id: string
          collection: Database["public"]["Enums"]["brand_collection"]
          display_order: number
          provenance?: Json
          reviewed_at?: string
        }
        Update: {
          brand_id?: string
          collection?: Database["public"]["Enums"]["brand_collection"]
          display_order?: number
          provenance?: Json
          reviewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_collection_memberships_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          canonical_name: string
          canonicalized_at: string | null
          canonicalized_by: string | null
          created_at: string
          created_by: string | null
          id: string
          merged_into_brand_id: string | null
          normalized_key: string
          parent_brand_id: string | null
          provenance: Json
          slug: string
          status: Database["public"]["Enums"]["brand_status"]
          submitted_display_name: string | null
          suggested_brand_id: string | null
          updated_at: string
        }
        Insert: {
          canonical_name: string
          canonicalized_at?: string | null
          canonicalized_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          merged_into_brand_id?: string | null
          normalized_key: string
          parent_brand_id?: string | null
          provenance?: Json
          slug: string
          status?: Database["public"]["Enums"]["brand_status"]
          submitted_display_name?: string | null
          suggested_brand_id?: string | null
          updated_at?: string
        }
        Update: {
          canonical_name?: string
          canonicalized_at?: string | null
          canonicalized_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          merged_into_brand_id?: string | null
          normalized_key?: string
          parent_brand_id?: string | null
          provenance?: Json
          slug?: string
          status?: Database["public"]["Enums"]["brand_status"]
          submitted_display_name?: string | null
          suggested_brand_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_canonicalized_by_fkey"
            columns: ["canonicalized_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_canonicalized_by_fkey"
            columns: ["canonicalized_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_merged_into_brand_id_fkey"
            columns: ["merged_into_brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_parent_brand_id_fkey"
            columns: ["parent_brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_suggested_brand_id_fkey"
            columns: ["suggested_brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_sync_runs: {
        Row: {
          actor_id: string | null
          actor_role: string
          alias_count: number
          brand_count: number
          catalog_id: string
          completed_at: string
          id: string
          membership_count: number
          payload: Json
          payload_sha256: string
          schema_version: number
          source_catalog_version: number
        }
        Insert: {
          actor_id?: string | null
          actor_role: string
          alias_count: number
          brand_count: number
          catalog_id: string
          completed_at?: string
          id?: string
          membership_count: number
          payload: Json
          payload_sha256: string
          schema_version: number
          source_catalog_version: number
        }
        Update: {
          actor_id?: string | null
          actor_role?: string
          alias_count?: number
          brand_count?: number
          catalog_id?: string
          completed_at?: string
          id?: string
          membership_count?: number
          payload?: Json
          payload_sha256?: string
          schema_version?: number
          source_catalog_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_sync_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_sync_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          blocked_at: string | null
          conversation_id: string
          joined_at: string
          last_read_at: string | null
          muted_at: string | null
          profile_id: string
        }
        Insert: {
          blocked_at?: string | null
          conversation_id: string
          joined_at?: string
          last_read_at?: string | null
          muted_at?: string | null
          profile_id: string
        }
        Update: {
          blocked_at?: string | null
          conversation_id?: string
          joined_at?: string
          last_read_at?: string | null
          muted_at?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          accepted_offer_id: string
          created_at: string
          id: string
          listing_id: string
          status: Database["public"]["Enums"]["conversation_status"]
          updated_at: string
        }
        Insert: {
          accepted_offer_id: string
          created_at?: string
          id?: string
          listing_id: string
          status?: Database["public"]["Enums"]["conversation_status"]
          updated_at?: string
        }
        Update: {
          accepted_offer_id?: string
          created_at?: string
          id?: string
          listing_id?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_accepted_offer_id_fkey"
            columns: ["accepted_offer_id"]
            isOneToOne: true
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_confirmations: {
        Row: {
          confirmed_at: string
          deal_id: string
          profile_id: string
        }
        Insert: {
          confirmed_at?: string
          deal_id: string
          profile_id: string
        }
        Update: {
          confirmed_at?: string
          deal_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_confirmations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_confirmations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_confirmations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_listing_locks: {
        Row: {
          created_at: string
          deal_id: string
          item_role: string
          listing_id: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          item_role: string
          listing_id: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          item_role?: string
          listing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_listing_locks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_listing_locks_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          accepted_offer_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          disputed_at: string | null
          id: string
          listing_id: string
          offered_listing_id: string | null
          party_a_id: string
          party_b_id: string
          status: Database["public"]["Enums"]["deal_status"]
          updated_at: string
        }
        Insert: {
          accepted_offer_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          disputed_at?: string | null
          id?: string
          listing_id: string
          offered_listing_id?: string | null
          party_a_id: string
          party_b_id: string
          status?: Database["public"]["Enums"]["deal_status"]
          updated_at?: string
        }
        Update: {
          accepted_offer_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          disputed_at?: string | null
          id?: string
          listing_id?: string
          offered_listing_id?: string | null
          party_a_id?: string
          party_b_id?: string
          status?: Database["public"]["Enums"]["deal_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_accepted_offer_id_fkey"
            columns: ["accepted_offer_id"]
            isOneToOne: true
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_offered_listing_id_fkey"
            columns: ["offered_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_party_a_id_fkey"
            columns: ["party_a_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_party_a_id_fkey"
            columns: ["party_a_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_party_b_id_fkey"
            columns: ["party_b_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_party_b_id_fkey"
            columns: ["party_b_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          kind: Database["public"]["Enums"]["entitlement_kind"]
          listing_id: string | null
          metadata: Json
          profile_id: string
          quantity: number
          revoked_at: string | null
          source_payment_id: string | null
          starts_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["entitlement_kind"]
          listing_id?: string | null
          metadata?: Json
          profile_id: string
          quantity?: number
          revoked_at?: string | null
          source_payment_id?: string | null
          starts_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["entitlement_kind"]
          listing_id?: string | null
          metadata?: Json
          profile_id?: string
          quantity?: number
          revoked_at?: string | null
          source_payment_id?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_source_payment_id_fkey"
            columns: ["source_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          listing_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          listing_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          listing_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fragrances: {
        Row: {
          audience: Database["public"]["Enums"]["audience"]
          brand_id: string
          concentration: Database["public"]["Enums"]["concentration"] | null
          concentration_label: string | null
          created_at: string
          created_by: string | null
          fragrantica_url: string | null
          id: string
          is_active: boolean
          name: string
          normalized_name: string
          segments: Database["public"]["Enums"]["segment"][]
          slug: string
          updated_at: string
        }
        Insert: {
          audience: Database["public"]["Enums"]["audience"]
          brand_id: string
          concentration?: Database["public"]["Enums"]["concentration"] | null
          concentration_label?: string | null
          created_at?: string
          created_by?: string | null
          fragrantica_url?: string | null
          id?: string
          is_active?: boolean
          name: string
          normalized_name: string
          segments?: Database["public"]["Enums"]["segment"][]
          slug: string
          updated_at?: string
        }
        Update: {
          audience?: Database["public"]["Enums"]["audience"]
          brand_id?: string
          concentration?: Database["public"]["Enums"]["concentration"] | null
          concentration_label?: string | null
          created_at?: string
          created_by?: string | null
          fragrantica_url?: string | null
          id?: string
          is_active?: boolean
          name?: string
          normalized_name?: string
          segments?: Database["public"]["Enums"]["segment"][]
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fragrances_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragrances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fragrances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_authenticity_reviews: {
        Row: {
          created_at: string
          listing_id: string
          public_note: string | null
          requested_by: string
          reviewed_at: string | null
          status: Database["public"]["Enums"]["authenticity_review_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          listing_id: string
          public_note?: string | null
          requested_by: string
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["authenticity_review_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          listing_id?: string
          public_note?: string | null
          requested_by?: string
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["authenticity_review_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_authenticity_reviews_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_authenticity_reviews_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_authenticity_reviews_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_photos: {
        Row: {
          byte_size: number | null
          content_hash: string | null
          created_at: string
          height_px: number | null
          id: string
          listing_id: string
          mime_type: string | null
          role: Database["public"]["Enums"]["photo_role"]
          sanitized_at: string | null
          sort_order: number
          source_upload_id: string | null
          storage_path: string
          width_px: number | null
        }
        Insert: {
          byte_size?: number | null
          content_hash?: string | null
          created_at?: string
          height_px?: number | null
          id?: string
          listing_id: string
          mime_type?: string | null
          role: Database["public"]["Enums"]["photo_role"]
          sanitized_at?: string | null
          sort_order?: number
          source_upload_id?: string | null
          storage_path: string
          width_px?: number | null
        }
        Update: {
          byte_size?: number | null
          content_hash?: string | null
          created_at?: string
          height_px?: number | null
          id?: string
          listing_id?: string
          mime_type?: string | null
          role?: Database["public"]["Enums"]["photo_role"]
          sanitized_at?: string | null
          sort_order?: number
          source_upload_id?: string | null
          storage_path?: string
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_photos_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_photos_source_upload_id_fkey"
            columns: ["source_upload_id"]
            isOneToOne: true
            referencedRelation: "upload_quarantine"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          activated_at: string | null
          audience: Database["public"]["Enums"]["audience"]
          bottle_volume_ml: number | null
          brand_id: string
          brand_input_text: string | null
          brand_normalized_key: string | null
          catalog_provenance: Json
          city: string
          completed_at: string | null
          concentration: Database["public"]["Enums"]["concentration"]
          concentration_label: string | null
          created_at: string
          deal_mode: Database["public"]["Enums"]["deal_mode"]
          description: string
          estimated_value_minor: number | null
          expires_at: string | null
          fragrance_id: string | null
          fragrance_name: string
          fragrantica_url: string | null
          id: string
          is_sealed: boolean
          kind: Database["public"]["Enums"]["listing_kind"]
          max_budget_minor: number | null
          price_minor: number | null
          product_format: Database["public"]["Enums"]["product_format"] | null
          remaining_ml: number | null
          segments: Database["public"]["Enums"]["segment"][]
          seller_id: string
          slug: string
          status: Database["public"]["Enums"]["listing_status"]
          suggested_brand_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          audience: Database["public"]["Enums"]["audience"]
          bottle_volume_ml?: number | null
          brand_id: string
          brand_input_text?: string | null
          brand_normalized_key?: string | null
          catalog_provenance?: Json
          city: string
          completed_at?: string | null
          concentration: Database["public"]["Enums"]["concentration"]
          concentration_label?: string | null
          created_at?: string
          deal_mode: Database["public"]["Enums"]["deal_mode"]
          description?: string
          estimated_value_minor?: number | null
          expires_at?: string | null
          fragrance_id?: string | null
          fragrance_name: string
          fragrantica_url?: string | null
          id?: string
          is_sealed?: boolean
          kind: Database["public"]["Enums"]["listing_kind"]
          max_budget_minor?: number | null
          price_minor?: number | null
          product_format?: Database["public"]["Enums"]["product_format"] | null
          remaining_ml?: number | null
          segments?: Database["public"]["Enums"]["segment"][]
          seller_id: string
          slug: string
          status?: Database["public"]["Enums"]["listing_status"]
          suggested_brand_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          audience?: Database["public"]["Enums"]["audience"]
          bottle_volume_ml?: number | null
          brand_id?: string
          brand_input_text?: string | null
          brand_normalized_key?: string | null
          catalog_provenance?: Json
          city?: string
          completed_at?: string | null
          concentration?: Database["public"]["Enums"]["concentration"]
          concentration_label?: string | null
          created_at?: string
          deal_mode?: Database["public"]["Enums"]["deal_mode"]
          description?: string
          estimated_value_minor?: number | null
          expires_at?: string | null
          fragrance_id?: string | null
          fragrance_name?: string
          fragrantica_url?: string | null
          id?: string
          is_sealed?: boolean
          kind?: Database["public"]["Enums"]["listing_kind"]
          max_budget_minor?: number | null
          price_minor?: number | null
          product_format?: Database["public"]["Enums"]["product_format"] | null
          remaining_ml?: number | null
          segments?: Database["public"]["Enums"]["segment"][]
          seller_id?: string
          slug?: string
          status?: Database["public"]["Enums"]["listing_status"]
          suggested_brand_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_fragrance_id_fkey"
            columns: ["fragrance_id"]
            isOneToOne: false
            referencedRelation: "fragrances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_suggested_brand_id_fkey"
            columns: ["suggested_brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_applications: {
        Row: {
          applicant_id: string
          created_at: string
          declaration_accepted_at: string | null
          document_paths: Json
          id: string
          legal_name: string
          registered_address: string
          registration_number: string
          reviewed_at: string | null
          reviewer_id: string | null
          reviewer_notes: string | null
          status: Database["public"]["Enums"]["merchant_application_status"]
          submitted_at: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          applicant_id: string
          created_at?: string
          declaration_accepted_at?: string | null
          document_paths?: Json
          id?: string
          legal_name: string
          registered_address: string
          registration_number: string
          reviewed_at?: string | null
          reviewer_id?: string | null
          reviewer_notes?: string | null
          status?: Database["public"]["Enums"]["merchant_application_status"]
          submitted_at?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          applicant_id?: string
          created_at?: string
          declaration_accepted_at?: string | null
          document_paths?: Json
          id?: string
          legal_name?: string
          registered_address?: string
          registration_number?: string
          reviewed_at?: string | null
          reviewer_id?: string | null
          reviewer_notes?: string | null
          status?: Database["public"]["Enums"]["merchant_application_status"]
          submitted_at?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merchant_applications_applicant_id_fkey"
            columns: ["applicant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_applications_applicant_id_fkey"
            columns: ["applicant_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_applications_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_applications_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          reply_to_id: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          reply_to_id?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          reply_to_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_audit: {
        Row: {
          action: Database["public"]["Enums"]["moderation_action"]
          actor_id: string
          after_data: Json | null
          before_data: Json | null
          created_at: string
          id: number
          rationale: string
          report_id: string | null
          target_id: string
          target_type: Database["public"]["Enums"]["report_target_type"]
        }
        Insert: {
          action: Database["public"]["Enums"]["moderation_action"]
          actor_id: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: never
          rationale: string
          report_id?: string | null
          target_id: string
          target_type: Database["public"]["Enums"]["report_target_type"]
        }
        Update: {
          action?: Database["public"]["Enums"]["moderation_action"]
          actor_id?: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: never
          rationale?: string
          report_id?: string | null
          target_id?: string
          target_type?: Database["public"]["Enums"]["report_target_type"]
        }
        Relationships: [
          {
            foreignKeyName: "moderation_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_audit_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_email_deliveries: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          failed_at: string | null
          last_attempt_at: string | null
          last_error_code: string | null
          notification_id: string
          provider_message_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_email_delivery_status"]
          updated_at: string
          worker_request_id: string | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          failed_at?: string | null
          last_attempt_at?: string | null
          last_error_code?: string | null
          notification_id: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_email_delivery_status"]
          updated_at?: string
          worker_request_id?: string | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          failed_at?: string | null
          last_attempt_at?: string | null
          last_error_code?: string | null
          notification_id?: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_email_delivery_status"]
          updated_at?: string
          worker_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_email_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: true
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string
          created_at: string
          data: Json
          dedupe_key: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          profile_id: string
          read_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          title: string
        }
        Insert: {
          action_url?: string | null
          body?: string
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          profile_id: string
          read_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          title: string
        }
        Update: {
          action_url?: string | null
          body?: string
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          profile_id?: string
          read_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          cash_amount_minor: number | null
          created_at: string
          expires_at: string | null
          id: string
          kind: Database["public"]["Enums"]["offer_kind"]
          listing_id: string
          message: string | null
          offered_listing_id: string | null
          offerer_id: string
          responded_at: string | null
          status: Database["public"]["Enums"]["offer_status"]
          updated_at: string
        }
        Insert: {
          cash_amount_minor?: number | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["offer_kind"]
          listing_id: string
          message?: string | null
          offered_listing_id?: string | null
          offerer_id: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["offer_status"]
          updated_at?: string
        }
        Update: {
          cash_amount_minor?: number | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["offer_kind"]
          listing_id?: string
          message?: string | null
          offered_listing_id?: string | null
          offerer_id?: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["offer_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_offered_listing_id_fkey"
            columns: ["offered_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_offerer_id_fkey"
            columns: ["offerer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_offerer_id_fkey"
            columns: ["offerer_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          event_type: string
          external_event_id: string
          external_payment_id: string | null
          id: number
          payload: Json
          payment_id: string | null
          processing_result: string
          provider: Database["public"]["Enums"]["payment_provider"]
          received_at: string
          signature_verified: boolean
        }
        Insert: {
          event_type: string
          external_event_id: string
          external_payment_id?: string | null
          id?: never
          payload?: Json
          payment_id?: string | null
          processing_result: string
          provider: Database["public"]["Enums"]["payment_provider"]
          received_at?: string
          signature_verified: boolean
        }
        Update: {
          event_type?: string
          external_event_id?: string
          external_payment_id?: string | null
          id?: never
          payload?: Json
          payment_id?: string | null
          processing_result?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          received_at?: string
          signature_verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_refunds: {
        Row: {
          amount_minor: number
          completed_at: string | null
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          metadata: Json
          payment_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_refund_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_minor: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          idempotency_key: string
          metadata?: Json
          payment_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_refund_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string
          metadata?: Json
          payment_id?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_refund_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_minor: number
          created_at: string
          currency: string
          external_event_id: string | null
          external_payment_id: string | null
          id: string
          idempotency_key: string
          metadata: Json
          paid_at: string | null
          profile_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          purpose: Database["public"]["Enums"]["payment_purpose"]
          refunded_at: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency?: string
          external_event_id?: string | null
          external_payment_id?: string | null
          id?: string
          idempotency_key: string
          metadata?: Json
          paid_at?: string | null
          profile_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          purpose: Database["public"]["Enums"]["payment_purpose"]
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: string
          external_event_id?: string | null
          external_payment_id?: string | null
          id?: string
          idempotency_key?: string
          metadata?: Json
          paid_at?: string | null
          profile_id?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          purpose?: Database["public"]["Enums"]["payment_purpose"]
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          profile_id: string
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          profile_id: string
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          profile_id?: string
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_comments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_comments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_kind: Database["public"]["Enums"]["account_kind"]
          avatar_path: string | null
          bio: string | null
          city: string | null
          completed_deals_count: number
          created_at: string
          email_verified_at: string | null
          id: string
          is_suspended: boolean
          last_seen_at: string | null
          merchant_verified_at: string | null
          phone_verified_at: string | null
          rating_average: number
          rating_count: number
          role: Database["public"]["Enums"]["platform_role"]
          updated_at: string
          username: string
        }
        Insert: {
          account_kind?: Database["public"]["Enums"]["account_kind"]
          avatar_path?: string | null
          bio?: string | null
          city?: string | null
          completed_deals_count?: number
          created_at?: string
          email_verified_at?: string | null
          id: string
          is_suspended?: boolean
          last_seen_at?: string | null
          merchant_verified_at?: string | null
          phone_verified_at?: string | null
          rating_average?: number
          rating_count?: number
          role?: Database["public"]["Enums"]["platform_role"]
          updated_at?: string
          username: string
        }
        Update: {
          account_kind?: Database["public"]["Enums"]["account_kind"]
          avatar_path?: string | null
          bio?: string | null
          city?: string | null
          completed_deals_count?: number
          created_at?: string
          email_verified_at?: string | null
          id?: string
          is_suspended?: boolean
          last_seen_at?: string | null
          merchant_verified_at?: string | null
          phone_verified_at?: string | null
          rating_average?: number
          rating_count?: number
          role?: Database["public"]["Enums"]["platform_role"]
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      report_evidence_uploads: {
        Row: {
          actual_byte_size: number | null
          actual_content_hash: string | null
          actual_mime_type: string | null
          attached_at: string | null
          bucket_id: string
          created_at: string
          expires_at: string
          finalized_at: string | null
          height_px: number | null
          id: string
          rejection_code: string | null
          report_id: string | null
          source_byte_size: number
          source_mime_type: string
          status: Database["public"]["Enums"]["report_evidence_upload_status"]
          storage_path: string
          updated_at: string
          uploader_id: string
          width_px: number | null
        }
        Insert: {
          actual_byte_size?: number | null
          actual_content_hash?: string | null
          actual_mime_type?: string | null
          attached_at?: string | null
          bucket_id?: string
          created_at?: string
          expires_at?: string
          finalized_at?: string | null
          height_px?: number | null
          id: string
          rejection_code?: string | null
          report_id?: string | null
          source_byte_size: number
          source_mime_type: string
          status?: Database["public"]["Enums"]["report_evidence_upload_status"]
          storage_path: string
          updated_at?: string
          uploader_id: string
          width_px?: number | null
        }
        Update: {
          actual_byte_size?: number | null
          actual_content_hash?: string | null
          actual_mime_type?: string | null
          attached_at?: string | null
          bucket_id?: string
          created_at?: string
          expires_at?: string
          finalized_at?: string | null
          height_px?: number | null
          id?: string
          rejection_code?: string | null
          report_id?: string | null
          source_byte_size?: number
          source_mime_type?: string
          status?: Database["public"]["Enums"]["report_evidence_upload_status"]
          storage_path?: string
          updated_at?: string
          uploader_id?: string
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "report_evidence_uploads_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_evidence_uploads_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_evidence_uploads_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          assigned_to: string | null
          created_at: string
          details: string | null
          evidence_paths: Json
          id: string
          reason_code: string
          reporter_id: string
          resolution_code: string | null
          resolution_notes: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target_type"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          details?: string | null
          evidence_paths?: Json
          id?: string
          reason_code: string
          reporter_id: string
          resolution_code?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target_type"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          details?: string | null
          evidence_paths?: Json
          id?: string
          reason_code?: string
          reporter_id?: string
          resolution_code?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_id?: string
          target_type?: Database["public"]["Enums"]["report_target_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          body: string | null
          created_at: string
          deal_id: string
          id: string
          rating: number
          reviewee_id: string
          reviewer_id: string
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          deal_id: string
          id?: string
          rating: number
          reviewee_id: string
          reviewer_id: string
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          rating?: number
          reviewee_id?: string
          reviewer_id?: string
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewee_id_fkey"
            columns: ["reviewee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewee_id_fkey"
            columns: ["reviewee_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_searches: {
        Row: {
          created_at: string
          filters: Json
          id: string
          last_notified_at: string | null
          name: string
          notifications_enabled: boolean
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          last_notified_at?: string | null
          name: string
          notifications_enabled?: boolean
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          last_notified_at?: string | null
          name?: string
          notifications_enabled?: boolean
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_searches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_searches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_cleanup_queue: {
        Row: {
          attempts: number
          bucket_id: string
          claimed_at: string | null
          created_at: string
          dead_lettered_at: string | null
          id: number
          next_attempt_at: string
          processed_at: string | null
          processing_error: string | null
          reason: string
          report_evidence_upload_id: string | null
          storage_path: string
          upload_id: string | null
          worker_request_id: string | null
        }
        Insert: {
          attempts?: number
          bucket_id: string
          claimed_at?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          id?: never
          next_attempt_at?: string
          processed_at?: string | null
          processing_error?: string | null
          reason: string
          report_evidence_upload_id?: string | null
          storage_path: string
          upload_id?: string | null
          worker_request_id?: string | null
        }
        Update: {
          attempts?: number
          bucket_id?: string
          claimed_at?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          id?: never
          next_attempt_at?: string
          processed_at?: string | null
          processing_error?: string | null
          reason?: string
          report_evidence_upload_id?: string | null
          storage_path?: string
          upload_id?: string | null
          worker_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "upload_cleanup_queue_report_evidence_upload_id_fkey"
            columns: ["report_evidence_upload_id"]
            isOneToOne: false
            referencedRelation: "report_evidence_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_cleanup_queue_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "upload_quarantine"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_quarantine: {
        Row: {
          bucket_id: string
          claimed_at: string | null
          created_at: string
          declared_byte_size: number
          declared_mime_type: string
          expires_at: string
          final_storage_path: string | null
          finalized_at: string | null
          id: string
          listing_id: string
          processor_request_id: string | null
          quarantine_path: string
          rejected_at: string | null
          rejection_code: string | null
          requested_role: Database["public"]["Enums"]["photo_role"]
          status: Database["public"]["Enums"]["upload_quarantine_status"]
          uploader_id: string
        }
        Insert: {
          bucket_id?: string
          claimed_at?: string | null
          created_at?: string
          declared_byte_size: number
          declared_mime_type: string
          expires_at?: string
          final_storage_path?: string | null
          finalized_at?: string | null
          id?: string
          listing_id: string
          processor_request_id?: string | null
          quarantine_path: string
          rejected_at?: string | null
          rejection_code?: string | null
          requested_role: Database["public"]["Enums"]["photo_role"]
          status?: Database["public"]["Enums"]["upload_quarantine_status"]
          uploader_id: string
        }
        Update: {
          bucket_id?: string
          claimed_at?: string | null
          created_at?: string
          declared_byte_size?: number
          declared_mime_type?: string
          expires_at?: string
          final_storage_path?: string | null
          finalized_at?: string | null
          id?: string
          listing_id?: string
          processor_request_id?: string | null
          quarantine_path?: string
          rejected_at?: string | null
          rejection_code?: string | null
          requested_role?: Database["public"]["Enums"]["photo_role"]
          status?: Database["public"]["Enums"]["upload_quarantine_status"]
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_quarantine_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_quarantine_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_quarantine_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      public_profiles: {
        Row: {
          account_kind: Database["public"]["Enums"]["account_kind"] | null
          avatar_path: string | null
          bio: string | null
          city: string | null
          completed_deals_count: number | null
          id: string | null
          is_merchant_verified: boolean | null
          member_since: string | null
          rating_average: number | null
          rating_count: number | null
          username: string | null
        }
        Insert: {
          account_kind?: Database["public"]["Enums"]["account_kind"] | null
          avatar_path?: string | null
          bio?: string | null
          city?: string | null
          completed_deals_count?: number | null
          id?: string | null
          is_merchant_verified?: never
          member_since?: string | null
          rating_average?: number | null
          rating_count?: number | null
          username?: string | null
        }
        Update: {
          account_kind?: Database["public"]["Enums"]["account_kind"] | null
          avatar_path?: string | null
          bio?: string | null
          city?: string | null
          completed_deals_count?: number | null
          id?: string | null
          is_merchant_verified?: never
          member_since?: string | null
          rating_average?: number | null
          rating_count?: number | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_beta_consent: {
        Args: {
          requested_document_code: string
          requested_document_version: string
        }
        Returns: string
      }
      accept_offer: { Args: { target_offer_id: string }; Returns: string }
      accept_offer_foundation: {
        Args: { target_offer_id: string }
        Returns: string
      }
      array_has_unique_items: { Args: { items: unknown }; Returns: boolean }
      assert_active_beta_user: { Args: never; Returns: undefined }
      bind_first_admin_invite: {
        Args: { target_invite_id: string; target_user_id: string }
        Returns: {
          bootstrap_already_bound: boolean
          bootstrap_email_confirmed: boolean
          bootstrap_invite_id: string
          bootstrap_onboarding_required: boolean
          bootstrap_profile_id: string
        }[]
      }
      can_read_report_evidence: {
        Args: { evidence_path: string }
        Returns: boolean
      }
      cancel_deal: {
        Args: { reason: string; target_deal_id: string }
        Returns: undefined
      }
      cancel_deal_foundation: {
        Args: { reason: string; target_deal_id: string }
        Returns: undefined
      }
      cancel_listing_upload: {
        Args: { target_upload_id: string }
        Returns: undefined
      }
      canonicalize_brand: {
        Args: {
          canonical_brand_id: string
          pending_brand_id: string
          rationale: string
          report_case_id: string
        }
        Returns: undefined
      }
      canonicalize_brand_unscoped: {
        Args: {
          canonical_brand_id: string
          pending_brand_id: string
          rationale: string
        }
        Returns: undefined
      }
      claim_listing_upload: {
        Args: { processor_request_id: string; target_upload_id: string }
        Returns: {
          bucket_id: string
          claimed_at: string | null
          created_at: string
          declared_byte_size: number
          declared_mime_type: string
          expires_at: string
          final_storage_path: string | null
          finalized_at: string | null
          id: string
          listing_id: string
          processor_request_id: string | null
          quarantine_path: string
          rejected_at: string | null
          rejection_code: string | null
          requested_role: Database["public"]["Enums"]["photo_role"]
          status: Database["public"]["Enums"]["upload_quarantine_status"]
          uploader_id: string
        }
        SetofOptions: {
          from: "*"
          to: "upload_quarantine"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_moderation_report: {
        Args: { p_report_id: string }
        Returns: string
      }
      claim_notification_email_delivery: {
        Args: { target_notification_id: string; worker_request_id: string }
        Returns: {
          attempts: number
          claimed_at: string | null
          created_at: string
          failed_at: string | null
          last_attempt_at: string | null
          last_error_code: string | null
          notification_id: string
          provider_message_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_email_delivery_status"]
          updated_at: string
          worker_request_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "notification_email_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_notification_email_delivery_v2: {
        Args: { target_notification_id: string; worker_request_id: string }
        Returns: {
          action_url: string
          body: string
          claimed_worker_request_id: string
          kind: string
          profile_id: string
          provider_message_id: string
          status: Database["public"]["Enums"]["notification_email_delivery_status"]
          title: string
        }[]
      }
      claim_open_registration: { Args: never; Returns: boolean }
      claim_upload_cleanup: {
        Args: { target_limit: number; worker_request_id: string }
        Returns: {
          attempts: number
          bucket_id: string
          claimed_at: string
          queue_id: number
          reason: string
          storage_path: string
        }[]
      }
      complete_beta_onboarding: {
        Args: { desired_username: string; home_city?: string }
        Returns: Json
      }
      complete_upload_cleanup: {
        Args: { target_queue_id: number; worker_request_id: string }
        Returns: undefined
      }
      confirm_deal: {
        Args: { target_deal_id: string }
        Returns: {
          accepted_offer_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          disputed_at: string | null
          id: string
          listing_id: string
          offered_listing_id: string | null
          party_a_id: string
          party_b_id: string
          status: Database["public"]["Enums"]["deal_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "deals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_beta_invite: {
        Args: { invited_by: string; invited_email: string; valid_for?: string }
        Returns: {
          invite_expires_at: string
          invite_id: string
          invite_token: string
        }[]
      }
      create_listing_upload: {
        Args: {
          declared_byte_size: number
          declared_mime_type: string
          requested_role: Database["public"]["Enums"]["photo_role"]
          target_listing_id: string
        }
        Returns: {
          bucket_id: string
          expires_at: string
          storage_path: string
          upload_id: string
        }[]
      }
      create_report_evidence_upload: {
        Args: { source_byte_size: number; source_mime_type: string }
        Returns: {
          bucket_id: string
          expires_at: string
          storage_path: string
          upload_id: string
        }[]
      }
      decline_offer: { Args: { target_offer_id: string }; Returns: undefined }
      decline_offer_foundation: {
        Args: { target_offer_id: string }
        Returns: undefined
      }
      effective_listing_limit: {
        Args: { target_profile_id: string }
        Returns: number
      }
      expire_report_evidence_uploads: {
        Args: { target_limit?: number }
        Returns: number
      }
      fail_upload_cleanup: {
        Args: {
          error_code: string
          target_queue_id: number
          worker_request_id: string
        }
        Returns: undefined
      }
      finalize_listing_upload: {
        Args: {
          actual_byte_size: number
          actual_content_hash: string
          actual_height_px: number
          actual_mime_type: string
          actual_width_px: number
          final_storage_path: string
          target_upload_id: string
        }
        Returns: {
          byte_size: number | null
          content_hash: string | null
          created_at: string
          height_px: number | null
          id: string
          listing_id: string
          mime_type: string | null
          role: Database["public"]["Enums"]["photo_role"]
          sanitized_at: string | null
          sort_order: number
          source_upload_id: string | null
          storage_path: string
          width_px: number | null
        }
        SetofOptions: {
          from: "*"
          to: "listing_photos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_report_evidence_upload: {
        Args: {
          actual_byte_size: number
          actual_content_hash: string
          actual_height_px: number
          actual_width_px: number
          target_upload_id: string
        }
        Returns: undefined
      }
      get_assigned_moderation_case: {
        Args: { p_report_id: string }
        Returns: {
          assigned_to: string
          audit_entries: Json
          created_at: string
          details: string
          evidence_paths: Json
          reason_code: string
          report_id: string
          reporter_id: string
          resolution_code: string
          resolution_notes: string
          resolved_at: string
          status: Database["public"]["Enums"]["report_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["report_target_type"]
          updated_at: string
        }[]
      }
      get_hosted_runtime_inventory: { Args: never; Returns: Json }
      get_my_beta_access: {
        Args: never
        Returns: {
          account_kind: Database["public"]["Enums"]["account_kind"]
          email_verified_at: string
          has_current_consents: boolean
          is_active: boolean
          is_suspended: boolean
          membership_expires_at: string
          membership_status: Database["public"]["Enums"]["beta_membership_status"]
          merchant_verified_at: string
          onboarding_completed_at: string
          phone_verified_at: string
          profile_id: string
          role: Database["public"]["Enums"]["platform_role"]
          username: string
        }[]
      }
      has_verified_phone: { Args: never; Returns: boolean }
      is_active_beta_user: { Args: never; Returns: boolean }
      is_admin: { Args: { check_user_id?: string }; Returns: boolean }
      is_conversation_member: {
        Args: { target_conversation_id: string; target_profile_id?: string }
        Returns: boolean
      }
      is_staff: { Args: { check_user_id?: string }; Returns: boolean }
      latest_messages_for_conversations: {
        Args: { target_conversation_ids: string[] }
        Returns: {
          body: string
          conversation_id: string
          created_at: string
          deleted_at: string
          edited_at: string
          id: string
          reply_to_id: string
          sender_id: string
        }[]
      }
      list_moderation_report_queue: {
        Args: { p_page_offset?: number; p_page_size?: number }
        Returns: {
          assignment_state: string
          created_at: string
          reason_code: string
          report_id: string
          status: Database["public"]["Enums"]["report_status"]
          target_type: Database["public"]["Enums"]["report_target_type"]
        }[]
      }
      list_my_reports: {
        Args: { p_page_offset?: number; p_page_size?: number }
        Returns: {
          created_at: string
          evidence_count: number
          outcome: string
          reason_code: string
          report_id: string
          resolved_at: string
          status: Database["public"]["Enums"]["report_status"]
          target_type: Database["public"]["Enums"]["report_target_type"]
          updated_at: string
        }[]
      }
      list_received_offers: {
        Args: {
          filter_status?: Database["public"]["Enums"]["offer_status"]
          page_offset?: number
          page_size?: number
        }
        Returns: {
          cash_amount_minor: number | null
          created_at: string
          expires_at: string | null
          id: string
          kind: Database["public"]["Enums"]["offer_kind"]
          listing_id: string
          message: string | null
          offered_listing_id: string | null
          offerer_id: string
          responded_at: string | null
          status: Database["public"]["Enums"]["offer_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "offers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mark_notification_email_failed: {
        Args: {
          error_code: string
          target_notification_id: string
          worker_request_id: string
        }
        Returns: undefined
      }
      mark_notification_email_sent: {
        Args: {
          provider_message_id: string
          target_notification_id: string
          worker_request_id: string
        }
        Returns: undefined
      }
      moderate_listing: {
        Args: {
          corrected_audience?: Database["public"]["Enums"]["audience"]
          corrected_segments?: Database["public"]["Enums"]["segment"][]
          moderated_status?: Database["public"]["Enums"]["listing_status"]
          moderation_rationale: string
          report_case_id: string
          target_listing_id: string
        }
        Returns: undefined
      }
      moderate_profile: {
        Args: {
          moderation_rationale: string
          report_case_id: string
          suspend_profile: boolean
          target_profile_id: string
        }
        Returns: undefined
      }
      moderate_profile_comment: {
        Args: {
          moderated_status: Database["public"]["Enums"]["review_status"]
          moderation_rationale: string
          report_case_id: string
          target_comment_id: string
        }
        Returns: undefined
      }
      moderate_review: {
        Args: {
          moderated_status: Database["public"]["Enums"]["review_status"]
          moderation_rationale: string
          report_case_id: string
          target_review_id: string
        }
        Returns: undefined
      }
      moderator_read_messages: {
        Args: {
          before_timestamp?: string
          page_size?: number
          report_case_id: string
        }
        Returns: {
          body: string
          conversation_id: string
          created_at: string
          deleted_at: string
          edited_at: string
          id: string
          reply_to_id: string
          sender_id: string
        }[]
      }
      normalize_catalog_key: { Args: { value: string }; Returns: string }
      open_deal_dispute: {
        Args: { details: string; target_deal_id: string }
        Returns: {
          deal_id: string
          report_id: string
        }[]
      }
      prepare_first_admin_invite: {
        Args: { bootstrap_email: string; valid_for?: string }
        Returns: {
          bootstrap_attempt_reused: boolean
          bootstrap_invite_expires_at: string
          bootstrap_invite_id: string
        }[]
      }
      publish_listing: {
        Args: { target_listing_id: string }
        Returns: {
          activated_at: string | null
          audience: Database["public"]["Enums"]["audience"]
          bottle_volume_ml: number | null
          brand_id: string
          brand_input_text: string | null
          brand_normalized_key: string | null
          catalog_provenance: Json
          city: string
          completed_at: string | null
          concentration: Database["public"]["Enums"]["concentration"]
          concentration_label: string | null
          created_at: string
          deal_mode: Database["public"]["Enums"]["deal_mode"]
          description: string
          estimated_value_minor: number | null
          expires_at: string | null
          fragrance_id: string | null
          fragrance_name: string
          fragrantica_url: string | null
          id: string
          is_sealed: boolean
          kind: Database["public"]["Enums"]["listing_kind"]
          max_budget_minor: number | null
          price_minor: number | null
          product_format: Database["public"]["Enums"]["product_format"] | null
          remaining_ml: number | null
          segments: Database["public"]["Enums"]["segment"][]
          seller_id: string
          slug: string
          status: Database["public"]["Enums"]["listing_status"]
          suggested_brand_id: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      redeem_beta_invite: {
        Args: { invite_token: string }
        Returns: {
          activated_at: string | null
          created_at: string
          ended_at: string | null
          expires_at: string | null
          invite_id: string | null
          onboarding_completed_at: string | null
          profile_id: string
          status: Database["public"]["Enums"]["beta_membership_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "beta_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reject_listing_upload: {
        Args: { rejection_code: string; target_upload_id: string }
        Returns: undefined
      }
      reject_report_evidence_upload: {
        Args: { rejection_code: string; target_upload_id: string }
        Returns: undefined
      }
      reject_unattached_report_evidence_uploads: {
        Args: { rejection_code: string; target_upload_ids: string[] }
        Returns: {
          storage_path: string
          upload_id: string
        }[]
      }
      resolve_conversation_report: {
        Args: {
          decision: string
          moderation_rationale: string
          report_case_id: string
        }
        Returns: Json
      }
      resolve_deal_dispute: {
        Args: {
          rationale: string
          report_case_id: string
          resolution_status: Database["public"]["Enums"]["deal_status"]
          target_deal_id: string
        }
        Returns: {
          accepted_offer_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          disputed_at: string | null
          id: string
          listing_id: string
          offered_listing_id: string | null
          party_a_id: string
          party_b_id: string
          status: Database["public"]["Enums"]["deal_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "deals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_listing_authenticity: {
        Args: {
          report_case_id: string
          review_public_note: string
          review_rationale: string
          review_result: Database["public"]["Enums"]["authenticity_review_status"]
          target_listing_id: string
        }
        Returns: undefined
      }
      review_listing_authenticity_unscoped: {
        Args: {
          review_public_note: string
          review_rationale: string
          review_result: Database["public"]["Enums"]["authenticity_review_status"]
          target_listing_id: string
        }
        Returns: undefined
      }
      review_merchant_application: {
        Args: {
          review_notes?: string
          target_application_id: string
          target_status: Database["public"]["Enums"]["merchant_application_status"]
        }
        Returns: {
          applicant_id: string
          created_at: string
          declaration_accepted_at: string | null
          document_paths: Json
          id: string
          legal_name: string
          registered_address: string
          registration_number: string
          reviewed_at: string | null
          reviewer_id: string | null
          reviewer_notes: string | null
          status: Database["public"]["Enums"]["merchant_application_status"]
          submitted_at: string | null
          updated_at: string
          website_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "merchant_applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_beta_invite: {
        Args: { target_invite_id: string }
        Returns: undefined
      }
      run_beta_maintenance: { Args: { max_rows?: number }; Returns: Json }
      safe_uuid: { Args: { value: string }; Returns: string }
      search_catalog: {
        Args: { page_size?: number; search_query: string }
        Returns: {
          brand_id: string
          entity_type: string
          id: string
          label: string
          relevance: number
          secondary_label: string
          slug: string
        }[]
      }
      search_catalog_v2: {
        Args: { page_offset?: number; page_size?: number; search_query: string }
        Returns: {
          brand_id: string
          entity_type: string
          id: string
          label: string
          relevance: number
          secondary_label: string
          slug: string
        }[]
      }
      search_listings: {
        Args: {
          cursor_activated_at?: string
          cursor_id?: string
          filter_audience?: Database["public"]["Enums"]["audience"]
          filter_city?: string
          filter_deal_mode?: Database["public"]["Enums"]["deal_mode"]
          filter_segments?: Database["public"]["Enums"]["segment"][]
          max_price_minor?: number
          min_price_minor?: number
          page_size?: number
          search_query?: string
        }
        Returns: {
          activated_at: string
          listing_id: string
          relevance: number
          slug: string
        }[]
      }
      search_listings_v2: {
        Args: {
          cursor_activated_at?: string
          cursor_id?: string
          cursor_price_minor?: number
          filter_audience?: Database["public"]["Enums"]["audience"]
          filter_brand_id?: string
          filter_city?: string
          filter_deal_mode?: Database["public"]["Enums"]["deal_mode"]
          filter_fragrance_id?: string
          filter_kind?: Database["public"]["Enums"]["listing_kind"]
          filter_product_format?: Database["public"]["Enums"]["product_format"]
          filter_segments?: Database["public"]["Enums"]["segment"][]
          max_price_minor?: number
          min_price_minor?: number
          page_size?: number
          search_query?: string
          sort_mode?: string
        }
        Returns: {
          activated_at: string
          listing_id: string
          relevance: number
          slug: string
          sort_price_minor: number
        }[]
      }
      slugify_marketplace: { Args: { value: string }; Returns: string }
      sync_editorial_catalog: { Args: { catalog_payload: Json }; Returns: Json }
    }
    Enums: {
      account_kind: "private" | "merchant"
      audience: "men" | "women" | "unisex"
      authenticity_review_status:
        | "pending"
        | "evidence_reviewed"
        | "insufficient_evidence"
        | "rejected"
      beta_invite_status: "pending" | "accepted" | "revoked" | "expired"
      beta_membership_status:
        | "pending"
        | "active"
        | "suspended"
        | "revoked"
        | "expired"
      brand_alias_kind:
        | "alternate"
        | "common_misspelling"
        | "transliteration"
        | "previous_name"
        | "product_line"
        | "acronym"
        | "other"
      brand_collection: "men" | "women" | "unisex" | "niche" | "arabic"
      brand_status:
        | "canonical"
        | "pending_canonicalization"
        | "merged"
        | "rejected"
      concentration:
        | "EDT"
        | "EDP"
        | "PARFUM"
        | "EXTRAIT"
        | "EDC"
        | "OTHER_NOT_STATED"
      conversation_status: "open" | "archived" | "blocked"
      deal_mode: "sale" | "swap" | "sale_or_swap"
      deal_status:
        | "pending_confirmation"
        | "completed"
        | "disputed"
        | "cancelled"
      entitlement_kind:
        | "extra_listing_slot"
        | "merchant_start"
        | "merchant_pro"
        | "boost"
      listing_kind: "offer" | "wanted"
      listing_status:
        | "draft"
        | "active"
        | "reserved"
        | "paused"
        | "completed"
        | "expired"
        | "rejected"
        | "removed"
      merchant_application_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "approved"
        | "rejected"
        | "withdrawn"
      moderation_action:
        | "report_assigned"
        | "report_resolved"
        | "content_hidden"
        | "content_restored"
        | "content_removed"
        | "category_corrected"
        | "brand_merged"
        | "merchant_verified"
        | "merchant_rejected"
        | "authenticity_reviewed"
        | "conversation_accessed"
        | "user_suspended"
        | "user_restored"
      notification_email_delivery_status:
        | "pending"
        | "processing"
        | "sent"
        | "failed"
      notification_kind:
        | "offer_received"
        | "offer_accepted"
        | "offer_declined"
        | "message_received"
        | "deal_confirmation_needed"
        | "deal_completed"
        | "review_received"
        | "listing_expiring"
        | "listing_expired"
        | "report_updated"
        | "merchant_application_updated"
        | "payment_updated"
      notification_status: "unread" | "read" | "archived"
      offer_kind: "cash" | "swap" | "cash_plus_swap"
      offer_status:
        | "pending"
        | "accepted"
        | "declined"
        | "withdrawn"
        | "expired"
      payment_provider: "mypos" | "stripe"
      payment_purpose:
        | "extra_listing"
        | "merchant_start"
        | "merchant_pro"
        | "boost"
      payment_status:
        | "created"
        | "pending"
        | "paid"
        | "failed"
        | "cancelled"
        | "refunded"
        | "partially_refunded"
      photo_role:
        | "product_full"
        | "bottle_bottom"
        | "batch_code"
        | "fill_level"
        | "box_front"
        | "box_bottom"
        | "seal"
        | "manufacturer_label"
        | "manufacturer_markings"
        | "other"
      platform_role: "user" | "moderator" | "admin"
      product_format: "retail_bottle" | "tester" | "official_sample"
      report_evidence_upload_status:
        | "pending"
        | "finalized"
        | "attached"
        | "rejected"
        | "expired"
      report_status: "open" | "investigating" | "resolved" | "dismissed"
      report_target_type:
        | "profile"
        | "brand"
        | "listing"
        | "offer"
        | "conversation"
        | "message"
        | "deal"
        | "review"
        | "profile_comment"
      review_status: "published" | "hidden" | "removed"
      segment: "niche" | "arabic"
      upload_quarantine_status:
        | "pending"
        | "processing"
        | "finalized"
        | "rejected"
        | "expired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_kind: ["private", "merchant"],
      audience: ["men", "women", "unisex"],
      authenticity_review_status: [
        "pending",
        "evidence_reviewed",
        "insufficient_evidence",
        "rejected",
      ],
      beta_invite_status: ["pending", "accepted", "revoked", "expired"],
      beta_membership_status: [
        "pending",
        "active",
        "suspended",
        "revoked",
        "expired",
      ],
      brand_alias_kind: [
        "alternate",
        "common_misspelling",
        "transliteration",
        "previous_name",
        "product_line",
        "acronym",
        "other",
      ],
      brand_collection: ["men", "women", "unisex", "niche", "arabic"],
      brand_status: [
        "canonical",
        "pending_canonicalization",
        "merged",
        "rejected",
      ],
      concentration: [
        "EDT",
        "EDP",
        "PARFUM",
        "EXTRAIT",
        "EDC",
        "OTHER_NOT_STATED",
      ],
      conversation_status: ["open", "archived", "blocked"],
      deal_mode: ["sale", "swap", "sale_or_swap"],
      deal_status: [
        "pending_confirmation",
        "completed",
        "disputed",
        "cancelled",
      ],
      entitlement_kind: [
        "extra_listing_slot",
        "merchant_start",
        "merchant_pro",
        "boost",
      ],
      listing_kind: ["offer", "wanted"],
      listing_status: [
        "draft",
        "active",
        "reserved",
        "paused",
        "completed",
        "expired",
        "rejected",
        "removed",
      ],
      merchant_application_status: [
        "draft",
        "submitted",
        "under_review",
        "approved",
        "rejected",
        "withdrawn",
      ],
      moderation_action: [
        "report_assigned",
        "report_resolved",
        "content_hidden",
        "content_restored",
        "content_removed",
        "category_corrected",
        "brand_merged",
        "merchant_verified",
        "merchant_rejected",
        "authenticity_reviewed",
        "conversation_accessed",
        "user_suspended",
        "user_restored",
      ],
      notification_email_delivery_status: [
        "pending",
        "processing",
        "sent",
        "failed",
      ],
      notification_kind: [
        "offer_received",
        "offer_accepted",
        "offer_declined",
        "message_received",
        "deal_confirmation_needed",
        "deal_completed",
        "review_received",
        "listing_expiring",
        "listing_expired",
        "report_updated",
        "merchant_application_updated",
        "payment_updated",
      ],
      notification_status: ["unread", "read", "archived"],
      offer_kind: ["cash", "swap", "cash_plus_swap"],
      offer_status: ["pending", "accepted", "declined", "withdrawn", "expired"],
      payment_provider: ["mypos", "stripe"],
      payment_purpose: [
        "extra_listing",
        "merchant_start",
        "merchant_pro",
        "boost",
      ],
      payment_status: [
        "created",
        "pending",
        "paid",
        "failed",
        "cancelled",
        "refunded",
        "partially_refunded",
      ],
      photo_role: [
        "product_full",
        "bottle_bottom",
        "batch_code",
        "fill_level",
        "box_front",
        "box_bottom",
        "seal",
        "manufacturer_label",
        "manufacturer_markings",
        "other",
      ],
      platform_role: ["user", "moderator", "admin"],
      product_format: ["retail_bottle", "tester", "official_sample"],
      report_evidence_upload_status: [
        "pending",
        "finalized",
        "attached",
        "rejected",
        "expired",
      ],
      report_status: ["open", "investigating", "resolved", "dismissed"],
      report_target_type: [
        "profile",
        "brand",
        "listing",
        "offer",
        "conversation",
        "message",
        "deal",
        "review",
        "profile_comment",
      ],
      review_status: ["published", "hidden", "removed"],
      segment: ["niche", "arabic"],
      upload_quarantine_status: [
        "pending",
        "processing",
        "finalized",
        "rejected",
        "expired",
      ],
    },
  },
} as const

export type Views<
  ViewName extends keyof Database["public"]["Views"],
> = Database["public"]["Views"][ViewName]["Row"]
