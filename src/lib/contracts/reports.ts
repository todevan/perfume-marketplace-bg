import { z } from 'zod';
import type { PageDto } from './common';
import { optionalPageSchema, uuidSchema } from './common';

export const reportTargetTypeSchema = z.enum([
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
export type ReportTargetType = z.infer<typeof reportTargetTypeSchema>;

export const REPORT_TARGET_CAPABILITIES = {
	profile: { submission: 'accepted', queue: 'standard', claim: 'standard', decision: 'target_action' },
	brand: { submission: 'rejected', queue: 'legacy', claim: 'legacy', decision: 'safe_disposition' },
	listing: { submission: 'accepted', queue: 'standard', claim: 'standard', decision: 'target_action' },
	offer: { submission: 'rejected', queue: 'legacy', claim: 'legacy', decision: 'safe_disposition' },
	conversation: { submission: 'accepted', queue: 'standard', claim: 'standard', decision: 'target_action' },
	message: { submission: 'accepted', queue: 'standard', claim: 'standard', decision: 'target_action' },
	deal: { submission: 'accepted', queue: 'standard', claim: 'standard', decision: 'target_action' },
	review: { submission: 'accepted', queue: 'standard', claim: 'standard', decision: 'target_action' },
	profile_comment: { submission: 'accepted', queue: 'standard', claim: 'standard', decision: 'target_action' }
} as const satisfies Readonly<Record<ReportTargetType, {
	readonly submission: 'accepted' | 'rejected';
	readonly queue: 'standard' | 'legacy';
	readonly claim: 'standard' | 'legacy';
	readonly decision: 'target_action' | 'safe_disposition';
}>>;

export function isReportTargetSubmittable(targetType: ReportTargetType): boolean {
	return REPORT_TARGET_CAPABILITIES[targetType].submission === 'accepted';
}

export const SUBMITTABLE_REPORT_TARGET_TYPES = Object.freeze(
	reportTargetTypeSchema.options.filter(isReportTargetSubmittable)
);
export const reportStatusSchema = z.enum(['open', 'investigating', 'resolved', 'dismissed']);
export const reportOutcomeSchema = z.enum(['pending', 'action_taken', 'no_action', 'completed']);

export interface ReportDto {
	readonly id: string;
	readonly targetType: z.infer<typeof reportTargetTypeSchema>;
	readonly reasonCode: string;
	readonly evidenceCount: number;
	readonly status: z.infer<typeof reportStatusSchema>;
	readonly outcome: z.infer<typeof reportOutcomeSchema>;
	readonly resolvedAt: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type ReportPageDto = PageDto<ReportDto>;

export const reportReasonSchema = z.enum([
	'counterfeit_suspected',
	'misleading_content',
	'harassment',
	'spam_fraud',
	'other_violation'
]);

export const REPORT_REASON_TARGETS: Readonly<Record<z.infer<typeof reportReasonSchema>, readonly z.infer<typeof reportTargetTypeSchema>[]>> = {
	counterfeit_suspected: ['listing'],
	misleading_content: ['listing', 'review', 'profile_comment'],
	harassment: ['profile', 'conversation', 'message', 'review', 'profile_comment'],
	spam_fraud: ['profile', 'listing', 'conversation', 'message'],
	other_violation: SUBMITTABLE_REPORT_TARGET_TYPES
};

export const createReportInputSchema = z.object({
	targetType: reportTargetTypeSchema,
	targetId: uuidSchema,
	reasonCode: reportReasonSchema,
	details: z.string().trim().max(4000).nullable().optional(),
	evidencePaths: z.array(z.string().trim().min(1).max(500)).max(12).default([])
}).superRefine((value, context) => {
	if (!isReportTargetSubmittable(value.targetType)) {
		context.addIssue({
			code: 'custom',
			path: ['targetType'],
			message: 'This report target is not supported for submission.'
		});
		return;
	}
	if (!REPORT_REASON_TARGETS[value.reasonCode].includes(value.targetType)) {
		context.addIssue({
			code: 'custom',
			path: ['reasonCode'],
			message: 'The selected reason does not apply to this report target.'
		});
	}
});
export const reportListInputSchema = optionalPageSchema.extend({ status: reportStatusSchema.optional() });

export type CreateReportInput = z.infer<typeof createReportInputSchema>;
export type ReportListInput = z.infer<typeof reportListInputSchema>;
