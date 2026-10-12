import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONNECT_INSTRUCTIONS,
  CONNECT_TOOL,
  CONNECT_TOOL_NAME,
  Connection,
  isAuthRequired,
  isKeyRefusal,
  planName,
  readHealth,
  toolResult,
  withConnectInstructions,
  withConnectTool,
} from '../lib/connect.js';
import { StreamableHttpError } from '../lib/streamable-http.js';

const MCP_URL = 'https://api.example.test/api/mcp';
const CLAIMS = 'https://api.example.test/api/agent/claims';
const APPROVE = 'https://www.example.test/claim/PR-ABCD-2341';
const KEY = `pr_live_${'k'.repeat(32)}`;
const OTHER = `pr_live_${'o'.repeat(32)}`;
const KEY_SHAPE = /pr_(?:live|test)_/;
/** An em dash, built from its code so this file holds none (copy carries no em dashes). */
const EM_DASH = new RegExp(String.fromCharCode(0x2014));

const AUTH_REQUIRED = {
  jsonrpc: '2.0',
  id: 7,
  result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'AUTH_REQUIRED', message: 'Reading a briefing needs an API key.' }) }] },
};

function claimBody(n = 1) {
  return {
    claim_code: `PR-ABCD-234${n}`,
    claim_token: `prc_${String(n).repeat(43)}`,
    status: 'pending',
    approve_url: `https://www.example.test/claim/PR-ABCD-234${n}`,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    poll: { url: `${CLAIMS}/PR-ABCD-234${n}`, interval_seconds: 5 },
  };
}

/**
 * A stand in for the claims endpoint: POST creates (from `creates`, in order),
 * GET answers the poll (from `polls`, the last one repeating). Every call is kept.
 */
function claimsServer({ creates = [{ status: 201, body: claimBody(1) }], polls = [{ status: 200, body: { status: 'pending' } }] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url: String(url), method });
    let reply;
    if (method === 'POST') {
      reply = creates.shift();
      if (!reply) throw new Error('claimsServer: no create queued');
      if (reply instanceof Error) throw reply;
    } else {
      reply = polls.length > 1 ? polls.shift() : polls[0];
    }
    const { status = 200, body = {}, headers = {} } = reply;
    return { status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body };
  };
  fetchImpl.calls = calls;
  fetchImpl.creates = () => calls.filter((c) => c.method === 'POST').length;
  return fetchImpl;
}

/** A poll sleep the test releases by hand, so a pending claim stays pending. */
function heldSleep() {
  const waiting = [];
  const sleep = () => new Promise((resolve) => waiting.push(resolve));
  sleep.release = () => waiting.splice(0).forEach((resolve) => resolve());
  return sleep;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function connection(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'prereason-connect-'));
  const lines = [];
  const headers = overrides.headers ?? { 'User-Agent': 'prereason-mcp/0.6.0 node/test' };
  const conn = new Connection({
    headers,
    mcpUrl: MCP_URL,
    clientName: '@prereason/mcp 0.6.0 (test)',
    purpose: 'MCP bridge for node-test',
    credentialsFile: join(dir, 'credentials.json'),
    log: (line) => lines.push(line),
    sleep: heldSleep(),
    ...overrides,
  });
  return { conn, headers, lines, dir, file: join(dir, 'credentials.json') };
}

test('the tool is listed after the server tools, once, and says it shows no key', () => {
  const page = { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'list_briefings' }, { name: 'get_context' }] } };
  const listed = withConnectTool(page);
  assert.deepEqual(listed.result.tools.map((t) => t.name), ['list_briefings', 'get_context', CONNECT_TOOL_NAME]);
  assert.deepEqual(withConnectTool(listed), listed, 'listed twice');
  assert.deepEqual(page.result.tools.length, 2, 'the original answer is not changed');
  // A page with no tools array (another method, an error) passes untouched.
  assert.deepEqual(withConnectTool({ jsonrpc: '2.0', id: 3, error: { code: -1, message: 'x' } }), { jsonrpc: '2.0', id: 3, error: { code: -1, message: 'x' } });
  assert.equal(CONNECT_TOOL.annotations.readOnlyHint, false, 'it asks PreReason for access, so it is not read only');
  assert.match(CONNECT_TOOL.description, /No key is ever shown/);
  assert.doesNotMatch(JSON.stringify(CONNECT_TOOL), EM_DASH);
});

