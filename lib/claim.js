/**
 * The claim flow, from the bridge's side.
 *
 * With no key configured the bridge asks PreReason for access on the person's
 * behalf: it creates a claim, prints one link to stderr, and polls until the
 * person has approved it in a browser. The first poll after approval returns
 * the key once; the bridge saves it and attaches it to the running transport.
 * Meanwhile the free tools keep working, and any AUTH_REQUIRED tool result is
 * prefixed with the approve link so the model can relay it, because a person
 * inside Claude Desktop never sees this process's stderr. If the approval
 * cannot be delivered because the account is at its key limit, the flow stops
 * at once and AUTH_REQUIRED results carry what will clear it instead.
 *
 * Everything that touches the network or the clock is injectable
 * (fetchImpl, sleep, now) so the flow is tested without a server.
 */

import { writeCredentials } from './credentials.js';

export const DEFAULT_POLL_INTERVAL_MS = 5000;
/** Consecutive network failures before the flow gives up for this process. */
export const MAX_CONSECUTIVE_ERRORS = 10;

/** The claims endpoint on the same origin as the MCP endpoint (so PREREASON_URL overrides both). */
export function claimEndpoint(mcpUrl) {
  return new URL('/api/agent/claims', mcpUrl).toString();
}

function parseRetryAfter(headers, fallbackMs) {
  const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallbackMs;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * POST a claim. Resolves { ok: true, claim } or { ok: false, status, retryAfterMs, message }.
 */
export async function createClaim({ mcpUrl, clientName, purpose, requestHeaders = {}, fetchImpl = fetch }) {
  const res = await fetchImpl(claimEndpoint(mcpUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...requestHeaders },
    body: JSON.stringify({ client_name: clientName, purpose }),
  });
  const body = await readJson(res);
  if (res.status === 201 && body && typeof body.claim_code === 'string' && typeof body.claim_token === 'string') {
    return { ok: true, claim: body };
  }
  return {
    ok: false,
    status: res.status,
    retryAfterMs: parseRetryAfter(res.headers, 60_000),
    message: (body && body.message) || `claim request answered ${res.status}`,
  };
}

/**
 * Poll one claim until it settles. Outcomes:
 *   approved   -> { outcome, apiKey, key, account, how_to_use }
 *   key_limit  -> { outcome, activeKeys, maxKeys, message, next }: approved, but no key
 *                 can be issued until the account owner revokes one
 *   delivered  -> the key was collected by another poll of the same token
 *   denied, expired, not_found, gave_up
 */
