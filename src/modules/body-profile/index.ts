/**
 * `body-profile` — a customer's measurements and avatar appearance, for
 * clothing fit (clothing P01).
 *
 * May depend on: core
 * Must not depend on: identity, customers, catalog, orders
 *
 * The customer it belongs to is a plain `customerId` argument, always
 * supplied by the caller from the signed-in session — this module never
 * learns *who is signed in* itself (that composition is
 * `lib/customers/customer-identity.ts`'s), and never accepts a profile or
 * avatar id at all.
 *
 * What lives here:
 *   - the profile and avatar services (`body-profile.service.ts`);
 *   - their shared validation (`schemas.ts`) and the closed option lists
 *     and measurement bounds it is built from (`options.ts`,
 *     `measurement-input.ts` — dependency-free, so the storefront form
 *     reads them too);
 *   - the deterministic completion score (`profile-completion.ts`);
 *   - the isolated, replaceable body-shape rules (`body-shape.service.ts`);
 *   - the size recommendation *contract* (`size-recommendation.ts`) — the
 *     engine itself is P02's.
 *
 * Other modules import `@/modules/body-profile`, never a file inside it.
 */

export {
  getBodyProfile,
  saveBodyProfile,
  deleteBodyProfile,
  serializeBodyProfile,
  type BodyProfileView,
  type BodyProfileSnapshot,
  type BodyMeasurements,
  type AvatarConfigurationView,
  type SaveBodyProfileOptions,
} from './body-profile.service';

export {
  bodyProfileInputSchema,
  avatarConfigurationInputSchema,
  fieldErrorsFromIssues,
  type BodyProfileInput,
  type BodyProfileData,
  type AvatarConfigurationInput,
  type AvatarConfigurationData,
  type BodyProfileField,
  type BodyProfileErrorCode,
} from './schemas';

export {
  GENDERS,
  SKIN_TONES,
  HAIR_STYLES,
  HAIR_COLORS,
  FACIAL_HAIR,
  GLASSES_STYLES,
  GLASSES_FRAME_COLORS,
  BODY_SHAPES,
  REQUIRED_MEASUREMENTS,
  OPTIONAL_MEASUREMENTS,
  MEASUREMENT_KEYS,
  MEASUREMENT_BOUNDS,
  type MeasurementKey,
  type RequiredMeasurementKey,
  type OptionalMeasurementKey,
  type MeasurementUnit,
} from './options';

export {
  parseMeasurementInput,
  checkMeasurement,
  roundMeasurement,
  type MeasurementProblem,
} from './measurement-input';

export {
  computeProfileCompletion,
  COMPLETION_ITEMS,
  type ProfileCompletion,
  type CompletionInput,
  type CompletionItemKey,
  type CompletionSection,
} from './profile-completion';

export {
  deriveBodyShape,
  BODY_SHAPE_RULES_VERSION,
  type BodyShapeMeasurements,
} from './body-shape.service';

export {
  toSizingProfile,
  type SizingProfile,
  type SizeRecommendationService,
  type SizeRecommendationRequest,
  type SizeRecommendationResult,
  type SizeRecommendation,
  type SizeRecommendationConfidence,
} from './size-recommendation';
