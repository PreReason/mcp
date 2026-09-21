/**
 * Where the bridge's API key comes from, and where a claimed key is kept.
 *
 * Precedence, highest first:
 *   1. PREREASON_API_KEY in the environment (the documented config path)
 *   2. an Authorization or X-API-Key value passed with --header
 *   3. the credentials file, written by the claim flow (~/.prereason/credentials.json,
 *      or PREREASON_CREDENTIALS_FILE, or --credentials-file)
 *
 * The file holds the key and a little provenance (which claim, which client
 * name, when). It never holds a claim token: a token is a fifteen minute
 * secret for one poll loop and dies with the process. On POSIX the directory
 * is 0700 and the file 0600. On Windows chmod is a no-op (the mode bits do
 * not exist), so the file relies on the profile directory's own permissions,
 * which is what every other credential store in %USERPROFILE% does.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const KEY_PATTERN = /^pr_(?:live|test)_[A-Za-z0-9_-]{16,}$/;
export const CREDENTIALS_VERSION = 1;

/** The credentials file path: the flag, then the env override, then the default under the home directory. */
export function credentialsPath({ env = process.env, home = homedir(), flag = null } = {}) {
  if (flag) return flag;
  if (env.PREREASON_CREDENTIALS_FILE) return env.PREREASON_CREDENTIALS_FILE;
  return join(home, '.prereason', 'credentials.json');
}

/**
 * Parse the CLI arguments the bridge understands.
 *   --header Key:Value   (repeatable)
 *   --credentials-file <path>
 *   --login  --logout  --help/-h  --version/-v
 *   <url>    a bare argument overrides the endpoint
 */
export function parseArgs(argv) {
  const out = { headers: {}, url: null, credentialsFile: null, login: false, logout: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--header' && argv[i + 1] !== undefined) {
      const value = argv[++i];
      const colon = value.indexOf(':');
      if (colon > 0) out.headers[value.slice(0, colon).trim()] = value.slice(colon + 1).trim();
    } else if (arg === '--credentials-file' && argv[i + 1] !== undefined) {
      out.credentialsFile = argv[++i];
    } else if (arg === '--login') {
      out.login = true;
    } else if (arg === '--logout') {
      out.logout = true;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else if (arg === '--version' || arg === '-v') {
      out.version = true;
    } else if (!arg.startsWith('-')) {
      out.url = arg;
    }
  }
  return out;
}

/** The API key carried by a --header value, if any. Accepts Authorization: Bearer and X-API-Key, any case. */
export function keyFromHeaders(headers) {
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = name.toLowerCase();
    if (lower === 'authorization') {
      const m = /^Bearer\s+(\S+)$/i.exec(String(value).trim());
      if (m && KEY_PATTERN.test(m[1])) return m[1];
    } else if (lower === 'x-api-key') {
      const v = String(value).trim();
      if (KEY_PATTERN.test(v)) return v;
    }
  }
  return null;
}

/** Read the credentials file. Anything that is not a well formed key reads as null. */
export function readCredentials(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed.api_key !== 'string' || !KEY_PATTERN.test(parsed.api_key)) return null;
    return {
      apiKey: parsed.api_key,
      savedAt: typeof parsed.saved_at === 'string' ? parsed.saved_at : null,
      claimCode: typeof parsed.claim_code === 'string' ? parsed.claim_code : null,
      clientName: typeof parsed.client_name === 'string' ? parsed.client_name : null,
      keyName: typeof parsed.key_name === 'string' ? parsed.key_name : null,
    };
  } catch {
    return null;
  }
}

/**
 * Write the credentials file atomically (temp file, then rename) with the
 * tightest modes the platform offers. Only these fields are ever written.
 */
export function writeCredentials(path, { apiKey, claimCode = null, clientName = null, keyName = null, now = new Date() }) {
  if (!KEY_PATTERN.test(apiKey)) throw new Error('refusing to save something that is not a PreReason API key');
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  tighten(dir, 0o700);
  const body = JSON.stringify(
    {
      version: CREDENTIALS_VERSION,
      api_key: apiKey,
      saved_at: now.toISOString(),
      claim_code: claimCode,
      client_name: clientName,
      key_name: keyName,
    },
    null,
    2
  );
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, body + '\n', { mode: 0o600 });
  tighten(tmp, 0o600);
  renameSync(tmp, path);
  tighten(path, 0o600);
}

export function deleteCredentials(path) {
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

function tighten(target, mode) {
  if (process.platform === 'win32') return; // no mode bits to set
  try {
    chmodSync(target, mode);
  } catch {
    // a filesystem that refuses chmod (some mounts) still gets the file; nothing else to do
  }
}

/**
 * Which key the bridge should use, and where it came from.
 * Returns { key, source } with source one of 'env', 'header', 'file', or null.
 */
export function resolveApiKey({ env = process.env, headers = {}, credentialsFile }) {
  const fromEnv = env.PREREASON_API_KEY;
  if (fromEnv && KEY_PATTERN.test(fromEnv.trim())) return { key: fromEnv.trim(), source: 'env' };
  const fromHeader = keyFromHeaders(headers);
  if (fromHeader) return { key: fromHeader, source: 'header' };
  const stored = credentialsFile ? readCredentials(credentialsFile) : null;
  if (stored) return { key: stored.apiKey, source: 'file' };
  return { key: null, source: null };
}
