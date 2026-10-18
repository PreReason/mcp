/**
 * Connecting from inside the conversation.
 *
 * A person tells their assistant "connect me to PreReason, I have an account".
 * Until 0.6.0 nothing answered that. The free tools reply without a link, and
 * the claim the bridge started when the app opened had expired fifteen minutes
 * later, so an answer that needed a key carried no link at all until the app
 * was restarted. This is the bridge's own side of connecting:
 *
 * - connect_account, a tool the bridge lists after the server's tools and
 *   answers itself. The hosted server never offers it. It shows no key and asks
 *   for none: it returns the approve link (the one AUTH_REQUIRED results carry)
 *   or says the account is connected, and on which plan.
 * - The claim starts when it is needed (connect_account, or a result that needs
 *   a key) rather than when the app opens, and a new one starts after one
 *   lapses, so no restart is needed, and an app opened and closed all day uses
 *   none of the five claims an hour one address may make.
 * - A key the server refuses (revoked under Settings) is set aside for this
 *   process, so the bridge goes on serving and can ask again, where every
 *   request, initialize included, used to fail.
 *
 * Everything that touches the network or the clock is injectable, so the
 * states are tested without a server.
 */

import { accountSettingsUrl, createClaim, decorateAuthRequired, keyCount, pollUntilSettled, prefixAuthRequired } from './claim.js';
import { KEY_PATTERN, keyFromHeaders, readCredentials, writeCredentials } from './credentials.js';

export const CONNECT_TOOL_NAME = 'connect_account';

/** The tool as tools/list carries it. Not read only: it asks PreReason for access, which a person then approves. */
export const CONNECT_TOOL = {
  name: CONNECT_TOOL_NAME,
  title: 'Connect your PreReason account',
  description:
    "Connect this assistant to the user's PreReason account. Call it when the user asks to connect, link, sign in to or log in to PreReason, " +
    'or when a PreReason tool answers AUTH_REQUIRED. Until the account is connected it returns one link for the user to open: they sign in, ' +
    'or create a free account, and click Approve. No key is ever shown; it arrives in this connection by itself. Call it again after they ' +
    'approve: it says whether the account is connected, and on which plan.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: {
    title: 'Connect your PreReason account',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/** The sentence the bridge adds to the server's instructions, so a model that reads them knows the tool is there. */
export const CONNECT_INSTRUCTIONS =
  "To connect PreReason to the user's own account, for example when they ask to connect or sign in, or when a tool answers AUTH_REQUIRED, " +
  'call connect_account: it returns one link for them to approve, and no key is ever shown.';

/**
 * Added to the first "Connected" answer after an approval in this process.
 * The approval page shows the connection done only once the server sees the
 * new key make a data read (get_context or get_metric; list_briefings,
 * list_metrics and get_health never count), so the assistant makes one now,
 * in the turn the person asked to connect. macro.snapshot is on every plan.
 */
export const FIRST_READ_ASK =
  'To finish connecting, make one small read now: call get_context with briefing macro.snapshot and tell the user in one sentence what it says. ' +
  'Their approval page shows the connection done when that read arrives; list_briefings does not count.';

/** How long an answer that needs a key waits for a claim to be created, so it can carry the link. */
export const CLAIM_CREATE_WAIT_MS = 8000;
/** How long connect_account waits for an approval that may have just happened. */
export const APPROVAL_WAIT_MS = 4000;

const PLAN_NAMES = { free: 'Free', basic: 'Basic', pro: 'Pro', business: 'Business', enterprise: 'Enterprise' };

/** True for a tools/call result whose first text is PreReason's AUTH_REQUIRED. */
export function isAuthRequired(message) {
  const result = message?.result;
  if (!result || result.isError !== true || !Array.isArray(result.content)) return false;
  const first = result.content[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return false;
  try {
    return JSON.parse(first.text)?.error === 'AUTH_REQUIRED';
  } catch {
    return false;
  }
}

/** A send that failed because the server refused the key itself (401 INVALID_API_KEY), not the request. */
export function isKeyRefusal(error) {
  if (!error || error.code !== 401) return false;
  return /INVALID_API_KEY/.test(String(error.body ?? error.message ?? ''));
}

/** tools/list's answer with connect_account after the server's own tools, once. */
export function withConnectTool(message) {
  const tools = message?.result?.tools;
  if (!Array.isArray(tools) || tools.some((tool) => tool?.name === CONNECT_TOOL_NAME)) return message;
  return { ...message, result: { ...message.result, tools: [...tools, CONNECT_TOOL] } };
}

/** initialize's answer with the connect sentence after the server's own instructions. */
export function withConnectInstructions(message) {
  const result = message?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return message;
  const own = typeof result.instructions === 'string' ? result.instructions.trim() : '';
  if (own.includes(CONNECT_TOOL_NAME)) return message;
  return { ...message, result: { ...result, instructions: own ? `${own} ${CONNECT_INSTRUCTIONS}` : CONNECT_INSTRUCTIONS } };
}

/** A tools/call result the bridge answers itself. */
export function toolResult(id, text, isError = false) {
  return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) } };
}

