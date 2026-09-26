import type { BodyShape } from '@generated/prisma';

import type {
  AvatarConfigurationView,
  BodyProfileSnapshot,
  MeasurementKey,
} from '@/modules/body-profile';

/**
 * What any avatar renderer is given — the one contract between the body
 * profile and whatever draws it. Today that is `LocalAvatarRenderer` (SVG,
 * in the browser, no network); a 3D or generated renderer later receives
 * exactly this, so swapping renderers never touches the profile.
 *
 * Measurements may be partial (the form is mid-edit) and every appearance
 * field may be unset: a renderer draws what it is told and falls back to a
 * neutral figure for the rest — it never fills a gap with an assumption
 * about how the customer looks. Type-only imports, so client components can
 * use it freely.
 */

export type AvatarAppearance = AvatarConfigurationView;

export interface AvatarRenderInput {
  measurements: Partial<Record<MeasurementKey, number | null>>;
  appearance: AvatarAppearance;
  /** The proportion the measurements describe (`deriveBodyShape`), for the
   * figure's description. Not drawn from: the measurements themselves
   * already shape the figure, so this never adds a second opinion. */
  bodyShape?: BodyShape | null;
}

export const NEUTRAL_APPEARANCE: AvatarAppearance = {
  skinTone: null,
  hairStyle: null,
  hairColor: null,
  facialHair: null,
  wearsGlasses: false,
  glassesStyle: null,
  glassesFrameColor: null,
};

export function avatarInputFromProfile(profile: BodyProfileSnapshot | null): AvatarRenderInput {
  return profile
    ? {
        measurements: profile.measurements,
        appearance: profile.avatar,
        bodyShape: profile.bodyShape,
      }
    : { measurements: {}, appearance: NEUTRAL_APPEARANCE };
}
