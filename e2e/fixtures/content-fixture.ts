/**
 * The marker every homepage section created by `admin-content-acceptance`
 * carries in its English title — the single source of truth for both the
 * spec and `scripts/cleanup-e2e-content.mts`, which removes them.
 *
 * The suite runs `fullyParallel` against one shared database and the
 * storefront homepage is *global* state: a section this spec leaves behind
 * is not merely stale data, it renders on `/ar` and `/en` for every other
 * spec that loads them. So the sections are marked, and cleaned up before
 * and after the run rather than only in the happy path of each test.
 */
export const E2E_CONTENT_TITLE_MARKER = 'E2E-P15';
