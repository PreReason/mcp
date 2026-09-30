import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  accountSettingsUrl,
  approvalLine,
  claimEndpoint,
  createClaim,
  decorateAuthRequired,
  decorateForClaimState,
  keyLimitLine,
  keyLimitNotice,
  pollUntilSettled,
  runClaimFlow,
} from '../lib/claim.js';

const MCP_URL = 'https://api.example.test/api/mcp';
const TOKEN = `prc_${'a'.repeat(43)}`;
const KEY = `pr_live_${'k'.repeat(32)}`;

function claimBody(overrides = {}) {
  return {
    claim_code: 'PR-ABCD-2345',
    claim_token: TOKEN,
    status: 'pending',
    approve_url: 'https://www.example.test/claim/PR-ABCD-2345',
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    expires_in: 900,
    poll: { url: 'https://api.example.test/api/agent/claims/PR-ABCD-2345', method: 'GET', header: 'Authorization: Bearer <claim_token>', interval_seconds: 5 },
    ...overrides,
  };
}

/** The server's KeyLimitReachedView (src/lib/auth/agent-claims.ts): approved, no key, and no retry_after. */
function keyLimitBody(overrides = {}) {
  return {
    status: 'approved',
    claim_code: 'PR-ABCD-2345',
    error: 'KEY_LIMIT_REACHED',
    message: 'This account has 2 active keys and allows 2. The approval stands, but no key can be issued until one is revoked. Polling alone will not clear this.',
    active_keys: 2,
    max_keys: 2,
    next: 'Ask the account owner to revoke a key under Settings, then poll once more.',
    docs: 'https://www.prereason.com/docs#agent-access',
    ...overrides,
  };
}

