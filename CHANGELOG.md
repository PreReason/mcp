# Changelog

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
