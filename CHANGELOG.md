# Changelog

## 0.5.6 (2026-10-08)

### Changed
- The README opens with what an agent gets: one line ("Let your agent prereason before it answers."), a served Treasuries answer as the example, then "Why prereason?" in six points, before the full description and Quick Start. The served `macro.rates` picture moves up into that opening.
- The four pictures are opaque to their square edges, with no border line and no rounded corner, so no light edge shows on GitHub's dark page or on a white one.
- `server.json` registry version 0.8.2, npm package 0.5.6.

## 0.5.5 (2026-10-08)

### Changed
- The README carries four pictures, kept in `assets/` (outside the npm package, which ships only `bin`, `lib` and the docs): a header, the PR mark lit over the names of the Treasury yields, currencies, commodities, macro series and companies PreReason serves; how an agent connects, with the calls and the one time key approval; a served `macro.rates` answer; and a served NVIDIA company answer. The README links them from this repository, so the npm page shows them too. The bridge is unchanged.
- `server.json` registry version 0.8.2, npm package 0.5.5.

## 0.5.4 (2026-10-08)

### Changed
- The README names the company briefing's 11 parts and what each holds, how `get_context` reads one with `block` (a part counts one call; the whole briefing counts one for each part it carries), and how `list_briefings` with `search` names covered companies, each with the `entity` to pass. Both are server changes of 2026-10-08, and the bridge relays them unchanged.
- `server.json` registry version 0.8.2, npm package 0.5.4.

## 0.5.3 (2026-10-08)

