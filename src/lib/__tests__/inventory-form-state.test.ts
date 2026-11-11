import { describe, it, expect } from 'vitest';
import { buildInventoryDraft, eventImpliesEquipStatus, nextCategoryChoice } from '#lib/components/chat/context/inventory-form-state.ts';

describe('inventory form state', () => {
	it('marks events that imply their own equip status', () => {
		expect(eventImpliesEquipStatus('equipped')).toBe(true);
		expect(eventImpliesEquipStatus('unequipped')).toBe(true);
		expect(eventImpliesEquipStatus('lost')).toBe(true);
		expect(eventImpliesEquipStatus('consumed')).toBe(true);
		expect(eventImpliesEquipStatus('acquired')).toBe(false);
		expect(eventImpliesEquipStatus('used')).toBe(false);
		expect(eventImpliesEquipStatus('modified')).toBe(false);
	});

	it('drops inherit when the event becomes acquired', () => {
		expect(nextCategoryChoice('acquired', 'inherit')).toBe('none');
		expect(nextCategoryChoice('modified', 'inherit')).toBe('inherit');
		expect(nextCategoryChoice('acquired', 'equipment')).toBe('equipment');
	});

	it('maps the category choice tri-state', () => {
		const base = {
			itemName: 'Sword',
			eventType: 'modified' as const,
			equipStatus: 'carried' as const,
			description: '',
		};

		expect(buildInventoryDraft({ ...base, categoryChoice: 'inherit' }).category).toBeUndefined();
		expect(buildInventoryDraft({ ...base, categoryChoice: 'none' }).category).toBeNull();
		expect(buildInventoryDraft({ ...base, categoryChoice: 'equipment' }).category).toBe('equipment');
	});

	it('omits equip status for implied events and trims description', () => {
		const draft = buildInventoryDraft({
			itemName: 'Sword',
			eventType: 'lost',
			categoryChoice: 'none',
			equipStatus: 'equipped',
			description: '  Dropped in the river  ',
		});

		expect(draft.equipStatus).toBeUndefined();
		expect(draft.description).toBe('Dropped in the river');

		const blank = buildInventoryDraft({
			itemName: 'Sword',
			eventType: 'used',
			categoryChoice: 'none',
			equipStatus: 'equipped',
			description: '   ',
		});
		expect(blank.equipStatus).toBe('equipped');
		expect(blank.description).toBeNull();
	});
});