/** A fetch stub that answers from a queue and records every call. */
function fakeFetch(replies) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = replies.shift();
    if (!next) throw new Error('fakeFetch: no reply queued');
    if (next instanceof Error) throw next;
    const { status = 200, body = {}, headers = {} } = next;
    return { status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

const noSleep = async () => {};

test('claimEndpoint is /api/agent/claims on the MCP endpoint origin', () => {
  assert.equal(claimEndpoint(MCP_URL), 'https://api.example.test/api/agent/claims');
  assert.equal(claimEndpoint('https://staging.example.test:8443/api/mcp'), 'https://staging.example.test:8443/api/agent/claims');
});

test('createClaim posts the client name and purpose with the bridge headers', async () => {
  const fetchImpl = fakeFetch([{ status: 201, body: claimBody() }]);
  const result = await createClaim({ mcpUrl: MCP_URL, clientName: '@prereason/mcp 0.4.0 (linux)', purpose: 'MCP bridge for claude-desktop', requestHeaders: { 'user-agent': 'prereason-mcp/0.4.0', 'x-prereason-client': 'claude-desktop' }, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.claim.claim_code, 'PR-ABCD-2345');
  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://api.example.test/api/agent/claims');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['user-agent'], 'prereason-mcp/0.4.0');
  assert.equal(call.init.headers['x-prereason-client'], 'claude-desktop');
  assert.deepEqual(JSON.parse(call.init.body), { client_name: '@prereason/mcp 0.4.0 (linux)', purpose: 'MCP bridge for claude-desktop' });
});

test('createClaim reports a refusal with the Retry-After', async () => {
  const fetchImpl = fakeFetch([{ status: 429, body: { error: 'RATE_LIMITED', message: 'At most 5 claims an hour.' }, headers: { 'retry-after': '120' } }]);
  const result = await createClaim({ mcpUrl: MCP_URL, clientName: 'x', fetchImpl });
  assert.deepEqual(result, { ok: false, status: 429, retryAfterMs: 120_000, message: 'At most 5 claims an hour.' });
});

test('pollUntilSettled polls with the claim token until approved, then returns the key once', async () => {
  const fetchImpl = fakeFetch([
    { status: 200, body: { status: 'pending', poll_interval: 5, expires_at: claimBody().expires_at } },
    { status: 200, body: { status: 'pending', poll_interval: 5, expires_at: claimBody().expires_at } },
    { status: 200, body: { status: 'approved', api_key: KEY, delivered_once: true, key: { id: 'k1', name: 'Agent: x', prefix: 'pr_live_kkkk', scopes: ['read'] }, account: { tier: 'free' } } },
  ]);
  const sleeps = [];
  const result = await pollUntilSettled({ claim: claimBody(), fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(result.outcome, 'approved');
  assert.equal(result.apiKey, KEY);
  assert.equal(result.key.name, 'Agent: x');
  assert.equal(fetchImpl.calls.length, 3);
  for (const call of fetchImpl.calls) {
    assert.equal(call.url, 'https://api.example.test/api/agent/claims/PR-ABCD-2345');
    assert.equal(call.init.headers.authorization, `Bearer ${TOKEN}`);
  }
  assert.deepEqual(sleeps, [5000, 5000]);
});

test('pollUntilSettled stops when the claim expires, without another request', async () => {
  const fetchImpl = fakeFetch([]);
  const result = await pollUntilSettled({ claim: claimBody({ expires_at: new Date(Date.now() - 1000).toISOString() }), fetchImpl, sleep: noSleep });
  assert.equal(result.outcome, 'expired');
  assert.equal(fetchImpl.calls.length, 0);
});

test('pollUntilSettled honours an extended expiry the server reports, and stops on the server saying expired', async () => {
  const start = Date.now();
  let clock = start;
  const soon = new Date(start + 4000).toISOString();
  const later = new Date(start + 60_000).toISOString();
  const fetchImpl = fakeFetch([
    { status: 200, body: { status: 'pending', poll_interval: 1, expires_at: later } },
    { status: 200, body: { status: 'expired' } },
  ]);
  const result = await pollUntilSettled({
    claim: claimBody({ expires_at: soon }),
    fetchImpl,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  });
  assert.equal(result.outcome, 'expired');
  assert.equal(fetchImpl.calls.length, 2, 'the second poll happens because the server extended the claim');
});

test('pollUntilSettled: denied, delivered and not found end the loop; KEY_ISSUE_FAILED and 429 keep it going', async () => {
  for (const [reply, outcome] of [
    [{ status: 200, body: { status: 'denied' } }, 'denied'],
    [{ status: 200, body: { status: 'delivered' } }, 'delivered'],
    [{ status: 404, body: { error: 'CLAIM_NOT_FOUND' } }, 'not_found'],
  ]) {
    const fetchImpl = fakeFetch([reply]);
    assert.equal((await pollUntilSettled({ claim: claimBody(), fetchImpl, sleep: noSleep })).outcome, outcome);
  }
  const sleeps = [];
  const fetchImpl = fakeFetch([
    { status: 429, body: {}, headers: { 'retry-after': '2' } },
    { status: 200, body: { status: 'approved', error: 'KEY_ISSUE_FAILED', retry_after: 5 } },
    { status: 200, body: { status: 'approved', api_key: KEY, key: { name: 'Agent: x' } } },
  ]);
  const result = await pollUntilSettled({ claim: claimBody(), fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(result.outcome, 'approved');
  assert.deepEqual(sleeps, [2000, 5000]);
});

test('pollUntilSettled: KEY_LIMIT_REACHED ends the loop on the first answer, with the counts, and never sleeps', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: keyLimitBody() }]);
  const sleeps = [];
  const result = await pollUntilSettled({ claim: claimBody(), fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(result.outcome, 'key_limit');
  assert.equal(result.activeKeys, 2);
  assert.equal(result.maxKeys, 2);
  assert.equal(result.next, keyLimitBody().next);
  assert.equal(fetchImpl.calls.length, 1, 'one poll, not one every five seconds until the claim expires');
  assert.deepEqual(sleeps, []);
});

test('pollUntilSettled gives up after ten consecutive network failures', async () => {
  const fetchImpl = fakeFetch(Array.from({ length: 10 }, () => new Error('ECONNRESET')));
  const result = await pollUntilSettled({ claim: claimBody(), fetchImpl, sleep: noSleep });
  assert.equal(result.outcome, 'gave_up');
});

test('decorateAuthRequired prefixes only an AUTH_REQUIRED tool error, only while a claim is pending', () => {
  const authRequired = { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'AUTH_REQUIRED', message: 'Sign up free' }) }] } };
  const decorated = decorateAuthRequired(authRequired, 'https://www.example.test/claim/PR-ABCD-2345');
  assert.ok(decorated.result.content[0].text.startsWith('Approve at https://www.example.test/claim/PR-ABCD-2345'));
  assert.ok(decorated.result.content[0].text.endsWith(authRequired.result.content[0].text));
  assert.notEqual(decorated, authRequired, 'the original message is not mutated');
  assert.equal(authRequired.result.content[0].text.startsWith('Approve'), false);

  assert.equal(decorateAuthRequired(authRequired, null), authRequired);
  const otherError = { jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'NOT_FOUND' }) }] } };
  assert.equal(decorateAuthRequired(otherError, 'https://x'), otherError);
  const success = { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: '{"count":18}' }] } };
  assert.equal(decorateAuthRequired(success, 'https://x'), success);
  const plain = { jsonrpc: '2.0', id: 4, result: { isError: true, content: [{ type: 'text', text: 'not json' }] } };
  assert.equal(decorateAuthRequired(plain, 'https://x'), plain);
});

