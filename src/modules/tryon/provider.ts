/**
 * The one interface every AI try-on backend implements (clothing P05).
 *
 * Try-on is optional: the store works in full with no provider at all — the
 * personalized fitting room (P04) is drawn locally and needs nothing here.
 * When a provider is configured, the job service and the routes talk to
 * `AITryOnProvider` and never to a vendor SDK, so adding a real vendor means
 * one adapter file beside `mock-provider.ts` and one enum value in the
 * environment schema — no change to the job table, the service, the routes
 * or the fitting room.
 *
 * No vendor is named here on purpose. None has been selected, and this file
 * does not guess at one's wire format: an adapter maps its vendor's API to
 * these types at its own edge.
 *
 * Everything on this interface is server-side, and nothing it takes comes
 * from the browser as-is: the garment and body description is assembled by
 * the server from the catalog and the signed-in customer's own profile.
 */

export type TryOnProviderName = 'mock';

/** The garment, as the catalog describes it — never as the browser did. */
export interface TryOnGarment {
  productId: string;
  variantId: string;
  garmentType: string;
  name: { ar: string; en: string };
  sizeLabel: { ar: string; en: string };
  /** `#RRGGBB` from the product's own swatch, when the admin set one. */
  colorHex: string | null;
  /** The catalog's first product image, when there is one. */
  imageUrl: string | null;
}

/** The customer's body, from their own saved profile. Measurements only — a
 * provider is never sent a name, an email or any account id. */
export interface TryOnBody {
  gender: string;
  heightCm: number;
  weightKg: number;
  waistCm: number;
  chestCm: number | null;
  hipCm: number | null;
  shoulderCm: number | null;
  inseamCm: number | null;
}

export interface TryOnProviderRequest {
  /** Our job id. Sent as the provider's idempotency key and echoed back on
   * callbacks, which is how a callback finds the job again. */
  jobId: string;
  garment: TryOnGarment;
  body: TryOnBody;
}

export type ProviderJobStatus = 'processing' | 'completed' | 'failed';

/** What a provider says about one of its jobs. */
export interface ProviderJobState {
  providerJobId: string;
  status: ProviderJobStatus;
  /** Where the provider put the result image. Checked against the configured
   * allowlist before it is stored or shown (see `result-url.ts`). */
  resultUrl: string | null;
  /** The provider's failure code, normalised by the adapter to a short
   * token. Never a message: provider text is not shown to customers. */
  errorCode: string | null;
}

/** A callback body that verified. Producing one of these is the only way a
 * callback moves a job — an unverified payload cannot be passed where a
 * verified one is expected. */
export interface VerifiedTryOnCallback {
  eventId: string;
  state: ProviderJobState;
  /** The provider's own timestamp for the event. */
  occurredAt: Date;
}

export type TryOnCallbackFailure =
  'missing_signature' | 'bad_signature' | 'stale_timestamp' | 'malformed_payload';

export type TryOnCallbackVerification =
  { ok: true; callback: VerifiedTryOnCallback } | { ok: false; reason: TryOnCallbackFailure };

export interface AITryOnProvider {
  readonly name: TryOnProviderName;
  /** A mock produces no image. The UI says so, and never presents a mock
   * job's outcome as AI output. */
  readonly isMock: boolean;
  /** Whether the provider needs the customer's own photo. No adapter here
   * does, and customer photo upload is not implemented: an adapter that
   * needs one cannot be enabled until that flow (with its own consent,
   * storage and retention) exists. */
  readonly requiresCustomerPhoto: boolean;

  createJob(request: TryOnProviderRequest): Promise<ProviderJobState>;
  /** The provider's current view of a job; null when it does not know it. */
  getJob(providerJobId: string): Promise<ProviderJobState | null>;
  cancelJob(providerJobId: string): Promise<void>;
  /**
   * Verify a raw callback delivery. Takes the raw body text, never a parsed
   * object: a signature covers the exact bytes sent.
   */
  verifyCallback(rawBody: string, headers: Headers): TryOnCallbackVerification;
}

/** A provider call that failed. `retryable` says whether trying again could
 * help (a timeout) or not (a refused request). */
export class TryOnProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`Try-on provider error: ${code}`);
    this.name = 'TryOnProviderError';
  }
}
