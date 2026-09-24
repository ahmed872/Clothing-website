/**
 * Auth.js's own endpoint — CSRF token issuance, the Credentials
 * `/callback/credentials` POST the login form submits to, session reads,
 * sign-out. All request handling lives in `src/modules/identity/auth.ts`;
 * this file only re-exports the two HTTP methods Auth.js's App Router
 * integration expects here.
 */
import { handlers } from '@/modules/identity';

export const { GET, POST } = handlers;
