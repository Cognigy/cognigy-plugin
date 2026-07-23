/**
 * Deterministic flow-chart serializers.
 *
 * Input: the object returned by `GET /new/v2.0/flows/{flowId}/chart`
 *   { nodes: [{ _id|id, type, label?, preview? }],
 *     relations: [{ node, next?: string|string[]|null, children?: string[] }] }
 *   (`next` is a single id string in the live API — see nextIds).
 *
 * Output: a picture as a string — ASCII tree (terminal-native), mermaid
 * (renders inline in Desktop/web, or in a ```mermaid fenced block), or a
 * self-contained HTML page (open in a browser). No API calls, no MCP deps:
 * pure JSON in, string out. The engine builds these so the model never
 * re-derives the graph (no hallucinated edges, ~0 token cost).
 *
 * Used by manage_flow_nodes { operation: "render" }.
 */

export interface ChartNode {
  _id?: string;
  id?: string;
  type?: string;
  label?: string;
  preview?: string | { text?: string | string[]; aiAgentName?: string };
}

export interface ChartRelation {
  node: string;
  // The API returns a single id string (or null); older/test data may use an
  // array. Read it via nextIds() which normalizes both to string[].
  next?: string | string[] | null;
  children?: string[];
}

export interface Chart {
  nodes?: ChartNode[];
  relations?: ChartRelation[];
}

interface Indexed {
  byId: Map<string, ChartNode>;
  rel: Map<string, ChartRelation>;
  startId: string | undefined;
}

// ---- shared indexing / walk -------------------------------------------------

function nodeId(n: ChartNode): string {
  return (n._id ?? n.id ?? "") as string;
}

// The API sends `next` as a single id string (or null). Normalize any shape
// (string | string[] | null) to a string[] so the walk is uniform.
function nextIds(r: ChartRelation | undefined): string[] {
  const n = r?.next;
  if (!n) return [];
  return Array.isArray(n) ? n : [n];
}

function nodeLabel(n: ChartNode | undefined): string {
  if (!n) return "(unknown)";
  const p = n.preview;
  // AI Agent job nodes carry the agent's name in preview — prefer it, since
  // the label is just the generic "AI Agent" (matches how the UI titles it).
  if (p && typeof p === "object" && p.aiAgentName?.trim()) {
    return p.aiAgentName.trim();
  }
  if (typeof n.label === "string" && n.label.trim()) return n.label.trim();
  const prev =
    typeof p === "string"
      ? p
      : Array.isArray(p?.text)
        ? p?.text.join(" ")
        : p?.text;
  if (prev && prev.trim()) return prev.trim();
  return n.type ?? "node";
}

function index(chart: Chart): Indexed {
  const byId = new Map<string, ChartNode>();
  for (const n of chart.nodes ?? []) byId.set(nodeId(n), n);

  const rel = new Map<string, ChartRelation>();
  for (const r of chart.relations ?? []) rel.set(r.node, r);

  // Real root = the `start` node (isEntryPoint is unreliable — aiAgentJob
  // always reports true). Fall back to any node nothing points at.
  let startId = [...byId.values()].find((n) => n.type === "start");
  if (!startId) {
    const pointed = new Set<string>();
    for (const r of chart.relations ?? []) {
      for (const x of nextIds(r)) pointed.add(x);
      for (const x of r.children ?? []) pointed.add(x);
    }
    startId = [...byId.values()].find((n) => !pointed.has(nodeId(n)));
  }

  return { byId, rel, startId: startId ? nodeId(startId) : undefined };
}

// ---- ASCII tree (terminal-native) ------------------------------------------

const GLYPH: Record<string, string> = {
  start: "●",
  end: "■",
  aiAgentJob: "◆",
  ifElse: "◇",
  switch: "◇",
  say: "▭",
  question: "▭",
};

function glyph(type: string | undefined): string {
  return (type && GLYPH[type]) || "▢";
}

