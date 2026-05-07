# pi-figma

Pi package for **Figma integration** — inspect files, components, styles, nodes, export assets, and read comments directly from Figma's REST API.

No MCP server needed. Zero runtime dependencies. Pure Figma REST API.

## Install

```bash
pi install npm:pi-figma
```

## Setup

Create `~/.pi/agent/figma.json`:

```json
{
  "personalAccessToken": "figd_your_token_here",
  "outputDir": "./figma-assets",
  "teamId": "optional-team-id-for-search"
}
```

Get a Personal Access Token at: https://www.figma.com/developers/api#access-tokens

Or use environment variables:
- `FIGMA_PERSONAL_ACCESS_TOKEN`
- `FIGMA_TEAM_ID`

## Tools

| Tool | Description |
|------|-------------|
| `figma_get_file` | Get file structure, pages, and node tree |
| `figma_get_components` | List published components and component sets |
| `figma_get_styles` | List design styles — colors, text, effects, grids |
| `figma_inspect_node` | Inspect a node: fills, strokes, typography, auto-layout, effects |
| `figma_export_assets` | Export nodes as PNG, SVG, PDF, or JPG |
| `figma_get_comments` | List comments and design feedback |
| `figma_search` | Search team files by name |
| `figma_get_images` | Get download URLs for image fills |

## Usage Examples

```
> Inspect the Figma file https://www.figma.com/file/abc123/My-Design

> Get all styles from Figma file abc123

> Export nodes 1:23 and 4:56 from file abc123 as SVG

> Show me the comments on the payment flow design file
```

## Features

- 🎨 **Full Figma REST API** — files, components, styles, nodes, images, comments
- 🔍 **Smart URL parsing** — accepts full Figma URLs or bare file keys
- 📦 **Asset export** — download PNG/SVG/PDF/JPG with configurable scale
- 🎯 **Node inspection** — CSS-ready properties: fills, strokes, typography, auto-layout
- 💬 **Design feedback** — read comments and resolved status
- 🔒 **Config flexibility** — JSON config, env vars, or `ENV:` prefix for secrets
- 🖥️ **Rich TUI rendering** — custom display for every tool in pi's terminal UI
- 📋 **Figma skill** — contextual guidance for working with Figma designs

## License

MIT