export async function pollUntilSettled({ claim, requestHeaders = {}, fetchImpl = fetch, sleep = defaultSleep, now = () => Date.now(), onPending = () => {} }) {
  let expiresAt = Date.parse(claim.expires_at);
  const intervalMs = Math.max(1000, (claim.poll?.interval_seconds ?? 5) * 1000);
  const pollUrl = claim.poll?.url ?? `${claimEndpoint(claim.approve_url)}/${claim.claim_code}`;
  let consecutiveErrors = 0;

  while (true) {
    if (Number.isFinite(expiresAt) && now() >= expiresAt) return { outcome: 'expired' };

    let res;
    try {
      res = await fetchImpl(pollUrl, {
        headers: { accept: 'application/json', authorization: `Bearer ${claim.claim_token}`, ...requestHeaders },
      });
    } catch {
      if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return { outcome: 'gave_up' };
      await sleep(intervalMs);
      continue;
    }
    consecutiveErrors = 0;

    if (res.status === 404) return { outcome: 'not_found' };
    if (res.status === 429) {
      await sleep(parseRetryAfter(res.headers, intervalMs));
      continue;
    }
    if (res.status !== 200) {
      if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return { outcome: 'gave_up' };
      await sleep(intervalMs);
      continue;
    }

    const body = await readJson(res);
    switch (body.status) {
      case 'pending': {
        // The approval page can extend the claim; honour the server's clock.
        const fresh = Date.parse(body.expires_at);
        if (Number.isFinite(fresh)) expiresAt = fresh;
        onPending(body);
        await sleep(Math.max(1000, (body.poll_interval ?? intervalMs / 1000) * 1000));
        continue;
      }
      case 'approved': {
        if (typeof body.api_key === 'string') {
          return { outcome: 'approved', apiKey: body.api_key, key: body.key, account: body.account, how_to_use: body.how_to_use };
        }
        // KEY_LIMIT_REACHED is a standing condition, not a failed mint: the server
        // sends no retry_after because polling cannot clear it, only a person
        // revoking a key can. Stop here rather than poll until the claim expires.
        if (body.error === 'KEY_LIMIT_REACHED') {
          return {
            outcome: 'key_limit',
            activeKeys: Number.isFinite(body.active_keys) ? body.active_keys : null,
            maxKeys: Number.isFinite(body.max_keys) ? body.max_keys : null,
            message: typeof body.message === 'string' ? body.message : null,
            next: typeof body.next === 'string' ? body.next : null,
          };
        }
        // KEY_ISSUE_FAILED: the approval stands, the mint is retried on the next poll.
        await sleep(Math.max(1000, (body.retry_after ?? 5) * 1000));
        continue;
      }
      case 'delivered':
        return { outcome: 'delivered' };
      case 'denied':
        return { outcome: 'denied' };
      case 'expired':
        return { outcome: 'expired' };
      default:
        if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return { outcome: 'gave_up' };
        await sleep(intervalMs);
    }
  }
}

/** The one line a person is meant to read. */
export function approvalLine(claim) {
  return `PreReason: no API key found. Open ${claim.approve_url} to approve access (link expires in 15 min).`;
}

/** Where keys are revoked: the Settings page on the same site as the approve link. */
export function accountSettingsUrl(approveUrl) {
  try {
    return new URL('/settings', approveUrl).toString();
  } catch {
    return 'https://www.prereason.com/settings';
  }
}

function keyCount(settled) {
  return Number.isFinite(settled.activeKeys) && Number.isFinite(settled.maxKeys)
    ? `this account already has ${settled.activeKeys} of ${settled.maxKeys} API keys`
    : 'this account is at its API key limit';
}

/** The one line a person reads when an approval cannot be delivered because the account is at its key limit. */
export function keyLimitLine(settled, settingsUrl) {
  return `PreReason: access was approved, but ${keyCount(settled)}, so no new key can be issued. Revoke a key at ${settingsUrl} and restart the bridge to ask again, or set PREREASON_API_KEY to a key you already have. Free tools still work.`;
}

/** What the model relays in place of the approve link once a claim ends at the key limit. */
export function keyLimitNotice(settled, settingsUrl) {
  return `PreReason approved access for this agent, but ${keyCount(settled)}, so no key could be issued. The human who owns this agent must revoke a key at ${settingsUrl} and then restart this bridge, or set PREREASON_API_KEY to a key they already have. `;
}

/**
 * Put `prefix` in front of an AUTH_REQUIRED tool result so the model relays it.
 * Leaves every other message untouched, and never mutates the original.
 */