function minutesUntil(iso, now) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return 15;
  return Math.max(1, Math.round((at - now) / 60_000));
}

/** Wait for `promise`, or `ms`, whichever is first, leaving no timer behind. */
function within(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => (timer = setTimeout(resolve, ms)))]).finally(() => clearTimeout(timer));
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The plan name for a tier get_health reports, or null for one it does not know. */
export function planName(tier) {
  return typeof tier === 'string' && PLAN_NAMES[tier] ? PLAN_NAMES[tier] : null;
}

/**
 * The account as get_health reports it: { authenticated, tier }, or null when
 * the answer is not the shape get_health gives.
 */
export function readHealth(frame) {
  const text = frame?.result?.content?.[0]?.text;
  if (typeof text !== 'string') return null;
  try {
    const account = JSON.parse(text)?.account;
    if (!account || typeof account.authenticated !== 'boolean') return null;
    return { authenticated: account.authenticated, tier: typeof account.tier === 'string' ? account.tier : null };
  } catch {
    return null;
  }
}

/**
 * The bridge's connection to one PreReason account: which key it holds, and
 * the claim it is running when it holds none.
 *
 * States of the claim: none (never asked), creating, pending (a link is out),
 * approved, key_limit (approved, but the account holds all the keys it may),
 * denied, refused (the server would not take a claim, until retryAt), ended
 * (expired, given up or failed to create: the next need asks again).
 */
export class Connection {
  #headers;
  #mcpUrl;
  #clientName;
  #purpose;
  #credentialsFile;
  #requestHeaders;
  #fetch;
  #sleep;
  #now;
  #log;
  #env;
  #argHeaders;
  #verify;
  #listeners = new Set();
  #creating = null;
  #wake = null;
  #refused = new Set();
  // A key approved in this process has made no data read yet: the next
  // "Connected" answer asks for one (FIRST_READ_ASK), once.
  #firstReadOwed = false;

  status = 'none';
  source = null;
  approveUrl = null;
  expiresAt = null;
  notice = null;
  retryAt = 0;
  settled = null;

  constructor({
    headers,
    mcpUrl,
    clientName,
    purpose,
    credentialsFile,
    requestHeaders = {},
    source = null,
    env = {},
    argHeaders = {},
    verify = async () => null,
    fetchImpl = fetch,
    sleep = null,
    now = () => Date.now(),
    log = (line) => process.stderr.write(`${line}\n`),
  }) {
    this.#headers = headers;
    this.#mcpUrl = mcpUrl;
    this.#clientName = clientName;
    this.#purpose = purpose;
    this.#credentialsFile = credentialsFile;
    this.#requestHeaders = requestHeaders;
    this.#fetch = fetchImpl;
    this.#sleep = sleep;
    this.#now = now;
    this.#log = log;
    this.#env = env;
    this.#argHeaders = argHeaders;
    this.#verify = verify;
    this.source = source;
  }