test('initialize carries the server instructions, then the connect sentence, once', () => {
  const answer = { jsonrpc: '2.0', id: 1, result: { instructions: 'PreReason returns financial market briefings.' } };
  const added = withConnectInstructions(answer);
  assert.equal(added.result.instructions, `PreReason returns financial market briefings. ${CONNECT_INSTRUCTIONS}`);
  assert.deepEqual(withConnectInstructions(added), added);
  assert.equal(withConnectInstructions({ jsonrpc: '2.0', id: 1, result: {} }).result.instructions, CONNECT_INSTRUCTIONS);
});

test('isAuthRequired reads only an AUTH_REQUIRED tool error; isKeyRefusal only a 401 INVALID_API_KEY', () => {
  assert.equal(isAuthRequired(AUTH_REQUIRED), true);
  assert.equal(isAuthRequired({ result: { isError: true, content: [{ type: 'text', text: '{"error":"TIER_RESTRICTED"}' }] } }), false);
  assert.equal(isAuthRequired({ result: { content: [{ type: 'text', text: '{"error":"AUTH_REQUIRED"}' }] } }), false, 'not an error');
  assert.equal(isKeyRefusal(new StreamableHttpError(401, 'x', '{"error":"INVALID_API_KEY","message":"Invalid API key"}')), true);
  assert.equal(isKeyRefusal(new StreamableHttpError(401, 'x', '{"jsonrpc":"2.0","error":{"code":-32001}}')), false);
  assert.equal(isKeyRefusal(new StreamableHttpError(429, 'x', '{"error":"INVALID_API_KEY"}')), false);
});

test('nothing is asked of PreReason until a claim is needed', async () => {
  const fetchImpl = claimsServer();
  const { conn } = connection({ fetchImpl });
  await tick();
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(conn.status, 'none');
  // An answer that does not need a key passes untouched and asks for nothing.
  const plain = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{}' }] } };
  assert.deepEqual(conn.decorate(plain), plain);
});

test('an answer that needs a key starts one claim and carries its link; a second answer reuses it', async () => {
  const fetchImpl = claimsServer();
  const { conn } = connection({ fetchImpl });
  await conn.ensureClaim();
  assert.equal(conn.status, 'pending');
  const decorated = conn.decorate(AUTH_REQUIRED);
  assert.match(decorated.result.content[0].text, new RegExp(`^Approve at ${APPROVE} `));
  await conn.ensureClaim();
  assert.equal(fetchImpl.creates(), 1, 'one claim, not one per answer');
});

test('connect_account with no key returns the approve link, and no key', async () => {
  const fetchImpl = claimsServer();
  const { conn } = connection({ fetchImpl });
  const answer = await conn.connect();
  assert.equal(answer.isError, false);
  assert.match(answer.text, /^Not connected yet\. Ask the user to open this link: https:\/\/www\.example\.test\/claim\/PR-ABCD-2341\n/);
  assert.match(answer.text, /click Approve/);
  assert.match(answer.text, /about 15 minutes/);
  assert.doesNotMatch(answer.text, KEY_SHAPE);
  assert.doesNotMatch(answer.text, EM_DASH);
  assert.equal(fetchImpl.creates(), 1);
});

test('after the approval, connect_account confirms the account and names its plan; the key is saved, never shown', async () => {
  const sleep = heldSleep();
  const fetchImpl = claimsServer({
    polls: [
      { status: 200, body: { status: 'pending' } },
      { status: 200, body: { status: 'approved', api_key: KEY, key: { id: 'k1', name: 'Agent: x' }, account: { tier: 'pro' } } },
    ],
  });
  let verified = 0;
  const { conn, headers, file } = connection({
    fetchImpl,
    sleep,
    verify: async () => {
      verified += 1;
      return { authenticated: headers.Authorization === `Bearer ${KEY}`, tier: 'pro' };
    },
  });
  await conn.connect();
  await tick();
  sleep.release();
  for (let i = 0; i < 20 && conn.status !== 'approved'; i++) await tick();
  assert.equal(conn.status, 'approved');
  assert.equal(headers.Authorization, `Bearer ${KEY}`);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).api_key, KEY);

  const answer = await conn.connect();
  assert.equal(answer.isError, false);
  assert.match(answer.text, /^Connected: this assistant reads PreReason with the user's account, on the Pro plan\./);
  assert.match(answer.text, /saved on this computer/);
  assert.doesNotMatch(answer.text, KEY_SHAPE);
  assert.equal(verified, 1);
  assert.equal(fetchImpl.creates(), 1, 'no second claim once connected');
});

