import { describe, expect, it } from 'vitest';

import { attributeValueLabel } from './attribute-value-label';

describe('attributeValueLabel', () => {
  const labels = { Cotton: { ar: 'قطن' }, Linen: { ar: 'كتان', en: 'Pure linen' } };

  it("reads the label in the page's language", () => {
    expect(attributeValueLabel(labels, 'Cotton', 'ar')).toBe('قطن');
    expect(attributeValueLabel(labels, 'Linen', 'en')).toBe('Pure linen');
  });

  it('shows the value as typed when that language has no label', () => {
    expect(attributeValueLabel(labels, 'Cotton', 'en')).toBe('Cotton');
    expect(attributeValueLabel(labels, 'Wool', 'ar')).toBe('Wool');
    expect(attributeValueLabel(null, 'Wool', 'ar')).toBe('Wool');
  });
});