  /** The key the requests carry now, or null. */
  get key() {
    const named = Object.keys(this.#headers).find((h) => h.toLowerCase() === 'authorization');
    if (named) {
      const m = /^Bearer\s+(\S+)$/i.exec(String(this.#headers[named]).trim());
      if (m) return m[1];
    }
    return keyFromHeaders(this.#headers);
  }

  hasKey() {
    return this.key !== null;
  }

  #changed() {
    for (const listener of [...this.#listeners]) listener();
  }

  /** Resolves on the next change of state, or after `ms`. */
  #nextChange(ms) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.#listeners.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.#listeners.add(done);
    });
  }

  /** The poll loop's sleep, which connect_account can cut short to look at once. */
  #pollSleep = (ms) => {
    if (this.#sleep) return this.#sleep(ms);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#wake = null;
        resolve();
      }, ms);
      this.#wake = () => {
        clearTimeout(timer);
        this.#wake = null;
        resolve();
      };
    });
  };

  /**
   * The key was refused by the server (revoked, or never valid). It is set
   * aside for this process, and the next source in the documented order is
   * tried: the environment, a --header, the credentials file. Returns true
   * when another key took its place.
   */
  keyRefused() {
    const refused = this.key;
    if (!refused) return false;
    this.#refused.add(refused);
    for (const name of Object.keys(this.#headers)) {
      const lower = name.toLowerCase();
      if (lower === 'authorization' || lower === 'x-api-key') delete this.#headers[name];
    }
    const from = this.source;
    this.#log(`PreReason: the key from ${describeSource(from)} was refused (revoked or not valid). It is not used again in this session; ask the assistant to connect PreReason for a new one.`);
    const next = this.#nextKey();
    if (next) {
      this.#headers.Authorization = `Bearer ${next.key}`;
      this.source = next.source;
      return true;
    }
    this.source = null;
    if (this.status === 'approved') this.status = 'none';
    this.#firstReadOwed = false;
    this.#changed();
    return false;
  }

  #nextKey() {
    const candidates = [];
    const fromEnv = typeof this.#env.PREREASON_API_KEY === 'string' ? this.#env.PREREASON_API_KEY.trim() : '';
    if (KEY_PATTERN.test(fromEnv)) candidates.push({ key: fromEnv, source: 'env' });
    const fromHeader = keyFromHeaders(this.#argHeaders);
    if (fromHeader) candidates.push({ key: fromHeader, source: 'header' });
    const stored = this.#credentialsFile ? readCredentials(this.#credentialsFile) : null;
    if (stored) candidates.push({ key: stored.apiKey, source: 'file' });
    return candidates.find((c) => !this.#refused.has(c.key)) ?? null;
  }

  /**
   * Start a claim when one is needed and none is out. `explicit` is a person
   * asking (connect_account): it asks again after a denial or the key limit,
   * which an answer that merely needs a key does not. Resolves once the claim
   * is created or refused, or after `waitMs`, whichever is first.
   */
  async ensureClaim({ explicit = false, waitMs = CLAIM_CREATE_WAIT_MS } = {}) {
    if (this.hasKey()) return;
    if (this.status === 'pending') return;
    if (!this.#creating) {
      const retry = this.status === 'none' || this.status === 'ended' || this.status === 'approved';
      const asked = explicit && (this.status === 'denied' || this.status === 'key_limit');
      const waited = this.status === 'refused' && this.#now() >= this.retryAt;
      if (!retry && !asked && !waited) return;
      this.#creating = this.#create().finally(() => {
        this.#creating = null;
      });
    }
    await within(this.#creating, waitMs);
  }

  async #create() {
    this.status = 'creating';
    this.notice = null;
    let created;
    try {
      created = await createClaim({
        mcpUrl: this.#mcpUrl,
        clientName: this.#clientName,
        purpose: this.#purpose,
        requestHeaders: this.#requestHeaders,
        fetchImpl: this.#fetch,
      });
    } catch (error) {
      this.status = 'ended';
      this.notice = `PreReason could not be reached to ask for access (${error?.message ?? 'network error'}). Ask to connect PreReason again in a moment. `;
      this.#log(`PreReason: could not reach the claims endpoint to request access (${error?.message ?? 'network error'}). Free tools still work.`);
      this.#changed();
      return;
    }
    if (!created.ok) {
      const minutes = Math.max(1, Math.ceil(created.retryAfterMs / 60_000));
      this.status = 'refused';
      this.retryAt = this.#now() + created.retryAfterMs;
      this.notice = `PreReason could not ask for access just now (${created.message}). Try again in about ${plural(minutes, 'minute')}. `;
      this.#log(`PreReason: access request refused (${created.status}: ${created.message}). Try again in about ${plural(minutes, 'minute')}. Free tools still work.`);
      this.#changed();
      return;
    }
    const claim = created.claim;
    this.status = 'pending';
    this.approveUrl = claim.approve_url;
    this.expiresAt = claim.expires_at;
    this.#log(`PreReason: no API key yet. Open ${claim.approve_url} to approve access (link expires in ${plural(minutesUntil(claim.expires_at, this.#now()), 'minute')}).`);
    this.#changed();
    // The poll runs on: the answer that asked for this claim goes out with the link now.
    this.#poll(claim).catch((error) => {
      this.status = 'ended';
      this.approveUrl = null;
      this.#log(`[prereason:claim] ${error?.message ?? error}`);
      this.#changed();
    });
  }

  async #poll(claim) {
    const settled = await pollUntilSettled({
      claim,
      requestHeaders: this.#requestHeaders,
      fetchImpl: this.#fetch,
      sleep: this.#pollSleep,
      now: this.#now,
      onPending: (body) => {
        if (typeof body.expires_at === 'string') this.expiresAt = body.expires_at;
      },
    });
    this.settled = settled;
    this.approveUrl = null;

    if (settled.outcome === 'approved') {
      this.#headers.Authorization = `Bearer ${settled.apiKey}`;
      this.source = 'file';
      this.status = 'approved';
      this.#firstReadOwed = true;
      try {
        writeCredentials(this.#credentialsFile, {
          apiKey: settled.apiKey,
          claimCode: claim.claim_code,
          clientName: this.#clientName,
          keyName: settled.key?.name ?? null,
          now: new Date(this.#now()),
        });
        this.#log(`PreReason: access approved. Key "${settled.key?.name ?? 'Agent key'}" saved to ${this.#credentialsFile}; briefings work from the next call.`);
      } catch (error) {
        this.source = 'session';
        this.#log(`PreReason: access approved and attached for this session, but the key could not be saved to ${this.#credentialsFile} (${error?.message ?? 'write failed'}).`);
      }
    } else if (settled.outcome === 'key_limit') {
      this.status = 'key_limit';
      this.notice = keyLimitAsk(settled, accountSettingsUrl(claim.approve_url));
      this.#log(`PreReason: access was approved, but ${keyCount(settled)}, so no new key can be issued. Revoke a key at ${accountSettingsUrl(claim.approve_url)}, then ask to connect again.`);
    } else if (settled.outcome === 'denied') {
      this.status = 'denied';
      this.notice = 'Access to PreReason was declined on the approval page. If that was not meant, ask to connect PreReason again for a new link. ';
      this.#log('PreReason: access was declined on the approval page.');
    } else {
      // expired, delivered elsewhere, not found, or the server could not be reached:
      // nothing to keep, and the next need asks again.
      this.status = 'ended';
      this.#log(`PreReason: the approval link lapsed (${settled.outcome}); the next answer that needs a key asks again.`);
    }
    this.#changed();
  }

  /** What an answer from the server carries for the current state (sync: the claim was ensured before). */
  decorate(message) {
    if (!isAuthRequired(message) || this.hasKey()) return message;
    if (this.status === 'pending' && this.approveUrl) return decorateAuthRequired(message, this.approveUrl);
    if (this.notice) return prefixAuthRequired(message, this.notice);
    return message;
  }

  /** connect_account's answer: { text, isError }. */
  async connect() {
    if (!this.hasKey() && this.status === 'pending') {
      // The person may have just clicked Approve: look now rather than at the next poll.
      const changed = this.#nextChange(APPROVAL_WAIT_MS);
      this.#wake?.();
      await changed;
    }
    for (let attempt = 0; attempt < 3 && this.hasKey(); attempt++) {
      const answer = await this.#confirm();
      if (answer) return answer;
    }
    await this.ensureClaim({ explicit: true });
    return this.#notConnectedAnswer();
  }

  /** Ask PreReason whether the key reads as this account. Null when the key was refused and set aside. */
  async #confirm() {
    let health;
    try {
      health = await this.#verify();
    } catch (error) {
      if (isKeyRefusal(error)) {
        this.keyRefused();
        return null;
      }
      return {
        text: `A PreReason key is set up on this computer (${describeSource(this.source)}), but PreReason could not be reached to confirm it just now (${error?.message ?? 'no answer'}). Try again in a moment.`,
        isError: true,
      };
    }
    if (health && health.authenticated === false) {
      // The server read the request as anonymous though a key was sent: treat the key as refused.
      this.keyRefused();
      return null;
    }
    const plan = planName(health?.tier);
    const where =
      this.source === 'file'
        ? ' The key is saved on this computer, so the next session is connected too.'
        : this.source === 'env' || this.source === 'header'
          ? " The key comes from this app's configuration."
          : '';
    const firstRead = this.#firstReadOwed ? ` ${FIRST_READ_ASK}` : '';
    this.#firstReadOwed = false;
    return {
      text: `Connected: this assistant reads PreReason with the user's account${plan ? `, on the ${plan} plan` : ''}.${where} Briefings, metrics and company reads work now: call list_briefings to see what is available, or answer the user's market question with get_context.${firstRead}`,
      isError: false,
    };
  }

  #notConnectedAnswer() {
    if (this.status === 'pending' && this.approveUrl) {
      const left = minutesUntil(this.expiresAt, this.#now());
      return {
        text:
          `Not connected yet. Ask the user to open this link: ${this.approveUrl}\n` +
          `On that page they sign in to their PreReason account, or create a free one, and click Approve. The link works for about ${plural(left, 'minute')}, ` +
          'and nothing changes in their account until they approve. No key is shown to anyone: once they approve, it arrives in this connection by itself. ' +
          'When they say they have approved, call connect_account again to confirm.',
        isError: false,
      };
    }
    if (this.notice) return { text: this.notice.trim(), isError: true };
    return {
      text: 'PreReason could not start a connection just now. Call connect_account again in a moment.',
      isError: true,
    };
  }
}

function describeSource(source) {
  switch (source) {
    case 'env':
      return 'PREREASON_API_KEY';
    case 'header':
      return 'the --header option';
    case 'file':
      return 'the saved credentials file';
    case 'session':
      return 'this session';
    default:
      return 'this computer';
  }
}

/** The key limit, in words a person inside the conversation can act on without restarting anything. */
export function keyLimitAsk(settled, settingsUrl) {
  return `The user approved access, but ${keyCount(settled)}, so no new key could be issued. Ask them to revoke a key they no longer use at ${settingsUrl}, then ask to connect PreReason again for a new link. `;
}