test('connect_account looks at a pending claim at once, so an approval just made is seen without waiting for the poll', async () => {
  const fetchImpl = claimsServer({
    polls: [
      { status: 200, body: { status: 'pending' } },
      { status: 200, body: { status: 'approved', api_key: KEY, key: { name: 'Agent: x' } } },
    ],
  });
  // The real sleep (none injected): five seconds between polls, cut short by connect_account.
  const { conn } = connection({ fetchImpl, sleep: null, verify: async () => ({ authenticated: true, tier: 'free' }) });
  await conn.connect();
  const started = Date.now();
  const answer = await conn.connect();
  assert.ok(Date.now() - started < 3000, `waited ${Date.now() - started} ms`);
  assert.match(answer.text, /^Connected: .* on the Free plan\./);
});

test('a link that lapsed is asked for again on the next need, with no restart', async () => {
  const fetchImpl = claimsServer({
    creates: [
      { status: 201, body: claimBody(1) },
      { status: 201, body: claimBody(2) },
    ],
    polls: [{ status: 200, body: { status: 'expired' } }],
  });
  const { conn } = connection({ fetchImpl, sleep: async () => {} });
  await conn.ensureClaim();
  for (let i = 0; i < 20 && conn.status !== 'ended'; i++) await tick();
  assert.equal(conn.status, 'ended');
  assert.deepEqual(conn.decorate(AUTH_REQUIRED), AUTH_REQUIRED, 'no stale link');
  assert.equal(fetchImpl.creates(), 1);
  await conn.ensureClaim();
  assert.equal(fetchImpl.creates(), 2, 'the next need makes one new claim');
});

test('a declined approval is not asked again by an answer that needs a key, only by the person asking to connect', async () => {
  const fetchImpl = claimsServer({
    creates: [
      { status: 201, body: claimBody(1) },
      { status: 201, body: claimBody(2) },
    ],
    polls: [{ status: 200, body: { status: 'denied' } }, { status: 200, body: { status: 'pending' } }],
  });
  const sleep = heldSleep();
  const { conn } = connection({ fetchImpl, sleep });
  await conn.ensureClaim();
  for (let i = 0; i < 20 && conn.status !== 'denied'; i++) await tick();
  assert.equal(conn.status, 'denied');
  await conn.ensureClaim();
  assert.equal(fetchImpl.creates(), 1, 'an answer that needs a key does not overrule a person who declined');
  assert.match(conn.decorate(AUTH_REQUIRED).result.content[0].text, /^Access to PreReason was declined/);

  const answer = await conn.connect();
  assert.equal(fetchImpl.creates(), 2, 'asking to connect asks again');
  assert.match(answer.text, /PR-ABCD-2342/);
});

test('a refused claim waits out its Retry-After before asking again', async () => {
  let clock = 1_000_000;
  const fetchImpl = claimsServer({
    creates: [
      { status: 429, body: { message: 'At most 5 claims an hour.' }, headers: { 'retry-after': '120' } },
      { status: 201, body: claimBody(1) },
    ],
  });
  const { conn } = connection({ fetchImpl, now: () => clock });
  const answer = await conn.connect();
  assert.equal(answer.isError, true);
  assert.match(answer.text, /At most 5 claims an hour\..*about 2 minutes/);
  await conn.ensureClaim({ explicit: true });
  assert.equal(fetchImpl.creates(), 1, 'not before the wait');
  clock += 121_000;
  await conn.ensureClaim();
  assert.equal(fetchImpl.creates(), 2);
  assert.equal(conn.status, 'pending');
});

