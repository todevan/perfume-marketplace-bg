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

export interface ReportDto {
	readonly id: string;
	readonly targetType: z.infer<typeof reportTargetTypeSchema>;
	readonly targetId: string;
	readonly reasonCode: string;
	readonly details: string | null;
	readonly evidenceCount: number;
	readonly status: z.infer<typeof reportStatusSchema>;
	readonly resolutionCode: string | null;
	readonly resolvedAt: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type ReportPageDto = PageDto<ReportDto>;

export const createReportInputSchema = z.object({
	targetType: reportTargetTypeSchema,
	targetId: uuidSchema,
	reasonCode: z.string().trim().min(2).max(80).regex(/^[a-z0-9_:-]+$/i),
	details: z.string().trim().max(4000).nullable().optional(),
	evidencePaths: z.array(z.string().trim().min(1).max(500)).max(12).default([])
});
export const reportListInputSchema = optionalPageSchema.extend({ status: reportStatusSchema.optional() });

export type CreateReportInput = z.infer<typeof createReportInputSchema>;
export type ReportListInput = z.infer<typeof reportListInputSchema>;