// focus may be a single id or several — normalize to a Set.
function focusSet(focus?: string | string[]): Set<string> {
  if (!focus) return new Set();
  return new Set(Array.isArray(focus) ? focus : [focus]);
}

/**
 * Walk the `next` chain vertically; nest `children` with tree branches.
 * `focus` (optional) marks one or more nodes with «» for partial-render
 * highlight.
 */
export function chartToAscii(chart: Chart, focus?: string | string[]): string {
  const { byId, rel, startId } = index(chart);
  if (!startId) return "(empty flow)";

  const out: string[] = [];
  const seen = new Set<string>();
  const focused = focusSet(focus);

  const label = (id: string) => nodeLabel(byId.get(id));
  const line = (id: string, prefix: string, conn: string) =>
    `${prefix}${conn}${glyph(byId.get(id)?.type)} ${label(id)}` +
    (focused.has(id) ? "  «here»" : "");

  // Follow the `next` chain from a node, guarding loops.
  function chainOf(startId: string): string[] {
    const ids: string[] = [];
    let cur: string | undefined = startId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      ids.push(cur);
      cur = nextIds(rel.get(cur))[0];
    }
    if (cur) ids.push(`↺:${cur}`); // loop marker
    return ids;
  }

  // Render a `children` branch. Each child may open its own next-chain.
  function renderKids(kids: string[], prefix: string) {
    kids.forEach((cid, i) => {
      const last = i === kids.length - 1;
      const cont = prefix + (last ? "   " : "│  ");
      const chain = chainOf(cid);
      chain.forEach((nid, j) => {
        if (nid.startsWith("↺:")) {
          out.push(`${cont}↺ (loops to ${label(nid.slice(2))})`);
          return;
        }
        const conn = j === 0 ? (last ? "└─ " : "├─ ") : "▼  ";
        out.push(line(nid, j === 0 ? prefix : cont, conn));
        const grandKids = rel.get(nid)?.children ?? [];
        if (grandKids.length) renderKids(grandKids, cont);
      });
    });
  }

  // Top-level chain, rendered vertically with ▼ separators.
  const top = chainOf(startId);
  top.forEach((id, i) => {
    if (id.startsWith("↺:")) {
      out.push(`↺ (loops to ${label(id.slice(2))})`);
      return;
    }
    out.push(line(id, "", ""));
    const hasNext = i < top.length - 1;
    const kids = rel.get(id)?.children ?? [];
    if (kids.length) renderKids(kids, hasNext ? "│  " : "   ");
    if (hasNext) out.push("▼");
  });

  return out.join("\n");
}

// ---- Mermaid flowchart (rich render) ---------------------------------------

