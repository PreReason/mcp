<div align="center">

# @prereason/mcp

[![npm version](https://img.shields.io/npm/v/@prereason/mcp.svg)](https://www.npmjs.com/package/@prereason/mcp)
[![npm downloads](https://img.shields.io/npm/dm/@prereason/mcp.svg)](https://www.npmjs.com/package/@prereason/mcp)
[![node version](https://img.shields.io/node/v/@prereason/mcp.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Glama Score](https://glama.ai/mcp/servers/PreReason/mcp/badges/score.svg)](https://glama.ai/mcp/servers/PreReason/mcp)
[![Smithery](https://img.shields.io/badge/Smithery-listed-7c3aed)](https://smithery.ai/servers/prereason/briefings)

**MCP server for [PreReason](https://www.prereason.com).**

Bitcoin and macro market briefings for AI agents: trend signals, regimes, liquidity and ETF flows.

</div>

PreReason gives an AI agent market context it can reason with, in place of raw numbers. One call returns a briefing with the analysis already in it: a signal line, trend direction over several windows, confidence scores, percentile ranks and correlations, and in the deeper briefings a regime label and a plain language narrative. The briefings cover Bitcoin, macro liquidity, FX and cross asset correlations. The catalogue holds 19 live briefings and 212 individual metrics, among them Bitcoin price and momentum, network and miner health, spot Bitcoin ETF flows, corporate Bitcoin treasuries, the Fed balance sheet, M2, net liquidity, Treasury yields and the dollar. It is served over MCP (a remote server and an npm bridge) and over REST, as Markdown or JSON. The catalogue tools need no key, and an agent can get a free key from inside the session: it shows one link, a person approves it, and the key arrives.

## Quick Start

### Option 1: Claude Desktop, no key needed

**Requires [Node.js 18+](https://nodejs.org), and nothing else: the bridge has no dependencies.**

Add this to `claude_desktop_config.json` and restart Claude Desktop:

```json
{
  "mcpServers": {
    "prereason": {
      "command": "npx",
      "args": ["-y", "@prereason/mcp"],
      "env": { "PREREASON_CLIENT": "claude-desktop" }
    }
  }
}
```

The catalogue tools work at once. The first time a briefing needs a key, the bridge asks for access: ask Claude for any briefing and the answer starts with `Approve at https://www.prereason.com/claim/PR-XXXX-XXXX`. Open the link, sign in or create a free account, click Approve. The key arrives in the bridge on its own, is saved to `~/.prereason/credentials.json`, and the next call works. Nothing is created in your account until you click Approve. If your account already holds as many API keys as it allows, the answer says so instead of looping: revoke a key under Settings on prereason.com and restart Claude, or set `PREREASON_API_KEY` to a key you already have.

Config file location:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Already have a key? Add it to the `env` block as `"PREREASON_API_KEY": "pr_live_..."` and the bridge never asks.

### Option 2: Direct HTTP with an API key (Claude Code, Cursor, Windsurf, Codex, Gemini CLI, VS Code, scripts)

Clients that hold their own config can call the endpoint directly, with the key as a header:

```bash
# Claude Code
claude mcp add --transport http prereason https://api.prereason.com/api/mcp --header "Authorization: Bearer YOUR_API_KEY"
```

```json
{
  "mcpServers": {
    "prereason": {
      "type": "http",
      "url": "https://api.prereason.com/api/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

Windsurf uses `serverUrl` instead of `url`; Gemini CLI uses `httpUrl`; Codex uses `url` plus `bearer_token_env_var` in `config.toml`. No key yet? Point the client at the endpoint without a header to browse the catalogue, then create a key on the website (below) and add the header.

### Option 3: Claude.ai and Claude Desktop custom connector

[Add PreReason as a custom connector](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=PreReason&connectorUrl=https%3A%2F%2Fapi.prereason.com%2Fapi%2Fmcp), choose "No sign-in", and where the Request headers section is available add `Authorization` with the value `Bearer YOUR_API_KEY` (the word Bearer and the space are part of the value). Sign in support for connectors is being re-tested and is not offered until it is verified.

## Get an API Key

Three ways, all free. The hosted server never hands out a key inside a session and never asks for one.

**Through this bridge.** Run it with no key set: it asks PreReason for access on your behalf and shows one `approve_url`, in its log and in front of any answer that needs a key. Open it, sign in or create your account, click Approve, and the bridge saves the key, attached to your account and named `Agent: <client_name>`.

**From code, for an agent with no browser.** `POST https://api.prereason.com/api/agent/claims` (no auth), show the human the `approve_url`, then poll `GET https://api.prereason.com/api/agent/claims/{claim_code}` with `Authorization: Bearer <claim_token>` until `status` is `approved`. Docs: [prereason.com/docs#agent-access](https://www.prereason.com/docs#agent-access).

**On the website.** Sign up at [prereason.com/signup](https://www.prereason.com/signup), then Dashboard > Settings > API Keys. Keys start with `pr_live_`.

## 5 MCP Tools

| Tool | Auth | Description |
|------|------|-------------|
| `list_briefings` | Open | List all 19 pre-reasoned market briefings with tier requirements |
| `list_metrics` | Open | List every available metric across the bitcoin, macro, calculated and eth categories |
| `get_health` | Open | API health check, version, account tier |
| `get_context` | Required | Fetch a pre-reasoned market briefing (markdown or JSON) |
| `get_metric` | Required | Fetch a single metric with trend/signal/percentile |

## 19 Market Briefings

### Free (6 briefings)
| Briefing | Description |
|----------|-------------|
| `btc.quick-check` | Minimal fast context: BTC + Net Liquidity + correlation |
| `btc.context` | BTC + liquidity + hash ribbon + difficulty + momentum |
| `macro.snapshot` | Fed balance, M2, treasury yields, dollar strength, net liquidity |
| `cross.correlations` | BTC correlation matrix vs macro indicators |
| `btc.pulse` | Price, 24h change, Bitcoin dominance |
| `btc.grid-stress` | Epoch pace and difficulty adjustment forecast |

### Basic - $19.99/mo (6 briefings)
| Briefing | Description |
|----------|-------------|
| `btc.momentum` | 200D MA support/resistance with 7d/30d/90d momentum and percentile rankings |
| `macro.liquidity` | Liquidity indicators with momentum analysis |
| `btc.on-chain` | Hash rate, difficulty, transactions, active addresses |
| `cross.breadth` | Breadth across SPY, QQQ and IWM, with Bitcoin's correlation to each |
| `btc.miner-survival` | Hashprice thermometer with miner stress scoring |
| `btc.etf-flows` | Spot BTC ETF net daily flows, aggregate AUM, and per-issuer breakdown |

### Pro - $49.99/mo (7 briefings)
| Briefing | Description |
|----------|-------------|
| `btc.full` | Full Bitcoin analysis: macro overlay, momentum, percentiles, correlations and narrative |
| `btc.factors` | Multi-factor attribution for BTC price movements |
| `cross.regime` | Regime classification (risk-on/risk-off/transition) with USDT.D risk sentiment |
| `fx.liquidity` | EUR/USD, USD/CNY and dollar strength, with net liquidity and Bitcoin correlations |
| `btc.energy` | Production cost model with gas input pressure |
| `btc.treasury` | Corporate Bitcoin treasury intelligence from SEC filings |
| `macro.rates` | Treasury par yield curve at every maturity, 1M to 30Y, breakeven inflation, 5y5y forward, Germany 10Y |

## Example Prompts

Once connected, try prompts like:

- "Give me the Bitcoin quick check"
- "Show me the macro snapshot"
- "What does the BTC context briefing say about market conditions?"
- "Get the bitcoin price metric with trend analysis"
- "What's the hash ribbon signal right now?"
- "List available briefings"

## Troubleshooting

### "Server disconnected" error
- Ensure Node.js 18+ is installed: `node --version`
- Check your API key starts with `pr_live_`
- Fully quit Claude Desktop (system tray > Quit) and reopen

### Tools not appearing
- Restart Claude Desktop after editing config
- Verify JSON syntax: `node -e "JSON.parse(require('fs').readFileSync('path/to/config','utf8'))"`

### Windows: "'C:\Program' is not recognized"

If you still see this error, ensure you're using the `env` block (not `--header` args) as shown in Quick Start above. If the issue persists, install globally and use `node`:

1. Run: `npm install -g @prereason/mcp`
2. Use this config (replace `YOUR_USER` with your Windows username):

```json
{
  "mcpServers": {
    "prereason": {
      "command": "node",
      "args": [
        "C:\\Users\\YOUR_USER\\AppData\\Roaming\\npm\\node_modules\\@prereason\\mcp\\bin\\cli.js"
      ],
      "env": {
        "PREREASON_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

### Auth errors on get_context / get_metric
- `list_briefings`, `list_metrics`, and `get_health` work without a key
- `get_context` and `get_metric` require a valid API key
- Get a free key at [prereason.com/signup](https://www.prereason.com/signup)

## Other MCP Clients

If your client supports remote HTTP servers, use [Quick Start Option 2](#option-2-direct-http-with-an-api-key-claude-code-cursor-windsurf-codex-gemini-cli-vs-code-scripts) above. The stdio bridge package is only needed for clients that require stdio transport (e.g. Claude Desktop).

## CLI Usage

```bash
# No key: the bridge asks for access and prints one link to approve
npx @prereason/mcp

# Ask for access now, save the key, exit (useful before a first run)
npx @prereason/mcp --login

# Forget the saved key
npx @prereason/mcp --logout

# Use a key from the environment (never asks)
PREREASON_API_KEY=pr_live_... npx @prereason/mcp

# Name the app the bridge runs in, so your dashboard names the connection
PREREASON_CLIENT=claude-desktop npx @prereason/mcp

# --header (backward compatible), a custom credentials file, a custom endpoint
npx @prereason/mcp --header "Authorization:Bearer YOUR_API_KEY"
npx @prereason/mcp --credentials-file /path/to/credentials.json
PREREASON_URL=https://custom.endpoint/mcp npx @prereason/mcp

npx @prereason/mcp --help
```

Key precedence: `PREREASON_API_KEY`, then `--header`, then the credentials file (`~/.prereason/credentials.json`, or `PREREASON_CREDENTIALS_FILE`, or `--credentials-file`), then the claim flow. The file holds the key and which claim issued it, never a claim token. On macOS and Linux the directory is created 0700 and the file 0600; Windows has no mode bits, so the file relies on your profile directory's permissions like every other credential store there.

## Claude Desktop extension (.mcpb)

`mcpb/manifest.json` describes the same bridge as a single click Claude Desktop extension, key optional. To build the bundle: `npm install --omit=dev`, then `npx @anthropic-ai/mcpb pack .` from the package directory, and install the resulting `.mcpb` by double clicking it. Submission to the Claude directory goes through the desktop extension form and is a publisher decision.

## No dependencies

The bridge ships its own transports and installs nothing. `npm ls` on it is one line, `npx @prereason/mcp` fetches one 23 KB tarball and starts, and the code a security review has to read is the code in this repository.

It used to depend on `@modelcontextprotocol/sdk` for two classes, a stdio transport and a Streamable HTTP client. That pulled in 91 packages and 25 MB on disk, nearly all of it the SDK server half: Express, Hono, CORS, a rate limiter, an OAuth client and a schema validator, none of which a relay ever calls. `lib/stdio.js` and `lib/streamable-http.js` replace the two classes the bridge used, keep their framing and their callbacks, and are covered by the suite under `test/`.

## Links

- [Documentation](https://www.prereason.com/docs#mcp)
- [Sign Up](https://www.prereason.com/signup)
- [API Discovery](https://www.prereason.com/.well-known/mcp/server.json)
- [Terms of Service](https://www.prereason.com/terms)
- [Privacy Policy](https://www.prereason.com/privacy)

## Privacy Policy

See [prereason.com/privacy](https://www.prereason.com/privacy) for data handling practices.

## License

MIT
