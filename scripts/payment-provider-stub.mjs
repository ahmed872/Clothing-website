/**
 * A stand-in for a payment provider, for end-to-end tests.
 *
 * ── What this is, and what it is not ──────────────────────────────────────
 * This is the *provider*, not this application. It implements the
 * hosted-checkout contract the P11 adapter speaks — open a session, host a
 * payment page, send a signed webhook, redirect the customer back — so the
 * whole journey can be driven in a browser without a vendor account.
 *
 * It does not fake anything on our side. The webhooks it sends are signed
 * with the real `PAYMENT_WEBHOOK_SECRET` using the real HMAC construction,
 * and the application verifies them with the real verification code. Nothing
 * here can mark a payment paid: it can only produce a delivery that the app
 * either accepts or refuses on its own merits. Point the app's
 * `PAYMENT_API_BASE_URL` at a vendor sandbox instead and the same tests
 * exercise the same paths.
 *
 * Run with: node scripts/payment-provider-stub.mjs
 */

import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

const PORT = Number(new URL(process.env.PAYMENT_API_BASE_URL ?? 'http://127.0.0.1:4011').port);
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000';

if (!SECRET) {
  console.error('payment stub: PAYMENT_WEBHOOK_SECRET is not set');
  process.exit(1);
}

/** id → session */
const sessions = new Map();

/**
 * A real provider's session id is never reused, ever — that is exactly what
 * `payments_provider_provider_reference_key` in the schema counts on. An
 * in-memory counter starting at 1 does not have that property: restart this
 * process against the same (persistent) dev database and its first "new"
 * session collides with a row a previous run already left behind, which
 * surfaces as a real unique-constraint violation that has nothing to do with
 * the application under test. `randomUUID()` gives this stub the one
 * property a provider actually guarantees.
 */
function nextSessionId() {
  return `sess_stub_${randomUUID()}`;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** The same construction the application verifies: HMAC-SHA256 over
 * "<unix seconds>.<raw body>", carried in `t=…,v1=…`. */
function sign(rawBody, now = new Date()) {
  const t = Math.floor(now.getTime() / 1000);
  const v1 = createHmac('sha256', SECRET).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

async function deliverWebhook(session, status, extra = {}) {
  const body = JSON.stringify({
    event_id: `evt_${session.id}_${status}_${Date.now()}`,
    event_type: `payment.${status}`,
    id: session.id,
    status,
    occurred_at: new Date().toISOString(),
    amount: session.amount,
    currency: session.currency,
    ...extra,
  });

  const response = await fetch(`${APP_URL}/api/payments/webhook/hosted_checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-payment-signature': sign(body) },
    body,
  });
  return { status: response.status, body };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // --- the provider's API ---------------------------------------------------
  if (url.pathname === '/payment-sessions' && req.method === 'POST') {
    const payload = JSON.parse((await readBody(req)) || '{}');
    const id = nextSessionId();
    const session = {
      id,
      status: 'created',
      amount: payload.amount,
      currency: payload.currency,
      reference: payload.reference,
      client_reference: payload.client_reference,
      return_url: payload.return_url,
      checkout_url: `http://127.0.0.1:${PORT}/pay/${id}`,
    };
    sessions.set(id, session);
    return json(res, 201, session);
  }

  const get = /^\/payment-sessions\/([^/]+)$/.exec(url.pathname);
  if (get && req.method === 'GET') {
    const session = sessions.get(decodeURIComponent(get[1]));
    if (!session) return json(res, 404, { error: 'not_found' });
    return json(res, 200, session);
  }

  // --- the provider's hosted payment page -----------------------------------
  const pay = /^\/pay\/([^/]+)$/.exec(url.pathname);
  if (pay && req.method === 'GET') {
    const session = sessions.get(decodeURIComponent(pay[1]));
    if (!session) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('no such session');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Stub payment provider</title></head>
<body style="font-family:system-ui;padding:2rem;max-width:32rem">
  <h1>Stub payment provider</h1>
  <p>Not a real payment page. Amount: <b id="amount">${session.amount}</b> ${session.currency}</p>
  <form method="POST" action="/pay/${session.id}/complete">
    <button name="outcome" value="paid" type="submit">Approve payment</button>
    <button name="outcome" value="failed" type="submit">Decline payment</button>
  </form>
</body></html>`);
  }

  const complete = /^\/pay\/([^/]+)\/complete$/.exec(url.pathname);
  if (complete && req.method === 'POST') {
    const session = sessions.get(decodeURIComponent(complete[1]));
    if (!session) return json(res, 404, { error: 'not_found' });
    const form = new URLSearchParams(await readBody(req));
    const outcome = form.get('outcome') === 'paid' ? 'paid' : 'failed';
    session.status = outcome;
    if (outcome === 'failed') {
      session.failure_code = 'card_declined';
      session.failure_message = 'The stub declined this payment';
    }

    await deliverWebhook(
      session,
      outcome,
      outcome === 'failed'
        ? { failure_code: session.failure_code, failure_message: session.failure_message }
        : {},
    );

    // The customer comes back with no proof of anything — deliberately no
    // status in the query string, because the application must not read one.
    res.writeHead(302, { location: session.return_url });
    return res.end();
  }

  // --- test controls, for deliveries a browser cannot produce ---------------
  // Replays, stale events and forged signatures, driven from a spec.
  if (url.pathname === '/__test/deliver' && req.method === 'POST') {
    const payload = JSON.parse((await readBody(req)) || '{}');
    const session = sessions.get(payload.sessionId);
    if (!session) return json(res, 404, { error: 'not_found' });

    const body = JSON.stringify({
      event_id: payload.eventId,
      event_type: `payment.${payload.status}`,
      id: session.id,
      status: payload.status,
      occurred_at: payload.occurredAt ?? new Date().toISOString(),
      amount: payload.amount ?? session.amount,
      currency: payload.currency ?? session.currency,
    });

    const signature = payload.forgeSignature
      ? 't=1,v1=0000000000000000000000000000000000000000000000000000000000000000'
      : sign(body);

    const response = await fetch(`${APP_URL}/api/payments/webhook/hosted_checkout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(payload.omitSignature ? {} : { 'x-payment-signature': signature }),
      },
      body,
    });
    return json(res, 200, { delivered: response.status });
  }

  if (url.pathname === '/__test/health') return json(res, 200, { ok: true });

  return json(res, 404, { error: 'not_found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`payment provider stub listening on http://127.0.0.1:${PORT}`);
});