test('at the key limit the answer says what to revoke, and asking to connect again makes a new claim', async () => {
  const fetchImpl = claimsServer({
    creates: [
      { status: 201, body: claimBody(1) },
      { status: 201, body: claimBody(2) },
    ],
    polls: [{ status: 200, body: { status: 'approved', error: 'KEY_LIMIT_REACHED', active_keys: 2, max_keys: 2 } }, { status: 200, body: { status: 'pending' } }],
  });
  const { conn } = connection({ fetchImpl, sleep: heldSleep() });
  await conn.ensureClaim();
  for (let i = 0; i < 20 && conn.status !== 'key_limit'; i++) await tick();
  assert.equal(conn.status, 'key_limit');
  const text = conn.decorate(AUTH_REQUIRED).result.content[0].text;
  assert.match(text, /^The user approved access, but this account already has 2 of 2 API keys/);
  assert.match(text, /https:\/\/www\.example\.test\/settings/);
  await conn.ensureClaim();
  assert.equal(fetchImpl.creates(), 1);
  await conn.connect();
  assert.equal(fetchImpl.creates(), 2);
});

test('a refused saved key is set aside for the session, the next source is tried, and with none left the person can connect again', async () => {
  const fetchImpl = claimsServer();
  const { conn, headers, lines, file } = connection({
    fetchImpl,
    headers: { 'User-Agent': 'x', Authorization: `Bearer ${KEY}` },
    source: 'file',
  });
  writeFileSync(file, JSON.stringify({ version: 1, api_key: KEY }));
  assert.equal(conn.hasKey(), true);
  assert.equal(conn.keyRefused(), false, 'the saved key is the refused one, so nothing takes its place');
  assert.equal(headers.Authorization, undefined);
  assert.equal(conn.hasKey(), false);
  assert.match(lines.at(-1), /the key from the saved credentials file was refused/);
  assert.doesNotMatch(lines.join('\n'), KEY_SHAPE, 'the log never prints a key');
  assert.equal(existsSync(file), true, 'the file is kept: a refusal in one session never deletes it');
  const answer = await conn.connect();
  assert.match(answer.text, /^Not connected yet/);
  assert.equal(fetchImpl.creates(), 1);
});

test('a refused key from the environment falls back to a different saved key', async () => {
  const { conn, headers, file } = connection({
    fetchImpl: claimsServer(),
    headers: { 'User-Agent': 'x', Authorization: `Bearer ${KEY}` },
    source: 'env',
    env: { PREREASON_API_KEY: KEY },
  });
  writeFileSync(file, JSON.stringify({ version: 1, api_key: OTHER }));
  assert.equal(conn.keyRefused(), true);
  assert.equal(headers.Authorization, `Bearer ${OTHER}`);
  assert.equal(conn.source, 'file');
});

test('connect_account with a key the server reads as anonymous drops it and asks for access', async () => {
  const fetchImpl = claimsServer();
  const { conn, headers } = connection({
    fetchImpl,
    headers: { 'User-Agent': 'x', Authorization: `Bearer ${KEY}` },
    source: 'env',
    env: {},
    verify: async () => {
      throw new StreamableHttpError(401, 'refused', '{"error":"INVALID_API_KEY","message":"Invalid API key"}');
    },
  });
  const answer = await conn.connect();
  assert.equal(headers.Authorization, undefined);
  assert.match(answer.text, /^Not connected yet/);
  assert.equal(fetchImpl.creates(), 1);
});

test('connect_account says plainly when PreReason cannot be reached to confirm a key', async () => {
  const { conn } = connection({
    fetchImpl: claimsServer(),
    headers: { 'User-Agent': 'x', Authorization: `Bearer ${KEY}` },
    source: 'env',
    verify: async () => {
      throw new Error('fetch failed');
    },
  });
  const answer = await conn.connect();
  assert.equal(answer.isError, true);
  assert.match(answer.text, /could not be reached to confirm it just now \(fetch failed\)/);
  assert.doesNotMatch(answer.text, KEY_SHAPE);
});

test('readHealth and planName read get_health the way the server writes it', () => {
  const frame = { result: { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', account: { tier: 'enterprise', authenticated: true } }) }] } };
  assert.deepEqual(readHealth(frame), { authenticated: true, tier: 'enterprise' });
  assert.equal(readHealth({ result: { content: [{ type: 'text', text: 'not json' }] } }), null);
  assert.equal(planName('enterprise'), 'Enterprise');
  assert.equal(planName('nope'), null);
  assert.deepEqual(toolResult(9, 'x', true), { jsonrpc: '2.0', id: 9, result: { content: [{ type: 'text', text: 'x' }], isError: true } });
});
