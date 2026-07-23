/**
 * Deterministic flow-chart serializers.
 *
 * Input: the object returned by `GET /new/v2.0/flows/{flowId}/chart`
 *   { nodes: [{ _id|id, type, label?, preview? }],
 *     relations: [{ node, next?: string[], children?: string[] }] }
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
  preview?: string | { text?: string };
}

export interface ChartRelation {
  node: string;
  next?: string[];
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

function nodeLabel(n: ChartNode | undefined): string {
  if (!n) return "(unknown)";
  if (typeof n.label === "string" && n.label.trim()) return n.label.trim();
  const p = n.preview;
  const prev = typeof p === "string" ? p : p?.text;
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
      for (const x of r.next ?? []) pointed.add(x);
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

/**
 * Walk the `next` chain vertically; nest `children` with tree branches.
 * `focusId` (optional) marks a node with «» for partial-render highlight.
 */
export function chartToAscii(chart: Chart, focusId?: string): string {
  const { byId, rel, startId } = index(chart);
  if (!startId) return "(empty flow)";

  const out: string[] = [];
  const seen = new Set<string>();

  const label = (id: string) => nodeLabel(byId.get(id));
  const line = (id: string, prefix: string, conn: string) =>
    `${prefix}${conn}${glyph(byId.get(id)?.type)} ${label(id)}` +
    (id === focusId ? "  «here»" : "");

  // Follow the `next` chain from a node, guarding loops.
  function chainOf(startId: string): string[] {
    const ids: string[] = [];
    let cur: string | undefined = startId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      ids.push(cur);
      cur = rel.get(cur)?.next?.[0];
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

function mmShape(type: string | undefined, id: string, label: string): string {
  const l = `"${mmLabel(label)}"`;
  switch (type) {
    case "start":
      return `${id}((${l}))`;
    case "end":
      return `${id}([${l}])`;
    case "ifElse":
    case "switch":
      return `${id}{${l}}`;
    case "aiAgentJob":
      return `${id}[[${l}]]`;
    default:
      return `${id}[${l}]`;
  }
}

export function chartToMermaid(chart: Chart, focusId?: string): string {
  const { byId, startId } = index(chart);
  const lines: string[] = ["flowchart TD"];

  // node declarations
  for (const n of chart.nodes ?? []) {
    const id = nodeId(n);
    lines.push("  " + mmShape(n.type, mmId(id), nodeLabel(n)));
  }

  // edges: next = solid, children = dotted "contains"
  for (const r of chart.relations ?? []) {
    for (const nx of r.next ?? []) {
      if (byId.has(nx)) lines.push(`  ${mmId(r.node)} --> ${mmId(nx)}`);
    }
    for (const ch of r.children ?? []) {
      if (byId.has(ch))
        lines.push(`  ${mmId(r.node)} -.->|contains| ${mmId(ch)}`);
    }
  }

  if (focusId && byId.has(focusId)) {
    lines.push(
      `  classDef focus fill:#fde68a,stroke:#d97706,stroke-width:2px;`,
    );
    lines.push(`  class ${mmId(focusId)} focus;`);
  }

  // silence unused-in-some-paths
  void startId;
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
 * Mermaid loads from a CDN (a local file in a browser has no CSP restriction);
 * if offline, the page shows the ASCII fallback instead.
 */
export function chartToHtml(
  chart: Chart,
  opts: { title?: string; focusId?: string } = {},
): string {
  const title = opts.title ?? "Cognigy Flow";
  const mermaid = chartToMermaid(chart, opts.focusId);
  const ascii = chartToAscii(chart, opts.focusId);

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
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(title)}</h1>
  <p class="sub">Deterministic render of the flow chart · generated by the Cognigy plugin</p>
  <div class="card">
    <div class="diagram"><pre class="mermaid">${esc(mermaid)}</pre></div>
  </div>
  <details open>
    <summary>ASCII tree (offline fallback)</summary>
    <pre class="ascii">${esc(ascii)}</pre>
  </details>
</div>
<script type="module">
  try {
    const { default: mermaid } = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
    mermaid.initialize({ startOnLoad: true, theme: "neutral" });
  } catch (e) {
    document.querySelector(".diagram").innerHTML =
      '<p class="err">Mermaid could not load (offline?). See the ASCII tree below.</p>';
  }
</script>
</body>
</html>
`;
}
