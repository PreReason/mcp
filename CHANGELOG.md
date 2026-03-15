# Changelog

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
- Enhance README with full template list, troubleshooting, and example prompts
- Add CHANGELOG

## 0.1.0 (2026-02-20)

- Initial release
- stdio-to-Streamable HTTP bridge for Claude Desktop
- Default URL: `https://api.prereason.com/api/mcp`
- `--header Key:Value` flag for API key authentication
- `--help` and `--version` flags
- 5 MCP tools: get_context, get_metric, list_templates, list_metrics, get_health
