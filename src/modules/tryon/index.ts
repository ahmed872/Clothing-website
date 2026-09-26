/**
 * Optional AI try-on (clothing P05). The store works in full without it;
 * see `provider-factory.ts` for how a provider is switched on.
 */
export {
  TryOnProviderError,
  type AITryOnProvider,
  type ProviderJobState,
  type ProviderJobStatus,
  type TryOnBody,
  type TryOnCallbackFailure,
  type TryOnCallbackVerification,
  type TryOnGarment,
  type TryOnProviderName,
  type TryOnProviderRequest,
  type VerifiedTryOnCallback,
} from './provider';

export {
  MOCK_PROCESSING_MS,
  TRYON_SIGNATURE_HEADER,
  createMockTryOnProvider,
} from './mock-provider';

export { MAX_RESULT_URL_LENGTH, isAllowedResultUrl, parseResultHosts } from './result-url';

export {
  getTryOnConfig,
  isTryOnEnabled,
  resetTryOnConfigCache,
  type TryOnConfig,
} from './provider-factory';

export {
  TRYON_LIMITS,
  applyTryOnCallback,
  cancelTryOnJob,
  createTryOnJob,
  expireTryOnJobs,
  getLatestTryOnJob,
  getTryOnJob,
  retryTryOnJob,
  toTryOnJobView,
  tryOnRequestHash,
  type TryOnCallbackOutcome,
  type TryOnContext,
  type TryOnJobView,
  type TryOnSubject,
} from './tryon-job.service';
