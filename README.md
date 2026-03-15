# @prereason/mcp

[![npm version](https://img.shields.io/npm/v/@prereason/mcp.svg)](https://www.npmjs.com/package/@prereason/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

MCP server for [PreReason](https://www.prereason.com): pre-analyzed Bitcoin and macro financial intelligence.

PreReason returns pre-analyzed market context: trend interpretation, momentum analysis, cross-asset correlations, and more. Use it when your task needs to understand market conditions for decision-making, not raw price feeds.

## Quick Start

### Option 1: Direct HTTP (Claude Code, Cursor, Windsurf, etc.)

Clients that support remote MCP servers can connect directly with no bridge package needed.

```bash
# Claude Code (CLI one-liner)
claude mcp add prereason --transport http https://api.prereason.com/api/mcp
```

Or add to `.mcp.json` / your client's MCP config:

```json
{
  "mcpServers": {
    "prereason": {
      "type": "http",
      "url": "https://api.prereason.com/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### Option 2: stdio bridge (Claude Desktop and other stdio-only clients)

**Requires [Node.js 18+](https://nodejs.org)**

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "prereason": {
      "command": "npx",
      "args": ["-y", "@prereason/mcp"],
      "env": {
        "PREREASON_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

Claude Desktop config file location:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Restart your MCP client after editing the config. PreReason should appear with 5 tools.

## Get an API Key

1. Sign up at [prereason.com/signup](https://www.prereason.com/signup)
2. Go to Dashboard > Settings > API Keys
3. Copy your key (starts with `pr_live_`)

## 5 MCP Tools

| Tool | Auth | Description |
|------|------|-------------|
| `list_templates` | Open | List all 17 context templates with tier requirements |
| `list_metrics` | Open | List all 38 available metrics: 30 API + 8 mining/energy (filterable by category) |
| `get_health` | Open | API health check, version, account tier |
| `get_context` | Required | Fetch a context template (markdown or JSON) |
| `get_metric` | Required | Fetch a single metric with trend/signal/percentile |

## 17 Context Templates

### Free (6 templates)
| Template | Description |
|----------|-------------|
| `btc.quick-check` | Minimal fast context: BTC + Net Liquidity + correlation |
| `btc.context` | BTC + liquidity + hash ribbon + difficulty + momentum |
| `macro.snapshot` | Fed balance, M2, treasury yields, VIX, net liquidity |
| `cross.correlations` | BTC correlation matrix vs macro indicators |
| `btc.pulse` | Volume, fees, mempool analysis |
| `btc.grid-stress` | Epoch pace and difficulty adjustment forecast |

### Basic - $19.99/mo (5 templates)
| Template | Description |
|----------|-------------|
| `btc.momentum` | 200D MA support/resistance with 7d/30d/90d momentum and YTD percentiles |
| `macro.liquidity` | Liquidity indicators with momentum analysis |
| `btc.on-chain` | Hash rate, difficulty, fees, mempool health |
| `cross.breadth` | Cross-asset breadth with SPY, DXY, VIX |
| `btc.miner-survival` | Hashprice thermometer with miner stress scoring |

### Pro - $49.99/mo (6 templates)
| Template | Description |
|----------|-------------|
| `btc.full` | Complete market intelligence with all metrics and analysis |
| `btc.factors` | Multi-factor attribution for BTC price movements |
| `cross.regime` | Regime classification (risk-on/risk-off/transition) with USDT.D risk sentiment |
| `fx.liquidity` | FX environment with DXY, treasury, and global liquidity |
| `btc.energy` | Production cost model with gas input pressure |
| `btc.treasury` | Corporate Bitcoin treasury intelligence from SEC filings |

## Example Prompts

Once connected, try prompts like:

- "What's the current BTC regime?"
- "Show me the macro snapshot"
- "What does the full context template say about market conditions?"
- "Get the bitcoin price metric with trend analysis"
- "What's the hash ribbon signal right now?"
- "List available templates"

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
- `list_templates`, `list_metrics`, and `get_health` work without a key
- `get_context` and `get_metric` require a valid API key
- Get a free key at [prereason.com/signup](https://www.prereason.com/signup)

## Other MCP Clients

If your client supports remote HTTP servers, use [Quick Start Option 1](#option-1-direct-http-claude-code-cursor-windsurf-etc) above. The stdio bridge package is only needed for clients that require stdio transport (e.g. Claude Desktop).

## CLI Usage

```bash
# Using environment variable (recommended)
PREREASON_API_KEY=pr_live_... npx @prereason/mcp

# Using --header flag (backward compatible)
npx @prereason/mcp --header "Authorization:Bearer YOUR_API_KEY"

# Custom URL
PREREASON_URL=https://custom.endpoint/mcp npx @prereason/mcp

# Help
npx @prereason/mcp --help
```

## Links

- [Documentation](https://www.prereason.com/docs#mcp)
- [Sign Up](https://www.prereason.com/signup)
- [API Discovery](https://www.prereason.com/.well-known/mcp/server.json)
- [Terms of Service](https://www.prereason.com/terms)
- [Privacy Policy](https://www.prereason.com/privacy)

## License

MIT