export function prefixAuthRequired(message, prefix) {
  if (!prefix || !message || typeof message !== 'object') return message;
  const result = message.result;
  if (!result || result.isError !== true || !Array.isArray(result.content)) return message;
  const first = result.content[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return message;
  let payload;
  try {
    payload = JSON.parse(first.text);
  } catch {
    return message;
  }
  if (!payload || payload.error !== 'AUTH_REQUIRED') return message;
  return {
    ...message,
    result: {
      ...result,
      content: [{ ...first, text: prefix + first.text }, ...result.content.slice(1)],
    },
  };
}

/**
 * While a claim is pending, put the approve link in front of any AUTH_REQUIRED
 * tool result so the model relays it. Leaves every other message untouched.
 */
export function decorateAuthRequired(message, approveUrl) {
  if (!approveUrl) return message;
  return prefixAuthRequired(message, `Approve at ${approveUrl} (the human who owns this agent must open it and click Approve; the key arrives here on its own afterwards). `);
}

/**
 * What AUTH_REQUIRED results carry for the claim's current state: the approve
 * link while a claim is pending, the key limit notice once a claim ended there,
 * and nothing otherwise.
 */
export function decorateForClaimState(message, state) {
  if (state && state.approveUrl) return decorateAuthRequired(message, state.approveUrl);
  if (state && state.notice) return prefixAuthRequired(message, state.notice);
  return message;
}

/**
 * The whole flow: create, announce, poll, save, attach. `state.approveUrl` is
 * set while the claim is pending, and `state.notice` once a claim ends at the
 * key limit, so the message decorator can read them.
 * Resolves the poll outcome (or a create failure) and never throws.
 */
export async function runClaimFlow({
  mcpUrl,
  headers,
  clientName,
  purpose,
  credentialsFile,
  requestHeaders = {},
  fetchImpl = fetch,
  sleep = defaultSleep,
  now = () => Date.now(),
  log = (line) => process.stderr.write(`${line}\n`),
  state = {},
}) {
  let created;
  try {
    created = await createClaim({ mcpUrl, clientName, purpose, requestHeaders, fetchImpl });
  } catch (error) {
    log(`PreReason: could not reach ${claimEndpoint(mcpUrl)} to request access (${error?.message ?? 'network error'}). Free tools still work; set PREREASON_API_KEY to skip this step.`);
    return { outcome: 'create_failed' };
  }
  if (!created.ok) {
    const wait = Math.ceil(created.retryAfterMs / 60_000);
    log(`PreReason: access request refused (${created.status}: ${created.message}). Try again in about ${wait} minute${wait === 1 ? '' : 's'}, or set PREREASON_API_KEY. Free tools still work.`);
    return { outcome: 'create_refused', status: created.status };
  }

  const claim = created.claim;
  state.approveUrl = claim.approve_url;
  state.claimCode = claim.claim_code;
  state.notice = null;
  log(approvalLine(claim));

  const settled = await pollUntilSettled({ claim, requestHeaders, fetchImpl, sleep, now });
  state.approveUrl = null;

  if (settled.outcome === 'approved') {
    try {
      writeCredentials(credentialsFile, {
        apiKey: settled.apiKey,
        claimCode: claim.claim_code,
        clientName,
        keyName: settled.key?.name ?? null,
        now: new Date(now()),
      });
      headers.Authorization = `Bearer ${settled.apiKey}`;
      log(`PreReason: access approved. Key "${settled.key?.name ?? 'Agent key'}" saved to ${credentialsFile}; get_context and get_metric work from the next call.`);
    } catch (error) {
      headers.Authorization = `Bearer ${settled.apiKey}`;
      log(`PreReason: access approved and attached for this session, but the key could not be saved to ${credentialsFile} (${error?.message ?? 'write failed'}). Set PREREASON_API_KEY to keep it.`);
    }
    return settled;
  }

  if (settled.outcome === 'key_limit') {
    const settingsUrl = accountSettingsUrl(claim.approve_url);
    state.notice = keyLimitNotice(settled, settingsUrl);
    log(keyLimitLine(settled, settingsUrl));
    return settled;
  }

  const why = {
    expired: 'the link expired before it was approved',
    denied: 'the request was denied',
    delivered: 'the key was collected elsewhere',
    not_found: 'the claim is no longer known to the server',
    gave_up: 'the server could not be reached',
  }[settled.outcome] ?? settled.outcome;
  log(`PreReason: access was not granted (${why}). Restart the bridge to ask again, or set PREREASON_API_KEY. Free tools still work.`);
  return settled;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
