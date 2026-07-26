import { z } from 'zod';
import type { PageDto } from './common';
import { nullableUrlSchema, optionalPageSchema, uuidSchema } from './common';
import type { PublicProfileDto } from './profiles';

export const merchantApplicationStatusSchema = z.enum([
	'draft',
	'submitted',
	'under_review',
	'approved',
	'rejected',
	'withdrawn'
]);

export interface MerchantApplicationDto {
	readonly id: string;
	readonly status: z.infer<typeof merchantApplicationStatusSchema>;
	readonly legalName: string;
	readonly registrationNumber: string;
	readonly registeredAddress: string;
	readonly websiteUrl: string | null;
	readonly documentCount: number;
	readonly declarationAcceptedAt: string | null;
	readonly submittedAt: string | null;
	readonly reviewedAt: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type MerchantDirectoryPageDto = PageDto<PublicProfileDto>;

export const merchantApplicationInputSchema = z.object({
	legalName: z.string().trim().min(2).max(200),
	registrationNumber: z.string().trim().min(4).max(64),
	registeredAddress: z.string().trim().min(5).max(500),
	websiteUrl: nullableUrlSchema.optional(),
	documentPaths: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
	declarationAccepted: z.boolean().default(false),
	submit: z.boolean().default(false)
}).superRefine((value, context) => {
	if (value.submit && !value.declarationAccepted) {
		context.addIssue({
			code: 'custom',
			path: ['declarationAccepted'],
			message: 'The declaration must be accepted before submission.'
		});
	}
});
export const merchantApplicationIdSchema = z.object({ applicationId: uuidSchema });
export const merchantDirectoryInputSchema = optionalPageSchema.extend({
	query: z.string().trim().max(100).default(''),
	city: z.string().trim().max(100).optional()
});

export type MerchantApplicationInput = z.infer<typeof merchantApplicationInputSchema>;
export type MerchantApplicationIdInput = z.infer<typeof merchantApplicationIdSchema>;
export type MerchantDirectoryInput = z.infer<typeof merchantDirectoryInputSchema>;

