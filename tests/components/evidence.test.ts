import { describe, expect, it } from 'vitest';
import {
	getEvidenceRoles,
	uniqueSelectedEvidenceCount
} from '../../src/lib/components/listing/evidence';

describe('listing wizard evidence guidance', () => {
	it('requests four context-specific photos for each sellable product state', () => {
		expect(getEvidenceRoles('retail_bottle', false, 'offer').map((role) => role.key)).toEqual([
			'product_full',
			'bottle_bottom',
			'batch_code',
			'fill_level'
		]);
		expect(getEvidenceRoles('retail_bottle', true, 'offer').map((role) => role.key)).toEqual([
			'box_front',
			'box_bottom',
			'batch_code',
			'seal'
		]);
		expect(getEvidenceRoles('official_sample', false, 'offer').map((role) => role.key)).toEqual([
			'product_full',
			'manufacturer_label',
			'manufacturer_markings',
			'fill_level'
		]);
	});

	it('makes a photo optional for wanted listings', () => {
		expect(getEvidenceRoles('retail_bottle', false, 'wanted').map((role) => role.key)).toEqual([
			'other'
		]);
	});

	it('counts files by signature so the same image cannot satisfy multiple roles', () => {
		const roles = getEvidenceRoles('retail_bottle', false, 'offer');
		const reusedFile = { name: 'same.jpg', size: 1234, lastModified: 100 } as File;
		const visuallySameFile = { name: 'same.jpg', size: 1234, lastModified: 100 } as File;
		const distinctFile = { name: 'bottom.jpg', size: 2345, lastModified: 101 } as File;

		expect(
			uniqueSelectedEvidenceCount(roles, {
				product_full: reusedFile,
				bottle_bottom: visuallySameFile,
				batch_code: distinctFile,
				fill_level: null
			})
		).toBe(2);
	});
});
