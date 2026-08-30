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
	misleading_content: ['brand', 'listing', 'review', 'profile_comment'],
	harassment: ['profile', 'conversation', 'message', 'review', 'profile_comment'],
	spam_fraud: ['profile', 'listing', 'offer', 'conversation', 'message'],
	other_violation: reportTargetTypeSchema.options
};

export const createReportInputSchema = z.object({
	targetType: reportTargetTypeSchema,
	targetId: uuidSchema,
	reasonCode: reportReasonSchema,
	details: z.string().trim().max(4000).nullable().optional(),
	evidencePaths: z.array(z.string().trim().min(1).max(500)).max(12).default([])
}).superRefine((value, context) => {
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