### Changed
- The package description and the README's first line are PreReason's general line, "Financial market context for AI agents: macro, rates, bonds, FX, commodities, companies and Bitcoin.", in place of "Bitcoin and macro market briefings for AI agents: trend signals, regimes, liquidity and ETF flows." The desktop extension manifest's description opens "Financial market context for your assistant", with the same list.
- The README lists six tools, with `get_changes` (a key on the Basic or Pro plan: what changed since your last call, change events after a cursor, no values), and the desktop extension manifest now lists it too, where it listed five. The bridge needed no change for it: it relays every tool the server lists.
- The README names company briefings for listed companies in the US, Japan, Korea and India, one company per call, and counts 270 individual metrics.
- `server.json` registry version 0.8.2, npm package 0.5.3. The 0.8.2 record was never published (the registry's latest was still 0.8.0 on 2026-10-06), so it names this release in place of 0.5.2.
- The README and the desktop extension manifest count 32 live briefings. `commodities.oil-producers`, `commodities.gold-miners` and `commodities.grains-agribusiness` (Pro: a commodity beside the covered US companies tied to it, each company with its share price, its 1, 3 and 12 month changes beside the commodity's over the same windows and the measured 90 day correlation of its daily changes) went live on 2026-10-06.
- The README and the desktop extension manifest counted 29 live briefings. `commodities.gold`, `commodities.silver`, `commodities.copper` and `commodities.wheat` (Basic: each commodity through its fund's share price and its own monthly average price from the World Bank's Pink Sheet, with the CFTC's futures positioning and what is said to move it) went live on 2026-10-06.
- The README and the desktop extension manifest counted 25 live briefings. `eth.context` (Basic: Ether's price and 24 hour volume from CoinGecko, its distance from the 200 day average, Lido's stETH APR, the CFTC's CME Ether positioning and OKX's funding rate) went live on 2026-10-05.
- The README and the desktop extension manifest count 24 live briefings. `bonds.context` (Basic) and `bonds.full` (Pro), who holds US Treasuries (foreign investors, primary dealers and speculators, each against its own history; the full one adds the Fed's own Treasury holdings, debt held by the public and the largest foreign holders), went live on 2026-10-03.
- `macro.auctions` (Basic: Treasury auction demand, who bought at the latest auction of each note and bond maturity against that maturity's own prior 12 auctions, with the auctions announced and scheduled next) went live on 2026-10-03.
- `commodities.energy-basket` (Pro: US oil and gas stocks against the five year norm from EIA's weekly reports, with WTI, Brent and Henry Hub spot prices, the Brent to WTI spread and WTI realised volatility) went live on 2026-10-03.
- `cross.ai-compute` (Pro: US grid demand against a year earlier, the AI hosting agreements Bitcoin miners announced in SEC filings, and hosting against mining revenue per megawatt) went live on 2026-10-02. The bridge needed no change for it: `get_context` relays any briefing id the server accepts.

## 0.5.2 (2026-10-01)

### Changed
- 1 October 2026, the Free plan (a server change; the bridge relays it unchanged): a free key makes up to 30 calls an hour and 100 a day, down from 60 and 500. It reads the 17 Bitcoin metrics (the `bitcoin` category) in full, with their trends, and only the latest reading of every other metric: `get_metric` answers those with the value, when it was taken, its source and its freshness, and says so in `access`. `list_metrics` states the rule in its `free_key` field. Free accounts that made a call in the week before keep 60 an hour, 500 a day and every metric in full until further notice. Basic and Pro are unchanged. The dated notice is kept at https://www.prereason.com/docs#changelog.

### Fixed
- A request the bridge could not relay no longer hangs the host. Until now any non ok HTTP status made the transport throw, and the bridge only wrote `[prereason:send]` to stderr, so the host waited out its own timeout for an id that never came back. Two cases met it: a key past its quota (PreReason answers 429 with a JSON-RPC error), and, while sign in discovery was on in production from 2026-10-01 02:28Z, a call with no key (a 401; the server has since given the bridge's own user agent the readable `AUTH_REQUIRED` instead). Now a refusal the server words as JSON-RPC reaches the host as the answer, so the model reads "Hourly limit reached" or "Authentication required for this tool."; and any other failure (an error page, a network error) gets an error answer with the request's own id, naming the HTTP status and never repeating the body. A notification, which asks for nothing, still gets nothing.
- `test/` gains eight cases (three in `streamable-http.test.js`, three in `jsonrpc.test.js`, two end to end in `bridge.test.js`), and the suite is 83.

## 0.5.1 (2026-09-30)

### Changed
- The README and the desktop extension manifest count 19 live briefings. `macro.rates` (Pro: the Treasury yield curve at 3M, 2Y, 5Y, 10Y and 30Y, breakeven inflation, the 5y5y forward and the Germany 10Y) went live on 2026-09-27. The bridge needed no change for it: it relays whatever `list_briefings` returns.
- The same day the curve gained nine maturities read from the US Treasury's own par yield curve (1M, 1.5M, 2M, 4M, 6M, 1Y, 3Y, 7Y and 20Y), so `macro.rates` carries every maturity on that curve, fourteen, and the catalogue counts 212 metrics.
- README: the example prompts lead with two free briefings, `btc.quick-check` and `btc.context`, in place of two that need Pro, and the `btc.momentum` row says percentile rankings in place of YTD percentiles, a span that briefing never ranked over.
- README and desktop extension manifest: they no longer say every briefing carries a regime label and a narrative (the deeper briefings add them). Six briefing rows name what each one holds (`macro.snapshot`, `btc.pulse`, `btc.on-chain`, `cross.breadth`, `btc.full`, `fx.liquidity`), `list_metrics` names its four categories with `eth` among them, and the link for clients that take a remote server points at Option 2 (direct HTTP) in place of a heading that does not exist.
- `server.json` registry version 0.8.2, npm package 0.5.1. The 0.8.2 record was never published, so it names this release in place of 0.5.0.

### Fixed
- An approval on an account that already holds its limit of API keys no longer polls until the link expires. The server answers `KEY_LIMIT_REACHED` with no `retry_after`, because polling cannot clear it, but the bridge treated every approval without a key as a failed mint and asked again every five seconds, so the person watched nothing happen for the rest of the claim's life. The bridge now stops on the first such answer and prints one line naming the count (`this account already has 2 of 2 API keys`), where to revoke a key (Settings, on the same site as the approve link) and the other way out (`PREREASON_API_KEY` set to a key you already have). Any later `AUTH_REQUIRED` tool result starts with the same guidance in place of the approve link, because a person inside Claude Desktop never sees stderr. `--login` exits 1 in this case. `KEY_ISSUE_FAILED` still retries after `retry_after`, exactly as before.
- `test/claim.test.js` gains four cases, and the suite is 75.

## 0.5.0 (2026-09-21)

### Removed
- `@modelcontextprotocol/sdk`, the only dependency. The bridge now installs nothing. It used the SDK for two classes, `StdioServerTransport` and `StreamableHTTPClientTransport`, and paid 91 packages and 25 MB on disk for them: Express, Hono, CORS, `express-rate-limit`, `jose`, `pkce-challenge`, `ajv`, `zod` and the rest are the SDK server and OAuth halves, and a relay calls none of them. The published tarball is 23 KB, `npm ls` is one line, and the code a security review has to read is the code in this repository.

### Added
- `lib/stdio.js`: newline delimited JSON-RPC over stdin and stdout, with the SDK framing kept exactly, including the 10 MB line ceiling, the carriage return before the newline, and the rule that a line which will not parse is reported and skipped rather than ending the session.
- `lib/streamable-http.js`: the Streamable HTTP client. POST a frame, read the answer as JSON or as an event stream, carry `Mcp-Session-Id` onto later requests, open the optional GET stream once the session is initialized, and treat a 405 there as the server saying it has none, which is what PreReason answers. Headers are read from `requestInit` on every request rather than copied once, because the claim flow attaches `Authorization` to that same object after the transport has started.
- `lib/sse.js`: a Server-Sent Events decoder following the same buffering rules as `eventsource-parser`, including the carriage return split across two chunks that would otherwise turn one event into two.
- `lib/jsonrpc.js`: the shape check that replaces the SDK zod schema. A relay has no reason to validate methods or params, only to be sure it is not writing a bare string to a host that would treat the stream as corrupt.
- `test/` grows to 71 cases across six files, among them `test/bridge.test.js`, which spawns `bin/cli.js` against a stub server and asserts on the headers that reach the wire. The suite runs on an empty `node_modules`, which is the proof there is nothing left to install.

### Changed
- `socket.yml` describes this package own code and nothing else, and says in the file what it is for: it configures the Socket GitHub app and CLI for this repository, and has no effect on the public package score.
- `server.json` registry version 0.8.2, npm package 0.5.0.


## 0.4.0 (2026-09-21)

### Added
- The bridge gets its own key. With no `PREREASON_API_KEY` and no saved key it asks PreReason for access, prints one link to stderr (`Open https://www.prereason.com/claim/PR-XXXX-XXXX to approve access`), keeps serving the free tools, and polls until the person approves. The key arrives once, is saved to `~/.prereason/credentials.json` (0700 directory, 0600 file on POSIX; Windows has no mode bits), and is attached to the running connection without a restart. While the link is pending, any `AUTH_REQUIRED` tool result starts with `Approve at <link>` so the assistant can relay it, because a person inside Claude Desktop never sees this process's stderr.
- `--login` (ask for access now, save the key, exit), `--logout` (forget the saved key), `--credentials-file <path>` and `PREREASON_CREDENTIALS_FILE`.
- `PREREASON_CLIENT` (for example `claude-desktop`) is forwarded as `X-PreReason-Client` so the dashboard names the connection; every request carries `User-Agent: prereason-mcp/0.4.0`.
- `node --test` suite under `test/`: key precedence, file modes, the poll loop against a stubbed server, and that a claim token never touches the disk.
- `mcpb/manifest.json`: the Claude Desktop extension manifest for a single click install (`npx @anthropic-ai/mcpb pack`), with the key optional.

### Changed
- Key precedence is documented and tested: `PREREASON_API_KEY`, then `--header`, then the credentials file, then the claim flow.
- `@modelcontextprotocol/sdk` 1.27.1 to 1.30.0.
- The version is one number again: `cli.js` printed 0.3.1 while `package.json` said 0.3.2 and `server.json` 0.3.1.
- `server.json` (the registry entry) returns to `com.prereason/mcp`, the name that has been live in the registry since March; the July rename to `io.github.PreReason/mcp` was never published.
- `server.json` names the `X-API-Key` header on the remote, the header the published record already declares. The server accepts `Authorization: Bearer` as well. A registry client prompts a person for the header value, and with `X-API-Key` they paste the bare key: there is no `Bearer ` prefix to forget, and a key pasted without one into `Authorization` is silently treated as no key at all.
- `server.json` `description` is the one line every listing now carries, at 98 characters. It was 196, and the registry rejects anything over 100, so the record could not have been published.
- `server.json` `version` is 0.8.0 while the npm package stays 0.4.0. The registry marks a record latest only when its version sorts above the current latest, which is 0.7.2, so a record published as 0.4.0 would have been accepted and then ignored by everything downstream.
- README: the no key path comes first; OAuth is not offered until it is verified. The opening paragraph is the canonical directory copy.

## 0.3.2 (2026-08-19)

### Fixed
- Briefing count was 17 everywhere; the catalog has served 18 since `btc.etf-flows` (Basic) went live. README tier tables, package description, and server.json now agree with the API.
- Metric count was 30; the API reports 116.

## 0.3.0 (2026-04-12)

### Added
- OAuth 2.1 support for automatic API key provisioning on MCP connection
- Server branding metadata (title, description, icons) for client connection cards
- Centered README hero layout with improved visual hierarchy
- Privacy Policy section in README
- npm downloads and Node.js version badges

### Security
- Harden OAuth proxy endpoints with input validation, rate limiting, and timeout handling
- Sanitize upstream error responses on token exchange

### Fixed
- HEAD /api/mcp returning 405 instead of 200
- Metric count in README (38 -> 30)
- cli.js version mismatch with package.json

## 0.2.1 (2026-03-30)

- Add .mcp.json for Open Plugins / cursor.directory discovery
- Include .mcp.json in npm package files

## 0.2.0 (2026-03-21)

- Add Glama deployment support (Dockerfile build, inspection, release)
- Add build script for container image builds
- Add 6 MCP prompt templates (daily_market_briefing, risk_check, mining_profitability, macro_regime_check, correlation_scanner, weekly_recap)
- Add 2 MCP resource catalogs (briefing_catalog, metric_catalog)

## 0.1.12 (2026-03-17)

- Switch publish workflow to OIDC trusted publisher (no NPM_TOKEN needed)
- Trigger on tag push (`v*`) instead of GitHub releases
- Fix repository URL to canonical npm format

## 0.1.11 (2026-03-17)

- Vocabulary alignment: "templates" → "briefings" across README, CHANGELOG, and tool references
- Update published npm description to reference "briefings" instead of "templates"

## 0.1.10 (2026-03-15)

- Enable SLSA provenance attestation via GitHub Actions publish workflow
- Fix workflow placement: move from `packages/mcp/.github/` to repo root `.github/workflows/`
- Switch publish trigger to `workflow_dispatch` for manual control

## 0.1.9 (2026-03-10)

- Expand `socket.yml` to suppress all known-safe transitive dependency alerts from `@modelcontextprotocol/sdk`
- Covers eval (ajv), shell (cross-spawn), filesystem (express/send), debug, dynamic require, unmaintained micro-packages, and more

## 0.1.8 (2026-03-05)

- Remove `createRequire` / dynamic `require('../package.json')` — hardcode version constants
- Eliminates Socket.dev "Dynamic require" and "Filesystem access" findings from our code
- Add `socket.yml` for GitHub PR alert suppression of expected behaviors (network access, env vars)

## 0.1.7 (2026-03-04)

- Pin `@modelcontextprotocol/sdk` to exact `1.27.1` (fixes transitive CVEs in hono and qs)
- Update metric count from 26 to 30 (added 200D MA, distance from 200D MA, USDT market cap, USDT dominance)
- Update `btc.momentum` description to reflect 200D MA support/resistance
- Update `cross.regime` description to reflect USDT.D risk sentiment

## 0.1.6 (2026-02-25)

- Fix description wording: replace "trend signals" with "trend interpretation"
- Add SECURITY.md with vulnerability reporting policy
- Add GitHub Actions CI workflow for provenance-signed npm publishing
- Public source repo at https://github.com/PreReason/mcp

## 0.1.3 (2026-02-21)

- Add `PREREASON_API_KEY` environment variable support (fixes Windows `cmd.exe` quoting crash)
- Add `PREREASON_URL` environment variable for custom endpoint
- Update all config examples to use `env` block (matches Stripe/Supabase pattern)
- `--header` CLI args still supported for backward compatibility

## 0.1.2 (2026-02-21)

- Fix Windows path resolution issue in Claude Desktop (rename `.mjs` → `.js` bin entry)
- Add Windows troubleshooting section in README

## 0.1.1 (2026-02-21)

- Add MIT LICENSE file
- Enhance README with full briefing list, troubleshooting, and example prompts
- Add CHANGELOG

## 0.1.0 (2026-02-20)

- Initial release
- stdio-to-Streamable HTTP bridge for Claude Desktop
- Default URL: `https://api.prereason.com/api/mcp`
- `--header Key:Value` flag for API key authentication
- `--help` and `--version` flags
- 5 MCP tools: get_context, get_metric, list_briefings, list_metrics, get_health
