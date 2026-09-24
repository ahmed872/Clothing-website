/**
 * Fixed credentials for the P06 admin e2e fixtures — the single source of
 * truth for both `scripts/seed-e2e-admins.mts` (which creates these
 * accounts) and every `e2e/admin-*.spec.ts` file (which logs in as them).
 * Not real accounts, not shipped in the app — dev/test-only rows in the
 * local database this project's `.env` points at.
 */
export const E2E_OWNER = { email: 'e2e-owner@example.com', password: 'E2eOwnerPass123' };
export const E2E_STAFF = { email: 'e2e-staff@example.com', password: 'E2eStaffPass123' };
export const E2E_DISABLED = { email: 'e2e-disabled@example.com', password: 'E2eDisabledPass123' };

/**
 * A MANAGER, for P14's staff-administration boundary.
 *
 * MANAGER is the sharpest test of `users.manage`: it holds every other
 * admin permission there is, so if the Users section were gated on "is this
 * an admin" rather than on that one permission, this is the account that
 * would slip through. STAFF failing proves much less.
 */
export const E2E_MANAGER = { email: 'e2e-manager@example.com', password: 'E2eManagerPass123' };

/**
 * A second OWNER, for the long acceptance journey.
 *
 * P06's login rate limiter buckets by `ip:email` (10 attempts per 5
 * minutes). Every e2e login in this suite comes from the same loopback
 * address, so a full run's owner logins — the auth spec's deliberate
 * successes and failures, the shared fixture's one per worker, and this
 * journey's own — add up past that budget and the limiter starts refusing,
 * exactly as it should. Splitting the acceptance run onto its own account
 * keeps each bucket honest instead of weakening a real defense to make
 * tests pass.
 */
export const E2E_ACCEPTANCE_OWNER = {
  email: 'e2e-acceptance@example.com',
  password: 'E2eAcceptancePass123',
};

/**
 * A third OWNER, for staff administration (P14).
 *
 * Same reasoning as `E2E_ACCEPTANCE_OWNER` above, one bucket further along.
 * `e2e-owner`'s (ip, email) budget was already close to spent in a full
 * parallel run — five sign-in attempts from `admin-auth.spec.ts` plus one
 * per worker from the shared `ownerContext` fixture, against a limit of ten
 * per five minutes — so a new spec file leaning on the same account is what
 * finally pushes it over, and a rate limiter doing its job then reads as an
 * unrelated accessibility test failing to load a page. Its own account, its
 * own bucket; the limit itself is a real defence and is not being loosened.
 *
 * This account is also what `admin-users-acceptance.spec.ts` asserts the
 * "(you)" row against, so it must be the one that spec signs in as.
 */
export const E2E_USERS_OWNER = {
  email: 'e2e-users-owner@example.com',
  password: 'E2eUsersOwnerPass123',
};

/**
 * A fourth and fifth OWNER, for content and analytics (P15).
 *
 * Same reasoning as `E2E_USERS_OWNER` above, two buckets further along.
 * P06's login rate limiter buckets by `ip:email` at ten attempts per five
 * minutes, every e2e login comes from the same loopback address, and each
 * new spec file that leans on an existing owner account is what pushes that
 * account's bucket over — at which point a rate limiter doing its job reads
 * as an unrelated accessibility test failing to load a page. One account
 * per spec file, one bucket each; the limit itself is a real defence and is
 * not being loosened to make tests pass.
 */
export const E2E_CONTENT_OWNER = {
  email: 'e2e-content-owner@example.com',
  password: 'E2eContentOwnerPass123',
};

export const E2E_ANALYTICS_OWNER = {
  email: 'e2e-analytics-owner@example.com',
  password: 'E2eAnalyticsOwnerPass123',
};

/**
 * A sixth OWNER, for store settings (P15).
 *
 * Same rate-limiter reasoning as every account above it: one spec file, one
 * `ip:email` bucket.
 */
export const E2E_SETTINGS_OWNER = {
  email: 'e2e-settings-owner@example.com',
  password: 'E2eSettingsOwnerPass123',
};