function mmId(raw: string): string {
  // mermaid node ids must be identifier-safe
  return "n_" + raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

function mmLabel(s: string): string {
  return s.replace(/"/g, "'").slice(0, 40);
}

// Shape category a node type maps to. Keep in sync with mmShape/GLYPH.
type ShapeCat = "start" | "end" | "agent" | "branch" | "step";
function shapeCat(type: string | undefined): ShapeCat {
  switch (type) {
    case "start":
      return "start";
    case "end":
      return "end";
    case "ifElse":
    case "switch":
      return "branch";
    case "aiAgentJob":
      return "agent";
    default:
      return "step";
  }
}

function mmShape(type: string | undefined, id: string, label: string): string {
  const l = `"${mmLabel(label)}"`;
  switch (shapeCat(type)) {
    case "start":
      return `${id}((${l}))`;
    case "end":
      return `${id}([${l}])`;
    case "branch":
      return `${id}{${l}}`;
    case "agent":
      return `${id}[[${l}]]`;
    default:
      return `${id}[${l}]`;
  }
}

// A shape/edge key for exactly the elements present in THIS chart. `kind`
// drives the drawn SVG in the HTML legend; `shape`/`meaning` are the text form
// used in the returned `legend` rows and for terminal/inline display.
export type LegendKind =
  | "start"
  | "agent"
  | "branch"
  | "step"
  | "end"
  | "seq"
  | "contains";
export interface LegendRow {
  kind: LegendKind;
  shape: string;
  meaning: string;
}

const SHAPE_MEANING: Record<ShapeCat, { shape: string; meaning: string }> = {
  start: { shape: "Circle", meaning: "Start" },
  agent: { shape: "Double-outlined box", meaning: "AI Agent" },
  branch: { shape: "Diamond", meaning: "Branch (If/Else, Switch)" },
  step: {
    shape: "Rectangle",
    meaning: "Action step (Say, Code, xApp, tool, …)",
  },
  end: { shape: "Rounded box", meaning: "End" },
};
// Stable display order.
const SHAPE_ORDER: ShapeCat[] = ["start", "agent", "branch", "step", "end"];

// Short label placed INSIDE each legend shape (the shape itself is the key, the
// word is its meaning — no shape *names* like "Diamond"). Kept terse so the
// in-diagram legend stays a small strip.
const LEGEND_SHORT: Record<ShapeCat, string> = {
  start: "Start",
  agent: "AI Agent",
  branch: "Branch",
  step: "Step",
  end: "End",
};

// A representative node type per category, so mmShape draws the right shape for
// a legend key (reverse of shapeCat).
function catToType(c: ShapeCat): string {
  switch (c) {
    case "start":
      return "start";
    case "end":
      return "end";
    case "branch":
      return "ifElse";
    case "agent":
      return "aiAgentJob";
    default:
      return "say";
  }
}

// Build a minimal in-diagram legend: one real shape per category present, laid
// out as a compact left→right strip in a quiet, transparent subgraph. The
// meaning is the shape's own label — the reader sees, e.g., a diamond that says
// "Branch", never the word "Diamond". Empty if the chart has no nodes.
function mermaidLegend(chart: Chart): string[] {
  const cats = SHAPE_ORDER.filter((c) =>
    (chart.nodes ?? []).some((n) => shapeCat(n.type) === c),
  );
  if (!cats.length) return [];

  const lines = ['  subgraph legend ["Legend"]', "    direction LR"];
  for (const c of cats) {
    lines.push("    " + mmShape(catToType(c), `lg_${c}`, LEGEND_SHORT[c]));
  }
  // Invisible links keep the keys in one tidy row without drawing arrows.
  if (cats.length > 1) {
    lines.push("    " + cats.map((c) => `lg_${c}`).join(" ~~~ "));
  }
  lines.push("  end");
  // Quiet styling so the legend reads as a caption, not a second diagram.
  lines.push(
    "  style legend fill:transparent,stroke:#cbd5e1,stroke-width:1px,color:#64748b;",
  );
  return lines;
}

export function chartLegend(chart: Chart): LegendRow[] {
  const cats = new Set<ShapeCat>();
  for (const n of chart.nodes ?? []) cats.add(shapeCat(n.type));

  const rows: LegendRow[] = SHAPE_ORDER.filter((c) => cats.has(c)).map((c) => ({
    kind: c,
    ...SHAPE_MEANING[c],
  }));

  const rels = chart.relations ?? [];
  if (rels.some((r) => nextIds(r).length))
    rows.push({
      kind: "seq",
      shape: "Solid arrow →",
      meaning: "Flow sequence (next)",
    });
  if (rels.some((r) => (r.children ?? []).length))
    rows.push({
      kind: "contains",
      shape: "Dotted arrow (contains)",
      meaning: "Nested branch / tool body",
    });
  return rows;
}

// A small inline SVG that draws each legend shape/edge, so the HTML key shows
// the actual shape rather than its name. stroke/fill use currentColor so it
// adapts to the page theme.
function legendSvg(kind: LegendKind): string {
  const S = 'stroke="currentColor" fill="none" stroke-width="1.5"';
  const arrowHead = (x: number) =>
    `<path d="M${x},13 l-6,-3.5 l0,7 z" fill="currentColor" stroke="none"/>`;
  const body = (() => {
    switch (kind) {
      case "start":
        return `<circle cx="23" cy="13" r="9" ${S}/>`;
      case "end":
        return `<rect x="7" y="4" width="32" height="18" rx="9" ${S}/>`;
      case "step":
        return `<rect x="6" y="5" width="34" height="16" ${S}/>`;
      case "agent":
        return `<rect x="6" y="5" width="34" height="16" ${S}/><line x1="10" y1="5" x2="10" y2="21" ${S}/><line x1="36" y1="5" x2="36" y2="21" ${S}/>`;
      case "branch":
        return `<polygon points="23,3 41,13 23,23 5,13" ${S}/>`;
      case "seq":
        return `<line x1="4" y1="13" x2="34" y2="13" ${S}/>${arrowHead(40)}`;
      case "contains":
        return `<line x1="4" y1="13" x2="34" y2="13" ${S} stroke-dasharray="3 3"/>${arrowHead(40)}`;
    }
  })();
  return `<svg class="lg-svg" viewBox="0 0 46 26" width="46" height="26" aria-hidden="true">${body}</svg>`;
}

export function chartToMermaid(
  chart: Chart,
  focus?: string | string[],
  opts: { legend?: boolean } = {},
): string {
  const { byId, rel, startId } = index(chart);
  const lines: string[] = ["flowchart TD"];

  // Declare and wire nodes in traversal order (children before the `next`
  // continuation) so mermaid's auto-layout tends to place branches left→right
  // in chart order — e.g. Default (children[0]) leftward, End (the agent's
  // next) last. This is a layout *nudge*: dagre still optimizes crossings, so
  // exact left/right lanes are not guaranteed.
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string | undefined) => {
    if (!id || seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    order.push(id);
    const r = rel.get(id);
    for (const c of r?.children ?? []) visit(c);
    for (const n of nextIds(r)) visit(n);
  };
  visit(startId);
  for (const n of chart.nodes ?? []) visit(nodeId(n)); // any orphans

  for (const id of order) {
    lines.push(
      "  " + mmShape(byId.get(id)?.type, mmId(id), nodeLabel(byId.get(id))),
    );
  }

  // edges: children = dotted "contains" (emitted first, in chart order),
  // then next = solid continuation.
  for (const id of order) {
    const r = rel.get(id);
    for (const ch of r?.children ?? []) {
      if (byId.has(ch)) lines.push(`  ${mmId(id)} -.->|contains| ${mmId(ch)}`);
    }
    for (const nx of nextIds(r)) {
      if (byId.has(nx)) lines.push(`  ${mmId(id)} --> ${mmId(nx)}`);
    }
  }

  const focused = [...focusSet(focus)].filter((id) => byId.has(id));
  if (focused.length) {
    // Explicit dark text color so the label stays readable on the light fill
    // regardless of the client's theme (dark clients default text to light).
    lines.push(
      `  classDef focus fill:#fde68a,stroke:#d97706,stroke-width:3px,color:#111827;`,
    );
    lines.push(`  class ${focused.map(mmId).join(",")} focus;`);
  }

  if (opts.legend) lines.push(...mermaidLegend(chart));

  return lines.join("\n");
}

// ---- Standalone rich HTML (open in a browser) ------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build a self-contained HTML page rendering the flow as a mermaid graph, with
 * the ASCII tree as an offline fallback. Deterministic: same chart in, same
 * page out. Intended to be written to a tmp file and opened in a browser —
 * for clients (terminal, IDE panels) that can't render mermaid inline.
 *
 * Pass `mermaidJs` (the mermaid UMD source) to inline the renderer so the
 * page works fully offline. Without it, the page loads mermaid from a CDN and
 * shows the ASCII fallback when offline.
 */
export function chartToHtml(
  chart: Chart,
  opts: {
    title?: string;
    focusId?: string | string[];
    mermaidJs?: string;
  } = {},
): string {
  const title = opts.title ?? "Cognigy Flow";
  const mermaid = chartToMermaid(chart, opts.focusId);
  const ascii = chartToAscii(chart, opts.focusId);
  const legend = chartLegend(chart)
    .map(
      (r) =>
        `<div class="lg-row">${legendSvg(r.kind)}<span class="lg-mean">${esc(r.meaning)}</span></div>`,
    )
    .join("");

  // When the mermaid UMD source is supplied, inline it so the page renders
  // fully offline (no CDN). Otherwise fall back to a CDN import. The
  // `</script` guard prevents the inlined source from closing the tag early.
  const loader = opts.mermaidJs
    ? `<script>${opts.mermaidJs.replace(/<\/script/gi, "<\\/script")}</script>
<script>
  try {
    mermaid.initialize({ startOnLoad: false, theme: "neutral" });
    mermaid.run();
  } catch (e) {
    document.querySelector(".diagram").innerHTML =
      '<p class="err">Mermaid failed to render. See the ASCII tree below.</p>';
  }
</script>`
    : `<script type="module">
  try {
    const { default: mermaid } = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    mermaid.initialize({ startOnLoad: true, theme: "neutral" });
  } catch (e) {
    document.querySelector(".diagram").innerHTML =
      '<p class="err">Mermaid could not load (offline?). See the ASCII tree below.</p>';
  }
</script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root {
    --bg:#f5f6f8; --surface:#fff; --ink:#1a1f2b; --muted:#5b6472;
    --line:#e3e6ec; --accent:#4f46e5; --diagram:#fbfcfd;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1319; --surface:#171c24; --ink:#e6e9ef; --muted:#9aa4b2;
            --line:#262c37; --accent:#818cf8; --diagram:#f7f8fa; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif; line-height:1.5; }
  .wrap { max-width:1100px; margin:0 auto; padding:32px 24px 64px; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:-0.01em; }
  .sub { color:var(--muted); font-size:13px; margin:0 0 24px; }
  .card { background:var(--surface); border:1px solid var(--line);
    border-radius:12px; overflow:hidden; }
  .diagram { background:var(--diagram); padding:24px; overflow:auto; }
  .diagram .mermaid { display:flex; justify-content:center; min-width:max-content; }
  details { margin-top:20px; }
  summary { cursor:pointer; color:var(--muted); font-size:13px; padding:6px 0; }
  pre.ascii { background:var(--surface); border:1px solid var(--line);
    border-radius:12px; padding:20px; overflow-x:auto;
    font-family:ui-monospace,Menlo,Consolas,monospace; font-size:13px; line-height:1.5; }
  .err { color:var(--muted); font-size:13px; padding:16px 0; }
  .legend { margin-top:20px; background:var(--surface); border:1px solid var(--line);
    border-radius:12px; padding:16px 18px; }
  .legend h2 { font-size:12px; text-transform:uppercase; letter-spacing:0.06em;
    color:var(--muted); margin:0 0 12px; font-weight:600; }
  .lg-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:8px 20px; }
  .lg-row { display:flex; gap:12px; font-size:13px; align-items:center; }
  .lg-svg { color:var(--ink); flex:0 0 auto; }
  .lg-mean { color:var(--muted); }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(title)}</h1>
  <p class="sub">Deterministic render of the flow chart · generated by the Cognigy plugin</p>
  <div class="card">
    <div class="diagram"><pre class="mermaid">${esc(mermaid)}</pre></div>
  </div>
  <div class="legend">
    <h2>Legend — shapes in this flow</h2>
    <div class="lg-grid">${legend}</div>
  </div>
  <details open>
    <summary>ASCII tree (text view)</summary>
    <pre class="ascii">${esc(ascii)}</pre>
  </details>
</div>
${loader}
</body>
</html>
`;
}
