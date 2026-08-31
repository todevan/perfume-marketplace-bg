import { describe, expect, it } from 'vitest';
import {
	createReportInputSchema,
	REPORT_TARGET_CAPABILITIES,
	REPORT_REASON_TARGETS
} from '../../src/lib/contracts/reports';

const targetId = '11111111-1111-4111-8111-111111111111';

describe('generic report reason boundary', () => {
	it.each([
		['profile', true],
		['brand', false],
		['listing', true],
		['offer', false],
		['conversation', true],
		['message', true],
		['deal', true],
		['review', true],
		['profile_comment', true]
	] as const)(
		'enforces the submission capability for %s before report insertion',
		(targetType, accepted) => {
			expect(REPORT_TARGET_CAPABILITIES[targetType].submission).toBe(
				accepted ? 'accepted' : 'rejected'
			);
			expect(
				createReportInputSchema.safeParse({
					targetType,
					targetId,
					reasonCode: 'other_violation',
					evidencePaths: []
				}).success
			).toBe(accepted);
		}
	);

	it('accepts only reason and target combinations exposed by the form', () => {
		for (const [reasonCode, targets] of Object.entries(REPORT_REASON_TARGETS)) {
			for (const targetType of targets) {
				expect(
					createReportInputSchema.safeParse({
						targetType,
						targetId,
						reasonCode,
						evidencePaths: []
					}).success
				).toBe(true);
			}
		}
	});

	it('keeps deal disputes on the dedicated atomic workflow', () => {
		expect(
			createReportInputSchema.safeParse({
				targetType: 'deal',
				targetId,
				reasonCode: 'deal_dispute',
				evidencePaths: []
			}).success
		).toBe(false);
		expect(
			createReportInputSchema.safeParse({
				targetType: 'profile',
				targetId,
				reasonCode: 'counterfeit_suspected',
				evidencePaths: []
			}).success
		).toBe(false);
	});
});
