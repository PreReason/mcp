# Changelog

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