test('approvalLine is the one line a person reads', () => {
  assert.equal(approvalLine(claimBody()), 'PreReason: no API key found. Open https://www.example.test/claim/PR-ABCD-2345 to approve access (link expires in 15 min).');
});

test('runClaimFlow: announces the link, saves the key, attaches it to the headers, and never writes the token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prereason-mcp-'));
  const credentialsFile = join(dir, 'credentials.json');
  const fetchImpl = fakeFetch([
    { status: 201, body: claimBody() },
    { status: 200, body: { status: 'pending', poll_interval: 5, expires_at: claimBody().expires_at } },
    { status: 200, body: { status: 'approved', api_key: KEY, key: { name: 'Agent: @prereason/mcp 0.4.0 (test)' } } },
  ]);
  const headers = { 'User-Agent': 'prereason-mcp/0.4.0' };
  const lines = [];
  const state = {};
  const seenWhilePending = [];
  const result = await runClaimFlow({
    mcpUrl: MCP_URL, headers, clientName: '@prereason/mcp 0.4.0 (test)', purpose: 'test', credentialsFile, fetchImpl,
    sleep: async () => { seenWhilePending.push(state.approveUrl); },
    log: (line) => lines.push(line), state,
  });
  assert.equal(result.outcome, 'approved');
  assert.equal(headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(seenWhilePending, ['https://www.example.test/claim/PR-ABCD-2345'], 'the approve link is exposed while pending');
  assert.equal(state.approveUrl, null, 'and cleared once settled');
  assert.ok(lines[0].startsWith('PreReason: no API key found. Open https://www.example.test/claim/PR-ABCD-2345'));
  assert.match(lines[1], /access approved/);
  const saved = readFileSync(credentialsFile, 'utf8');
  assert.ok(saved.includes(KEY));
  assert.ok(!saved.includes(TOKEN), 'the claim token never touches the disk');
  assert.ok(!saved.includes('prc_'));
});

test('runClaimFlow: a refused claim logs once and leaves nothing behind', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prereason-mcp-'));
  const credentialsFile = join(dir, 'credentials.json');
  const fetchImpl = fakeFetch([{ status: 503, body: { error: 'CLAIM_CAPACITY', message: 'Too many claims are waiting.' }, headers: { 'retry-after': '300' } }]);
  const headers = {};
  const lines = [];
  const result = await runClaimFlow({ mcpUrl: MCP_URL, headers, clientName: 'x', credentialsFile, fetchImpl, sleep: noSleep, log: (l) => lines.push(l) });
  assert.equal(result.outcome, 'create_refused');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /about 5 minutes/);
  assert.equal(headers.Authorization, undefined);
  assert.equal(existsSync(credentialsFile), false);
});

