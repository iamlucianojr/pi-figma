/**
 * pi-figma — Inspect Figma files, components, styles, and export assets
 *
 * Tools:
 *   - figma_get_file       — Get a Figma file's structure and metadata
 *   - figma_get_components — List components/component sets in a file
 *   - figma_get_styles     — List published styles (colors, text, effects)
 *   - figma_inspect_node   — Inspect a specific node's properties and CSS
 *   - figma_export_assets  — Export node images (PNG/SVG/PDF/JPG)
 *   - figma_get_comments   — List comments on a Figma file
 *   - figma_search         — Search Figma team/project files
 *   - figma_get_images     — Get image fills from a file
 *
 * Configuration:
 *   ~/.pi/agent/figma.json or .pi/figma.json
 *
 *   {
 *     "personalAccessToken": "your-figma-pat",
 *     "outputDir": "./figma-assets",
 *     "teamId": "optional-team-id-for-search"
 *   }
 *
 * Get a PAT at: https://www.figma.com/developers/api#access-tokens
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text, Container, Spacer } from "@mariozechner/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface FigmaConfig {
  personalAccessToken: string;
  outputDir: string;
  teamId?: string;
}

interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

function resolveValue(val: string): string {
  if (val.startsWith("ENV:")) {
    return process.env[val.slice(4)] ?? "";
  }
  return val;
}

function getConfigPaths(cwd: string): string[] {
  return [
    join(cwd, ".pi", "figma.json"),
    join(getAgentDir(), "figma.json"),
  ];
}

function loadConfig(cwd: string): FigmaConfig | undefined {
  const paths = getConfigPaths(cwd);
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf-8"));
        const cfg: FigmaConfig = {
          personalAccessToken: resolveValue(raw.personalAccessToken ?? ""),
          outputDir: raw.outputDir ?? "./figma-assets",
          teamId: raw.teamId,
        };
        if (cfg.personalAccessToken && !cfg.personalAccessToken.includes("YOUR_")) {
          return cfg;
        }
      } catch {
        /* ignore bad JSON */
      }
    }
  }
  const token = process.env.FIGMA_PERSONAL_ACCESS_TOKEN;
  if (token) {
    return {
      personalAccessToken: token,
      outputDir: "./figma-assets",
      teamId: process.env.FIGMA_TEAM_ID,
    };
  }
  return undefined;
}

function scaffoldConfig(cwd: string): string | undefined {
  const paths = getConfigPaths(cwd);
  if (paths.some((p) => existsSync(p))) return undefined;

  const projectPath = paths[0];
  const dir = join(cwd, ".pi");
  mkdirSync(dir, { recursive: true });

  const template = {
    $comment: "Get a PAT at https://www.figma.com/developers/api#access-tokens",
    personalAccessToken: "YOUR_FIGMA_PERSONAL_ACCESS_TOKEN",
    outputDir: "./figma-assets",
    teamId: "",
  };

  writeFileSync(projectPath, JSON.stringify(template, null, 2) + "\n", "utf-8");
  return projectPath;
}

// ═══════════════════════════════════════════════════════════════════
// Figma API Client
// ═══════════════════════════════════════════════════════════════════

const FIGMA_API = "https://api.figma.com/v1";

