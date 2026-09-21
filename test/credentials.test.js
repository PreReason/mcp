import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KEY_PATTERN,
  credentialsPath,
  deleteCredentials,
  keyFromHeaders,
  parseArgs,
  readCredentials,
  resolveApiKey,
  writeCredentials,
} from '../lib/credentials.js';

const LIVE = `pr_live_${'a'.repeat(32)}`;
const OTHER = `pr_live_${'b'.repeat(32)}`;
const posix = process.platform !== 'win32';

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'prereason-mcp-'));
  return { dir, path: join(dir, 'nested', 'credentials.json') };
}

test('credentialsPath: the flag, then the env override, then ~/.prereason/credentials.json', () => {
  assert.equal(credentialsPath({ env: {}, home: '/home/u' }), join('/home/u', '.prereason', 'credentials.json'));
  assert.equal(credentialsPath({ env: { PREREASON_CREDENTIALS_FILE: '/tmp/c.json' }, home: '/home/u' }), '/tmp/c.json');
  assert.equal(credentialsPath({ env: { PREREASON_CREDENTIALS_FILE: '/tmp/c.json' }, home: '/home/u', flag: '/flag.json' }), '/flag.json');
});

test('parseArgs understands the documented flags and a bare url', () => {
  const parsed = parseArgs(['--header', 'Authorization:Bearer x', '--header', 'X-Custom: y', '--credentials-file', '/c.json', '--login', 'https://example.test/mcp']);
  assert.deepEqual(parsed.headers, { Authorization: 'Bearer x', 'X-Custom': 'y' });
  assert.equal(parsed.credentialsFile, '/c.json');
  assert.equal(parsed.login, true);
  assert.equal(parsed.logout, false);
  assert.equal(parsed.url, 'https://example.test/mcp');
  assert.equal(parseArgs(['--logout']).logout, true);
  assert.equal(parseArgs(['-v']).version, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('keyFromHeaders reads Authorization: Bearer and X-API-Key in any case, and only real keys', () => {
  assert.equal(keyFromHeaders({ Authorization: `Bearer ${LIVE}` }), LIVE);
  assert.equal(keyFromHeaders({ authorization: `bearer ${LIVE}` }), LIVE);
  assert.equal(keyFromHeaders({ 'x-api-key': LIVE }), LIVE);
  assert.equal(keyFromHeaders({ Authorization: 'Bearer not-a-key' }), null);
  assert.equal(keyFromHeaders({ Authorization: `Bearer prc_${'c'.repeat(43)}` }), null);
  assert.equal(keyFromHeaders({}), null);
});

test('resolveApiKey: env beats header beats file', () => {
  const { path } = tempFile();
  writeCredentials(path, { apiKey: OTHER });
  const fileKey = `pr_live_${'f'.repeat(32)}`;
  writeCredentials(path, { apiKey: fileKey });

  assert.deepEqual(resolveApiKey({ env: { PREREASON_API_KEY: LIVE }, headers: { Authorization: `Bearer ${OTHER}` }, credentialsFile: path }), { key: LIVE, source: 'env' });
  assert.deepEqual(resolveApiKey({ env: {}, headers: { Authorization: `Bearer ${OTHER}` }, credentialsFile: path }), { key: OTHER, source: 'header' });
  assert.deepEqual(resolveApiKey({ env: {}, headers: {}, credentialsFile: path }), { key: fileKey, source: 'file' });
  assert.deepEqual(resolveApiKey({ env: { PREREASON_API_KEY: 'garbage' }, headers: {}, credentialsFile: join(path, 'missing') }), { key: null, source: null });
});

test('writeCredentials creates the directory and file with tight modes on POSIX, and stores only the key and provenance', () => {
  const { path } = tempFile();
  const now = new Date('2026-09-14T12:00:00Z');
  writeCredentials(path, { apiKey: LIVE, claimCode: 'PR-ABCD-2345', clientName: '@prereason/mcp 0.4.0 (test)', keyName: 'Agent: @prereason/mcp 0.4.0 (test)', now });

  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  assert.deepEqual(Object.keys(parsed).sort(), ['api_key', 'claim_code', 'client_name', 'key_name', 'saved_at', 'version'].sort());
  assert.equal(parsed.api_key, LIVE);
  assert.equal(parsed.saved_at, '2026-09-14T12:00:00.000Z');
  assert.ok(!raw.includes('prc_'), 'a claim token must never be written');
  assert.ok(!existsSync(`${path}.${process.pid}.tmp`), 'the temp file is renamed away');

  if (posix) {
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(path, '..')).mode & 0o777, 0o700);
  }

  assert.deepEqual(readCredentials(path), {
    apiKey: LIVE,
    savedAt: '2026-09-14T12:00:00.000Z',
    claimCode: 'PR-ABCD-2345',
    clientName: '@prereason/mcp 0.4.0 (test)',
    keyName: 'Agent: @prereason/mcp 0.4.0 (test)',
  });
});

test('writeCredentials refuses anything that is not a key', () => {
  const { path } = tempFile();
  assert.throws(() => writeCredentials(path, { apiKey: `prc_${'z'.repeat(43)}` }), /not a PreReason API key/);
  assert.equal(existsSync(path), false);
});

test('readCredentials reads a missing, malformed or wrong shaped file as null', () => {
  const { dir, path } = tempFile();
  assert.equal(readCredentials(path), null);
  writeFileSync(join(dir, 'bad.json'), '{not json');
  assert.equal(readCredentials(join(dir, 'bad.json')), null);
  writeFileSync(join(dir, 'wrong.json'), JSON.stringify({ api_key: 'nope' }));
  assert.equal(readCredentials(join(dir, 'wrong.json')), null);
  rmSync(dir, { recursive: true, force: true });
});

test('deleteCredentials reports whether there was anything to delete', () => {
  const { path } = tempFile();
  assert.equal(deleteCredentials(path), false);
  writeCredentials(path, { apiKey: LIVE });
  assert.equal(deleteCredentials(path), true);
  assert.equal(existsSync(path), false);
});

test('KEY_PATTERN accepts live and test keys and rejects claim tokens', () => {
  assert.ok(KEY_PATTERN.test(LIVE));
  assert.ok(KEY_PATTERN.test(`pr_test_${'t'.repeat(32)}`));
  assert.ok(!KEY_PATTERN.test(`prc_${'c'.repeat(43)}`));
  assert.ok(!KEY_PATTERN.test('pr_live_short'));
});