test('runClaimFlow: an expired claim logs why and keeps the headers clean', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prereason-mcp-'));
  const fetchImpl = fakeFetch([{ status: 201, body: claimBody() }, { status: 200, body: { status: 'expired' } }]);
  const headers = {};
  const lines = [];
  const result = await runClaimFlow({ mcpUrl: MCP_URL, headers, clientName: 'x', credentialsFile: join(dir, 'c.json'), fetchImpl, sleep: noSleep, log: (l) => lines.push(l) });
  assert.equal(result.outcome, 'expired');
  assert.match(lines[1], /link expired/);
  assert.equal(headers.Authorization, undefined);
});

test('runClaimFlow: at the key limit it logs one line with the counts, saves and attaches nothing, and leaves a notice for the tool results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prereason-mcp-'));
  const credentialsFile = join(dir, 'credentials.json');
  const fetchImpl = fakeFetch([
    { status: 201, body: claimBody() },
    { status: 200, body: { status: 'pending', poll_interval: 5, expires_at: claimBody().expires_at } },
    { status: 200, body: keyLimitBody() },
  ]);
  const headers = {};
  const lines = [];
  const state = {};
  const result = await runClaimFlow({ mcpUrl: MCP_URL, headers, clientName: 'x', credentialsFile, fetchImpl, sleep: noSleep, log: (l) => lines.push(l), state });
  assert.equal(result.outcome, 'key_limit');
  assert.equal(lines.length, 2, 'the approve link, then exactly one line about the limit');
  assert.equal(
    lines[1],
    'PreReason: access was approved, but this account already has 2 of 2 API keys, so no new key can be issued. Revoke a key at https://www.example.test/settings and restart the bridge to ask again, or set PREREASON_API_KEY to a key you already have. Free tools still work.',
  );
  assert.equal(headers.Authorization, undefined);
  assert.equal(existsSync(credentialsFile), false);
  assert.equal(state.approveUrl, null, 'the approve link is gone');
  assert.match(state.notice, /2 of 2 API keys/, 'and the notice takes its place');
  assert.match(state.notice, /https:\/\/www\.example\.test\/settings/);
});

test('decorateForClaimState: the approve link while pending, the key limit notice after, nothing otherwise', () => {
  const authRequired = { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'AUTH_REQUIRED', message: 'Sign up free' }) }] } };

  const whilePending = decorateForClaimState(authRequired, { approveUrl: 'https://www.example.test/claim/PR-ABCD-2345', notice: null });
  assert.ok(whilePending.result.content[0].text.startsWith('Approve at https://www.example.test/claim/PR-ABCD-2345'));

  const notice = keyLimitNotice({ activeKeys: 2, maxKeys: 2 }, 'https://www.example.test/settings');
  const atLimit = decorateForClaimState(authRequired, { approveUrl: null, notice });
  assert.ok(atLimit.result.content[0].text.startsWith('PreReason approved access for this agent, but this account already has 2 of 2 API keys'));
  assert.ok(atLimit.result.content[0].text.includes('revoke a key at https://www.example.test/settings'));
  assert.ok(atLimit.result.content[0].text.endsWith(authRequired.result.content[0].text));
  assert.equal(authRequired.result.content[0].text.startsWith('PreReason'), false, 'the original message is not mutated');

  const otherError = { jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'NOT_FOUND' }) }] } };
  assert.equal(decorateForClaimState(otherError, { approveUrl: null, notice }), otherError);
  assert.equal(decorateForClaimState(authRequired, { approveUrl: null, notice: null }), authRequired);
  assert.equal(decorateForClaimState(authRequired, undefined), authRequired);
});

test('the key limit wording falls back when the server sends no counts, and the settings link follows the approve link', () => {
  assert.equal(accountSettingsUrl('https://www.prereason.com/claim/PR-ABCD-2345'), 'https://www.prereason.com/settings');
  assert.equal(accountSettingsUrl('not a url'), 'https://www.prereason.com/settings');
  assert.equal(
    keyLimitLine({ activeKeys: null, maxKeys: null }, 'https://www.prereason.com/settings'),
    'PreReason: access was approved, but this account is at its API key limit, so no new key can be issued. Revoke a key at https://www.prereason.com/settings and restart the bridge to ask again, or set PREREASON_API_KEY to a key you already have. Free tools still work.',
  );
});