async function figmaFetch(config: FigmaConfig, path: string, signal?: AbortSignal): Promise<any> {
  const url = `${FIGMA_API}${path}`;
  const res = await fetch(url, {
    headers: { "X-Figma-Token": config.personalAccessToken },
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Figma API ${res.status}: ${res.statusText}${body ? ` — ${body}` : ""}`);
  }
  return res.json();
}

function parseFileKey(input: string): string {
  const urlMatch = input.match(/figma\.com\/(?:file|design|board)\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  return input.replace(/[^a-zA-Z0-9]/g, "");
}

function rgbaToHex(c: FigmaColor): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  const a = Math.round(c.a * 255);
  if (a === 255)
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${a.toString(16).padStart(2, "0")}`;
}

function truncateNodeTree(node: any, depth: number, maxChildren: number): any {
  if (!node) return node;
  const result: any = { id: node.id, name: node.name, type: node.type };
  if (node.absoluteBoundingBox) result.bounds = node.absoluteBoundingBox;
  if (node.children && depth > 0) {
    const kids = node.children.slice(0, maxChildren);
    result.children = kids.map((c: any) => truncateNodeTree(c, depth - 1, maxChildren));
    if (node.children.length > maxChildren) {
      result.childrenTruncated = `${node.children.length - maxChildren} more`;
    }
  } else if (node.children) {
    result.childCount = node.children.length;
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// Extension Entry Point
// ═══════════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
  let config: FigmaConfig | undefined;

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx.cwd);
    if (config) {
      ctx.ui.setStatus("figma", "🎨 Figma");
    } else {
      const settingsPath = scaffoldConfig(ctx.cwd);
      if (settingsPath) {
        ctx.ui.notify(`Figma: config created at ${settingsPath} — add your PAT, then /reload.`, "warning");
      }
    }
  });

  function requireConfig(): FigmaConfig {
    if (!config)
      throw new Error("Figma not configured. Add your PAT to ~/.pi/agent/figma.json or .pi/figma.json, then /reload.");
    return config;
  }

  function makeRenderCall(label: string, getExtra: (args: any) => string) {
    return function renderCall(args: any, theme: any, context: any) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      text.setText(
        theme.fg("toolTitle", theme.bold("figma ")) +
          theme.fg("accent", label + " ") +
          theme.fg("muted", getExtra(args)),
      );
      return text;
    };
  }

  // ══════════════════════════════════════════════════════════════
  // figma_get_file
  // ══════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "figma_get_file",
    label: "Figma: Get File",
    description:
      "Retrieve a Figma file's metadata and node tree structure. " +
      "Returns the file name, last modified date, pages, and a truncated node tree.",
    promptSnippet: "Get the structure of a Figma design file",
    promptGuidelines: [
      "Use figma_get_file to understand file structure before inspecting specific nodes.",
      "The fileKey can be a full Figma URL or just the key portion.",
      "Start with depth=2 for overview, then go deeper on specific pages.",
    ],
    parameters: Type.Object({
      fileKey: Type.String({ description: "Figma file key or full URL" }),
      depth: Type.Optional(Type.Number({ description: "Node tree depth (default: 2, max: 5)" })),
    }),

    async execute(_id, params, signal) {
      const cfg = requireConfig();
      const key = parseFileKey(params.fileKey);
      const depth = Math.min(params.depth ?? 2, 5);

      const data = await figmaFetch(cfg, `/files/${key}?depth=${depth}`, signal);
      const tree = truncateNodeTree(data.document, depth, 20);

      return {
        content: [{
          type: "text",
          text: [
            `# ${data.name}`,
            `Last modified: ${data.lastModified}`,
            `Version: ${data.version}`,
            `Pages: ${data.document?.children?.length ?? 0}`,
            "",
            "## Node Tree",
            "```json",
            JSON.stringify(tree, null, 2),
            "```",
          ].join("\n"),
        }],
        details: {
          name: data.name,
          lastModified: data.lastModified,
          version: data.version,
          pageCount: data.document?.children?.length ?? 0,
          pages: data.document?.children?.map((p: any) => ({ id: p.id, name: p.name })) ?? [],
        },
      };
    },

    renderCall: makeRenderCall("get-file", (args) => {
      let s = args.fileKey ? parseFileKey(args.fileKey) : "...";
      if (args.depth) s += ` depth=${args.depth}`;
      return s;
    }),

    renderResult(result, { isPartial, expanded }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "⏳ Fetching file…"), 0, 0);
      const d = result.details as any;
      if (!d) return new Text(theme.fg("error", "✗ No data"), 0, 0);
      const container = new Container();
      container.addChild(new Text(
        theme.fg("success", "✓ ") + theme.fg("text", theme.bold(d.name)) + theme.fg("dim", ` — ${d.pageCount} page(s)`), 0, 0));
      if (expanded && d.pages?.length) {
        container.addChild(new Spacer(1));
        for (const page of d.pages) {
          container.addChild(new Text(theme.fg("muted", `  📄 ${page.name}`) + theme.fg("dim", ` (${page.id})`), 0, 0));
        }
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", `  Modified: ${d.lastModified}`), 0, 0));
      }
      return container;
    },
  });

  // ══════════════════════════════════════════════════════════════
  // figma_get_components
  // ══════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "figma_get_components",
    label: "Figma: Get Components",
    description: "List all components and component sets published in a Figma file.",
    promptSnippet: "List components in a Figma file",
    parameters: Type.Object({
      fileKey: Type.String({ description: "Figma file key or full URL" }),
    }),

    async execute(_id, params, signal) {
      const cfg = requireConfig();
      const key = parseFileKey(params.fileKey);
      const data = await figmaFetch(cfg, `/files/${key}/components`, signal);
      const components = data.meta?.components ?? [];

      const lines = components.map((c: any) =>
        `- **${c.name}** (key: \`${c.key}\`)\n  Node: \`${c.node_id}\` | ${c.description || "No description"}`);

      return {
        content: [{
          type: "text",
          text: components.length
            ? `# Components (${components.length})\n\n${lines.join("\n\n")}`
            : "No published components found.",
        }],
        details: {
          count: components.length,
          components: components.map((c: any) => ({
            name: c.name, key: c.key, nodeId: c.node_id,
            description: c.description || "",
            containingFrame: c.containing_frame?.name ?? "",
          })),
        },
      };
    },

    renderCall: makeRenderCall("components", (args) => args.fileKey ? parseFileKey(args.fileKey) : "..."),

    renderResult(result, { isPartial, expanded }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "⏳ Fetching components…"), 0, 0);
      const d = result.details as any;
      if (!d) return new Text(theme.fg("error", "✗ No data"), 0, 0);
      const container = new Container();
      container.addChild(new Text(theme.fg("success", "✓ ") + theme.fg("text", `${d.count} component(s)`), 0, 0));
      if (expanded && d.components?.length) {
        container.addChild(new Spacer(1));
        for (const c of d.components.slice(0, 30)) {
          let line = theme.fg("accent", `  ⬡ ${c.name}`);
          if (c.containingFrame) line += theme.fg("dim", ` in ${c.containingFrame}`);
          if (c.description) line += theme.fg("muted", ` — ${c.description}`);
          container.addChild(new Text(line, 0, 0));
        }
        if (d.count > 30) container.addChild(new Text(theme.fg("dim", `  … and ${d.count - 30} more`), 0, 0));
      }
      return container;
    },
  });

  // ══════════════════════════════════════════════════════════════
  // figma_get_styles
  // ══════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "figma_get_styles",
    label: "Figma: Get Styles",
    description: "List all published styles in a Figma file — colors, text styles, effects, and grids.",
    promptSnippet: "List design styles/tokens from a Figma file",
    parameters: Type.Object({
      fileKey: Type.String({ description: "Figma file key or full URL" }),
    }),

    async execute(_id, params, signal) {
      const cfg = requireConfig();
      const key = parseFileKey(params.fileKey);
      const data = await figmaFetch(cfg, `/files/${key}/styles`, signal);
      const styles = data.meta?.styles ?? [];

      const grouped: Record<string, any[]> = {};
      for (const s of styles) {
        const type = s.style_type || "OTHER";
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push(s);
      }

      const sections = Object.entries(grouped).map(([type, items]) => {
        const list = items.map((s: any) =>
          `- **${s.name}** (key: \`${s.key}\`, node: \`${s.node_id}\`)${s.description ? ` — ${s.description}` : ""}`).join("\n");
        return `## ${type} (${items.length})\n\n${list}`;
      });

      return {
        content: [{
          type: "text",
          text: styles.length ? `# Styles (${styles.length})\n\n${sections.join("\n\n")}` : "No published styles found.",
        }],
        details: {
          count: styles.length,
          grouped: Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, v.map((s: any) => ({
            name: s.name, key: s.key, nodeId: s.node_id, description: s.description || "",
          }))])),
        },
      };
    },

    renderCall: makeRenderCall("styles", (args) => args.fileKey ? parseFileKey(args.fileKey) : "..."),

    renderResult(result, { isPartial, expanded }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "⏳ Fetching styles…"), 0, 0);
      const d = result.details as any;
      if (!d) return new Text(theme.fg("error", "✗ No data"), 0, 0);
      const types = Object.keys(d.grouped || {});
      const container = new Container();
      container.addChild(new Text(
        theme.fg("success", "✓ ") + theme.fg("text", `${d.count} style(s)`) + theme.fg("dim", ` (${types.join(", ")})`), 0, 0));
      if (expanded && d.grouped) {
        for (const [type, items] of Object.entries(d.grouped) as [string, any[]][]) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("accent", `  ${type} (${items.length})`), 0, 0));
          for (const s of items.slice(0, 15)) {
            container.addChild(new Text(
              theme.fg("muted", `    🎨 ${s.name}`) + (s.description ? theme.fg("dim", ` — ${s.description}`) : ""), 0, 0));
          }
          if (items.length > 15) container.addChild(new Text(theme.fg("dim", `    … and ${items.length - 15} more`), 0, 0));
        }
      }
      return container;
    },
  });

  // ══════════════════════════════════════════════════════════════
  // figma_inspect_node
  // ══════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "figma_inspect_node",
    label: "Figma: Inspect Node",
    description:
      "Inspect a specific node in a Figma file. Returns dimensions, fills, strokes, effects, " +
      "typography, auto-layout, constraints, and children.",
    promptSnippet: "Inspect a Figma node's design properties",
    promptGuidelines: [
      "Use after figma_get_file to drill into specific nodes.",
      "Node IDs look like '1:23' — get them from the file tree.",
    ],
    parameters: Type.Object({
      fileKey: Type.String({ description: "Figma file key or full URL" }),
      nodeId: Type.String({ description: "Node ID to inspect (e.g. '1:23')" }),
    }),

    async execute(_id, params, signal) {
      const cfg = requireConfig();
      const key = parseFileKey(params.fileKey);
      const nodeId = params.nodeId;

      const data = await figmaFetch(cfg, `/files/${key}/nodes?ids=${encodeURIComponent(nodeId)}`, signal);
      const nodeData = data.nodes?.[nodeId];
      if (!nodeData?.document) throw new Error(`Node "${nodeId}" not found.`);
      const node = nodeData.document;

      const props: Record<string, any> = {
        id: node.id, name: node.name, type: node.type, visible: node.visible ?? true,
      };

      if (node.absoluteBoundingBox) {
        const b = node.absoluteBoundingBox;
        props.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      }

      if (node.fills?.length) {
        props.fills = node.fills.map((f: any) => {
          const fill: any = { type: f.type, opacity: f.opacity ?? 1 };
          if (f.color) fill.color = rgbaToHex(f.color);
          if (f.gradientStops) {
            fill.gradientStops = f.gradientStops.map((s: any) => ({ color: rgbaToHex(s.color), position: s.position }));
          }
          return fill;
        });
      }

      if (node.strokes?.length) {
        props.strokes = node.strokes.map((s: any) => ({ type: s.type, color: s.color ? rgbaToHex(s.color) : undefined }));
        props.strokeWeight = node.strokeWeight;
      }

      if (node.effects?.length) {
        props.effects = node.effects.map((e: any) => ({
          type: e.type, radius: e.radius, color: e.color ? rgbaToHex(e.color) : undefined,
          offset: e.offset, visible: e.visible ?? true,
        }));
      }

      if (node.cornerRadius !== undefined) props.cornerRadius = node.cornerRadius;
      if (node.rectangleCornerRadii) props.cornerRadii = node.rectangleCornerRadii;

      if (node.style) {
        props.textStyle = {
          fontFamily: node.style.fontFamily, fontSize: node.style.fontSize,
          fontWeight: node.style.fontWeight, lineHeightPx: node.style.lineHeightPx,
          letterSpacing: node.style.letterSpacing, textAlignHorizontal: node.style.textAlignHorizontal,
        };
      }
      if (node.characters !== undefined) props.text = node.characters;

      if (node.layoutMode) {
        props.autoLayout = {
          mode: node.layoutMode,
          primaryAxisAlignItems: node.primaryAxisAlignItems,
          counterAxisAlignItems: node.counterAxisAlignItems,
          paddingLeft: node.paddingLeft, paddingRight: node.paddingRight,
          paddingTop: node.paddingTop, paddingBottom: node.paddingBottom,
          itemSpacing: node.itemSpacing,
        };
      }

      if (node.constraints) props.constraints = node.constraints;

      if (node.children?.length) {
        props.children = node.children.map((c: any) => ({ id: c.id, name: c.name, type: c.type }));
      }

      return {
        content: [{
          type: "text",
          text: `# ${node.name} (${node.type})\n\`\`\`json\n${JSON.stringify(props, null, 2)}\n\`\`\``,
        }],
        details: props,
      };
    },

    renderCall: makeRenderCall("inspect", (args) => args.nodeId ?? "..."),

    renderResult(result, { isPartial, expanded }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "⏳ Inspecting node…"), 0, 0);
      const d = result.details as any;
      if (!d) return new Text(theme.fg("error", "✗ No data"), 0, 0);
      const container = new Container();
      let summary = theme.fg("success", "✓ ") + theme.fg("text", theme.bold(d.name)) + theme.fg("dim", ` (${d.type})`);
      if (d.bounds) summary += theme.fg("muted", ` ${d.bounds.width}×${d.bounds.height}`);
      container.addChild(new Text(summary, 0, 0));

      if (expanded) {
        if (d.fills?.length) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("accent", "  Fills:"), 0, 0));
          for (const f of d.fills) {
            container.addChild(new Text(theme.fg("muted", `    ${f.type}`) + (f.color ? " " + theme.fg("text", f.color) : ""), 0, 0));
          }
        }
        if (d.textStyle) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("accent", "  Typography:"), 0, 0));
          const ts = d.textStyle;
          container.addChild(new Text(theme.fg("muted", `    ${ts.fontFamily} ${ts.fontWeight} ${ts.fontSize}px`), 0, 0));
        }
        if (d.autoLayout) {
          container.addChild(new Spacer(1));
          const al = d.autoLayout;
          container.addChild(new Text(theme.fg("accent", "  Auto Layout: ") + theme.fg("muted", `${al.mode} gap=${al.itemSpacing}px`), 0, 0));
        }
        if (d.children?.length) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("accent", `  Children (${d.children.length}):`), 0, 0));
          for (const c of d.children.slice(0, 20)) {
            container.addChild(new Text(theme.fg("dim", `    ${c.type} `) + theme.fg("muted", c.name) + theme.fg("dim", ` (${c.id})`), 0, 0));
          }
          if (d.children.length > 20) container.addChild(new Text(theme.fg("dim", `    … and ${d.children.length - 20} more`), 0, 0));
        }
      }
      return container;
    },
  });

  // ══════════════════════════════════════════════════════════════
  // figma_export_assets
  // ══════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "figma_export_assets",
    label: "Figma: Export Assets",
    description: "Export Figma nodes as images (PNG, SVG, PDF, JPG). Downloads to the configured output directory.",
    promptSnippet: "Export Figma design nodes as image files",
    promptGuidelines: [
      "Use node IDs from figma_get_file or figma_get_components.",
      "SVG for icons, PNG for raster. Default scale is 2x.",
    ],
    parameters: Type.Object({
      fileKey: Type.String({ description: "Figma file key or full URL" }),
      nodeIds: Type.Array(Type.String(), { description: "Node IDs to export" }),
      format: Type.Optional(Type.Unsafe<"png" | "svg" | "pdf" | "jpg">(StringEnum(["png", "svg", "pdf", "jpg"] as const))),
      scale: Type.Optional(Type.Number({ description: "Export scale (default: 2, range: 0.01–4)" })),
    }),

    async execute(_id, params, signal, _onUpdate, ctx) {
      const cfg = requireConfig();
      const key = parseFileKey(params.fileKey);
      const format = params.format ?? "png";
      const scale = Math.max(0.01, Math.min(4, params.scale ?? 2));
      const ids = params.nodeIds.join(",");

      const data = await figmaFetch(cfg, `/images/${key}?ids=${encodeURIComponent(ids)}&format=${format}&scale=${scale}`, signal);
      if (data.err) throw new Error(`Figma export error: ${data.err}`);

      const images = data.images as Record<string, string | null>;
      const outputDir = join(ctx.cwd, cfg.outputDir);
      mkdirSync(outputDir, { recursive: true });

      const saved: { nodeId: string; path: string }[] = [];
      const failed: { nodeId: string; reason: string }[] = [];

      for (const [nodeId, url] of Object.entries(images)) {
        if (!url) { failed.push({ nodeId, reason: "No export URL" }); continue; }
        try {
          const res = await fetch(url, { signal });
          if (!res.ok) { failed.push({ nodeId, reason: `HTTP ${res.status}` }); continue; }
          const buffer = Buffer.from(await res.arrayBuffer());
          const safeName = nodeId.replace(/[:/]/g, "-");
          const filepath = join(outputDir, `${safeName}.${format}`);
          writeFileSync(filepath, buffer);
          saved.push({ nodeId, path: filepath });
        } catch (err: any) {
          failed.push({ nodeId, reason: err.message ?? "Download failed" });
        }
      }

      const lines: string[] = [];
      if (saved.length) { lines.push(`## Exported (${saved.length})`); for (const s of saved) lines.push(`- \`${s.nodeId}\` → \`${s.path}\``); }
      if (failed.length) { lines.push(`## Failed (${failed.length})`); for (const f of failed) lines.push(`- \`${f.nodeId}\`: ${f.reason}`); }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { saved, failed, format, scale, outputDir },
      };
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const count = (args.nodeIds as string[])?.length ?? 0;
      text.setText(theme.fg("toolTitle", theme.bold("figma ")) + theme.fg("accent", "export ") +
        theme.fg("muted", `${count} node(s)`) + theme.fg("dim", ` as ${args.format ?? "png"} @${args.scale ?? 2}x`));
      return text;
    },

    renderResult(result, { isPartial, expanded }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "⏳ Exporting…"), 0, 0);
      const d = result.details as any;
      if (!d) return new Text(theme.fg("error", "✗ No data"), 0, 0);
      const container = new Container();
      const hasFailures = d.failed?.length > 0;
      container.addChild(new Text(
        (hasFailures ? theme.fg("warning", "⚠ ") : theme.fg("success", "✓ ")) +
        theme.fg("text", `${d.saved?.length ?? 0} exported`) +
        (hasFailures ? theme.fg("error", `, ${d.failed.length} failed`) : "") +
        theme.fg("dim", ` (${d.format} @${d.scale}x)`), 0, 0));
      if (expanded) {
        for (const s of d.saved ?? []) container.addChild(new Text(theme.fg("success", "  ✓ ") + theme.fg("muted", `${s.nodeId} → ${s.path}`), 0, 0));
        for (const f of d.failed ?? []) container.addChild(new Text(theme.fg("error", "  ✗ ") + theme.fg("muted", `${f.nodeId}: ${f.reason}`), 0, 0));
      }
      return container;
    },
  });

  // ══════════════════════════════════════════════════════════════
  // figma_get_comments
  // ══════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "figma_get_comments",
    label: "Figma: Get Comments",
    description: "Retrieve all comments on a Figma file with author, date, and resolved status.",
    promptSnippet: "List comments and feedback on a Figma file",
    parameters: Type.Object({
      fileKey: Type.String({ description: "Figma file key or full URL" }),
    }),

    async execute(_id, params, signal) {
      const cfg = requireConfig();
      const key = parseFileKey(params.fileKey);
      const data = await figmaFetch(cfg, `/files/${key}/comments`, signal);
      const comments = data.comments ?? [];

      const lines = comments.map((c: any) => {
        const resolved = c.resolved_at ? " ✅ Resolved" : "";
        const date = new Date(c.created_at).toLocaleDateString();
        return `- **${c.user?.handle ?? "Unknown"}** (${date})${resolved}\n  ${c.message}`;
      });

      return {
        content: [{
          type: "text",
          text: comments.length ? `# Comments (${comments.length})\n\n${lines.join("\n\n")}` : "No comments.",
        }],
        details: {
          count: comments.length,
          comments: comments.map((c: any) => ({
            id: c.id, message: c.message, author: c.user?.handle ?? "Unknown",
            createdAt: c.created_at, resolved: !!c.resolved_at,
          })),
        },
      };
    },

    renderCall: makeRenderCall("comments", (args) => args.fileKey ? parseFileKey(args.fileKey) : "..."),

    renderResult(result, { isPartial, expanded }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "⏳ Fetching comments…"), 0, 0);
      const d = result.details as any;
      if (!d) return new Text(theme.fg("error", "✗ No data"), 0, 0);
      const resolved = d.comments?.filter((c: any) => c.resolved).length ?? 0;
      const container = new Container();
      container.addChild(new Text(
        theme.fg("success", "✓ ") + theme.fg("text", `${d.count} comment(s)`) + theme.fg("dim", ` (${resolved} resolved)`), 0, 0));
      if (expanded && d.comments?.length) {
        container.addChild(new Spacer(1));
        for (const c of d.comments.slice(0, 25)) {
          const icon = c.resolved ? "✅" : "💬";
          const date = new Date(c.createdAt).toLocaleDateString();
          container.addChild(new Text(
            `  ${icon} ` + theme.fg("accent", c.author) + theme.fg("dim", ` (${date})`) +
            theme.fg("muted", ` — ${c.message.slice(0, 80)}${c.message.length > 80 ? "…" : ""}`), 0, 0));
        }
        if (d.count > 25) container.addChild(new Text(theme.fg("dim", `  … and ${d.count - 25} more`), 0, 0));
      }
      return container;
    },
  });

  // ══════════════════════════════════════════════════════════════
  // figma_search
  // ══════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "figma_search",
    label: "Figma: Search Files",
    description: "Search for Figma files within a team. Requires teamId in config or as parameter.",
    promptSnippet: "Search Figma team files by name",
    promptGuidelines: ["Requires a teamId — set it in figma.json or pass it as a parameter."],
    parameters: Type.Object({
      query: Type.String({ description: "Search query for file names" }),
      teamId: Type.Optional(Type.String({ description: "Team ID (uses config if not provided)" })),
    }),

    async execute(_id, params, signal) {
      const cfg = requireConfig();
      const teamId = params.teamId || cfg.teamId;
      if (!teamId) throw new Error('No teamId. Set "teamId" in figma.json or pass it as a parameter.');

      const data = await figmaFetch(cfg, `/teams/${teamId}/projects`, signal);
      const projects = data.projects ?? [];

      const allFiles: any[] = [];
      for (const project of projects) {
        try {
          const projectData = await figmaFetch(cfg, `/projects/${project.id}/files`, signal);
          const files = (projectData.files ?? []).map((f: any) => ({ ...f, projectName: project.name, projectId: project.id }));
          allFiles.push(...files);
        } catch { /* skip inaccessible projects */ }
      }

      const query = params.query.toLowerCase();
      const matched = allFiles.filter((f) =>
        f.name?.toLowerCase().includes(query) || f.projectName?.toLowerCase().includes(query));

      const lines = matched.map((f: any) =>
        `- **${f.name}** (key: \`${f.key}\`)\n  Project: ${f.projectName} | Modified: ${f.last_modified}`);

      return {
        content: [{
          type: "text",
          text: matched.length
            ? `# Search Results (${matched.length})\n\n${lines.join("\n\n")}`
            : `No files matching "${params.query}".`,
        }],
        details: {
          query: params.query, count: matched.length,
          files: matched.map((f: any) => ({
            name: f.name, key: f.key, projectName: f.projectName,
            lastModified: f.last_modified, thumbnailUrl: f.thumbnail_url,
          })),
        },
      };
    },

    renderCall: makeRenderCall("search", (args) => `"${args.query ?? "..."}"`),

    renderResult(result, { isPartial, expanded }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "⏳ Searching…"), 0, 0);
      const d = result.details as any;
      if (!d) return new Text(theme.fg("error", "✗ No data"), 0, 0);
      const container = new Container();
      container.addChild(new Text(
        theme.fg("success", "✓ ") + theme.fg("text", `${d.count} file(s)`) + theme.fg("dim", ` for "${d.query}"`), 0, 0));
      if (expanded && d.files?.length) {
        container.addChild(new Spacer(1));
        for (const f of d.files.slice(0, 20)) {
          container.addChild(new Text(
            theme.fg("accent", `  📁 ${f.name}`) + theme.fg("dim", ` (${f.key})`) + theme.fg("muted", ` — ${f.projectName}`), 0, 0));
        }
        if (d.count > 20) container.addChild(new Text(theme.fg("dim", `  … and ${d.count - 20} more`), 0, 0));
      }
      return container;
    },
  });

  // ══════════════════════════════════════════════════════════════
  // figma_get_images
  // ══════════════════════════════════════════════════════════════
  pi.registerTool({
    name: "figma_get_images",
    label: "Figma: Get Image Fills",
    description: "Get download URLs for all image fills used in a Figma file.",
    promptSnippet: "Get image fill URLs from a Figma file",
    parameters: Type.Object({
      fileKey: Type.String({ description: "Figma file key or full URL" }),
    }),

    async execute(_id, params, signal) {
      const cfg = requireConfig();
      const key = parseFileKey(params.fileKey);
      const data = await figmaFetch(cfg, `/files/${key}/images`, signal);
      const images = data.meta?.images ?? {};
      const entries = Object.entries(images);

      return {
        content: [{
          type: "text",
          text: entries.length
            ? `# Image Fills (${entries.length})\n\n${entries.map(([ref, url]) => `- \`${ref}\` → ${url}`).join("\n")}`
            : "No image fills in this file.",
        }],
        details: { count: entries.length, images },
      };
    },

    renderCall: makeRenderCall("images", (args) => args.fileKey ? parseFileKey(args.fileKey) : "..."),

    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "⏳ Fetching images…"), 0, 0);
      const d = result.details as any;
      if (!d) return new Text(theme.fg("error", "✗ No data"), 0, 0);
      return new Text(theme.fg("success", "✓ ") + theme.fg("text", `${d.count} image fill(s)`), 0, 0);
    },
  });
}
