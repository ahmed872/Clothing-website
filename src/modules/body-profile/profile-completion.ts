import type { MeasurementKey } from './options';

/**
 * How complete a body profile is — a plain, explainable sum, not a score
 * anything estimates. Every item carries a fixed weight, the weights add up
 * to 100, and the percentage is the weight of what is filled in. The same
 * function runs on the server (a saved profile) and in the form (what the
 * customer has typed so far), so the number never disagrees with itself.
 *
 *   basic         gender                                            10
 *   measurements  height, weight, waist (required)          10 each 30
 *                 hip 7 · chest 7 · inseam 6 · shoulder 6 ·
 *                 sleeve 5 · neck 4 (optional)                      35
 *   appearance    skin tone 9 · hair style 8 · hair colour 8        25
 *
 * The optional measurements are weighted by how much each will sharpen a
 * size recommendation (hip and chest decide most garments; neck only
 * shirts), which is also the order `missing` suggests them in. Hair colour
 * counts as done when the hair is covered — there is nothing to choose.
 * Dependency-free, so the form can import it.
 */

export type CompletionSection = 'basic' | 'measurements' | 'appearance';
export type CompletionItemKey = 'gender' | MeasurementKey | 'skinTone' | 'hairStyle' | 'hairColor';

interface CompletionItem {
  key: CompletionItemKey;
  section: CompletionSection;
  weight: number;
  required: boolean;
}

/** In suggestion order: what blocks saving first, then what helps most. */
export const COMPLETION_ITEMS: readonly CompletionItem[] = [
  { key: 'gender', section: 'basic', weight: 10, required: true },
  { key: 'heightCm', section: 'measurements', weight: 10, required: true },
  { key: 'weightKg', section: 'measurements', weight: 10, required: true },
  { key: 'waistCm', section: 'measurements', weight: 10, required: true },
  { key: 'hipCm', section: 'measurements', weight: 7, required: false },
  { key: 'chestCm', section: 'measurements', weight: 7, required: false },
  { key: 'inseamCm', section: 'measurements', weight: 6, required: false },
  { key: 'shoulderCm', section: 'measurements', weight: 6, required: false },
  { key: 'sleeveLengthCm', section: 'measurements', weight: 5, required: false },
  { key: 'neckCm', section: 'measurements', weight: 4, required: false },
  { key: 'skinTone', section: 'appearance', weight: 9, required: false },
  { key: 'hairStyle', section: 'appearance', weight: 8, required: false },
  { key: 'hairColor', section: 'appearance', weight: 8, required: false },
];

export interface CompletionInput {
  gender: string | null;
  measurements: Partial<Record<MeasurementKey, number | null>>;
  appearance: { skinTone: string | null; hairStyle: string | null; hairColor: string | null };
}

export interface ProfileCompletion {
  /** 0–100, a whole number. */
  percent: number;
  /** Everything a profile needs before it can be saved is present. */
  requiredComplete: boolean;
  sections: Record<CompletionSection, { done: number; total: number; complete: boolean }>;
  /** What is still missing, most useful first. */
  missing: CompletionItemKey[];
  /** The single most useful thing to add next, or `null` when complete. */
  nextStep: CompletionItemKey | null;
}

function isFilled(item: CompletionItem, input: CompletionInput): boolean {
  switch (item.key) {
    case 'gender':
      return input.gender !== null;
    case 'skinTone':
      return input.appearance.skinTone !== null;
    case 'hairStyle':
      return input.appearance.hairStyle !== null;
    case 'hairColor':
      return input.appearance.hairColor !== null || input.appearance.hairStyle === 'COVERED';
    default:
      return typeof input.measurements[item.key] === 'number';
  }
}

export function computeProfileCompletion(input: CompletionInput | null): ProfileCompletion {
  const sections: ProfileCompletion['sections'] = {
    basic: { done: 0, total: 0, complete: false },
    measurements: { done: 0, total: 0, complete: false },
    appearance: { done: 0, total: 0, complete: false },
  };
  const missing: CompletionItemKey[] = [];
  let earned = 0;
  let requiredComplete = true;

  for (const item of COMPLETION_ITEMS) {
    const filled = input !== null && isFilled(item, input);
    sections[item.section].total += 1;
    if (filled) {
      earned += item.weight;
      sections[item.section].done += 1;
    } else {
      missing.push(item.key);
      if (item.required) requiredComplete = false;
    }
  }
  for (const section of Object.values(sections)) section.complete = section.done === section.total;

  return {
    percent: earned,
    requiredComplete,
    sections,
    missing,
    nextStep: missing[0] ?? null,
  };
}
