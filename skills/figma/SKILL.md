---
name: figma
description: Work with Figma designs — inspect files and nodes, extract design tokens (colors, text styles, effects), export assets (PNG/SVG/PDF/JPG), and review design feedback. Use when the user mentions Figma, design specs, design tokens, or wants to pull assets from a Figma file.
---

# Figma Integration

Use when working with Figma designs — inspecting files, extracting design tokens, exporting assets, or reviewing design feedback.

## Available Tools

| Tool | Purpose |
|------|---------|
| `figma_get_file` | Get file structure and node tree |
| `figma_get_components` | List published components |
| `figma_get_styles` | List design styles/tokens |
| `figma_inspect_node` | Inspect a node's properties (fills, strokes, typography, auto-layout) |
| `figma_export_assets` | Export nodes as PNG/SVG/PDF/JPG |
| `figma_get_comments` | List file comments and feedback |
| `figma_search` | Search team files by name |
| `figma_get_images` | Get image fill URLs |

## Workflow

1. **Start with `figma_get_file`** to understand the file structure and page layout
2. **Drill down with `figma_inspect_node`** to get specific design properties (colors, spacing, typography)
3. **Extract tokens with `figma_get_styles`** for colors, text styles, and effects
4. **Export with `figma_export_assets`** to download icons, illustrations, and other assets

## Tips

- The `fileKey` can be a full Figma URL or just the key (e.g. `abc123`)
- Node IDs look like `1:23` — get them from the file tree in `figma_get_file`
- Use `depth=2` first for an overview, then increase for specific pages
- SVG is best for icons, PNG for raster assets
- Export scale: 1x for standard, 2x for retina, 4x for print

## Configuration

Reads from `~/.pi/agent/figma.json` or `.pi/figma.json`:

```json
{
  "personalAccessToken": "figd_...",
  "outputDir": "./figma-assets",
  "teamId": "optional-for-search"
}
```

Get a Personal Access Token at: https://www.figma.com/developers/api#access-tokens

Environment variable fallback: `FIGMA_PERSONAL_ACCESS_TOKEN`, `FIGMA_TEAM_ID`
