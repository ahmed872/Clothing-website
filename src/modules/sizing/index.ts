/**
 * `sizing` — garment types, product size charts and the size recommendation
 * engine (clothing P02).
 *
 * May depend on: core, body-profile
 * Must not depend on: identity, customers, orders
 *
 * What lives here:
 *   - the closed garment list and chart bounds (`garment-types.ts`) and every
 *     number the engine uses (`sizing-rules.ts`) — both dependency-free, so
 *     the admin editor and the storefront read the same lists;
 *   - chart validation (`size-chart.schemas.ts`) and persistence
 *     (`size-chart.service.ts`), keyed by product; the product's own option
 *     values are the sizes, checked inside each write;
 *   - the recommendation contract (`size-recommendation.ts`), its one
 *     rule-based implementation (`size-engine.ts`), and the composition of a
 *     customer's profile with a product's chart
 *     (`customer-recommendation.service.ts`).
 *
 * It reads the catalog's product and option rows directly, the way `cart`
 * reads variants, rather than importing `catalog`: a chart only needs to
 * know that a size belongs to a product.
 *
 * Other modules import `@/modules/sizing`, never a file inside it.
 */

export {
  GARMENT_TYPES,
  GARMENT_MEASUREMENT_KEYS,
  GARMENT_MEASUREMENT_BOUNDS,
  type GarmentType,
  type GarmentMeasurementKey,
  type SizeChartMeasurements,
  type FitPreference,
} from './garment-types';

export {
  GARMENT_RULES,
  SIZING_RULES_VERSION,
  SCORING,
  CONFIDENCE,
  TIE_BREAK,
  ALTERNATIVE_MIN_SCORE,
  FULL_LENGTH_RATIO,
  BODY_COUNTERPART,
  chartMeasurementsFor,
  requiredChartMeasurementsFor,
  type MeasurementRule,
  type GarmentRules,
} from './sizing-rules';

export {
  sizeChartInputSchema,
  sizeChartErrorsFromIssues,
  MAX_SIZE_CHART_ROWS,
  type SizeChartInput,
  type SizeChartData,
  type SizeChartFieldErrors,
  type SizeChartErrorCode,
} from './size-chart.schemas';

export {
  getProductSizing,
  saveProductSizing,
  deleteProductSizing,
  getStorefrontSizeChart,
  type ProductSizingView,
  type SizeChartEntryView,
  type SaveProductSizingOptions,
  type StorefrontSizeChart,
} from './size-chart.service';

export {
  recommendSize,
  RuleBasedSizeRecommendationService,
  sizeRecommendationService,
} from './size-engine';

export type {
  SizeRecommendationService,
  SizeRecommendationRequest,
  SizeRecommendationResult,
  SizeRecommendation,
  SizeRecommendationReason,
  SizeConfidence,
  SizeAlternative,
  SizeFit,
  SizeChartRow,
  MeasurementComparison,
  MeasurementFit,
  ProfileMeasurementKey,
} from './size-recommendation';

export {
  recommendSizeForCustomer,
  type CustomerSizeRecommendation,
  type RecommendForCustomerOptions,
} from './customer-recommendation.service';
