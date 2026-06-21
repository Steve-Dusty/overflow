/**
 * ArmorIQPage — in-app ArmorIQ governance dashboard.
 *
 * Renders REAL analytics captured from the last `npm run fleet` run
 * (public/demo_data/armoriq_analytics.json): every ArmorIQ surface we exercise
 * — Agents, Intent Intelligence, Plan Assurance, Policies, and the AI Graph
 * (delegation edges) — as stat cards, an interactive 3D knowledge graph, and
 * per-agent / per-delegation / per-tool tables.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import { ShieldCheck, Network, GitBranch, FileCheck2, Boxes, Activity, RefreshCw } from "lucide-react";
import Card, { StatCard } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import { colors, fonts, spacing, typeScale, radius } from "../theme";

interface AgentRow {
  id: string; role: string; goal: string; tokenId: string | null; planHash: string | null;
  verified: boolean; steps: number; allowed: number; blocked: number; held: number;
  tools: string[]; isCoordinator: boolean;
}
interface Delegation { from: string; to: string; trustId: string | null; subtreePath: string }
interface Analytics {
  generatedAt: string; mode: string; live: boolean;
  summary: { agents: number; intents: number; planAssuranceVerified: number; policyDecisions: number; allow: number; block: number; hold: number; delegationEdges: number; toolsGoverned: number };
  agents: AgentRow[]; delegations: Delegation[]; tools: { name: string; count: number }[];
}

const NODE_COLORS: Record<string, string> = {
  org: "#00E89D", coordinator: "#00C9DB", agent: "#7B6FFF", tool: "#FF9E00",
};

export default function ArmorIQPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ name: string; type: string; agent?: AgentRow } | null>(null);
  const graphBox = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 720, h: 460 });

  useEffect(() => {
    fetch("/demo_data/armoriq_analytics.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then(setData)
      .catch(() => setErr("No analytics yet — run `npm run fleet` to populate the dashboard."));
  }, []);

  useEffect(() => {
    const el = graphBox.current;
    if (!el) return;
    const measure = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const graph = useMemo(() => buildGraph(data), [data]);

  if (err) return <Centered>{err}</Centered>;
  if (!data) return <Centered>Loading ArmorIQ analytics…</Centered>;

  const s = data.summary;
  const when = new Date(data.generatedAt).toLocaleString();

  return (
    <div style={{ padding: spacing.xl, maxWidth: 1320, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg, flexWrap: "wrap", gap: spacing.md }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
          <ShieldCheck size={22} color={colors.accent} strokeWidth={2} />
          <div>
            <div style={{ ...typeScale.h2, color: colors.textPrimary }}>ArmorIQ Governance</div>
            <div style={{ ...typeScale.caption, color: colors.textDim }}>
              runtime intent verification for the Overflow agent fleet
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
          <Badge variant={data.live ? "success" : "warning"} dot>{data.live ? "LIVE" : "shadow"}</Badge>
          <Badge variant="info">{data.mode}</Badge>
          <span style={{ ...typeScale.caption, color: colors.textDim, fontFamily: fonts.mono, display: "flex", alignItems: "center", gap: 5 }}>
            <RefreshCw size={11} /> {when}
          </span>
        </div>
      </div>

      {/* Stat cards — every surface */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: spacing.md, marginBottom: spacing.lg }}>
        <StatCard label="Agents" value={s.agents} subValue="registered & active" color={NODE_COLORS.coordinator} />
        <StatCard label="Intent Intelligence" value={s.intents} subValue="plans captured & signed" color={colors.textPrimary} />
        <StatCard label="Plan Assurance" value={`${s.planAssuranceVerified}/${s.agents}`} subValue="tokens verified" color={colors.accent} />
        <StatCard label="Policy Decisions" value={s.policyDecisions} subValue={`${s.allow} allow · ${s.block} block · ${s.hold} hold`} color={s.block ? colors.error : colors.accent} />
        <StatCard label="AI Graph" value={s.delegationEdges} subValue="delegation edges" color={NODE_COLORS.agent} />
        <StatCard label="Tools Governed" value={s.toolsGoverned} subValue="via ArmorIQ" color={NODE_COLORS.tool} />
      </div>

      {/* Knowledge graph + selection detail */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.2fr) minmax(240px, 1fr)", gap: spacing.md, marginBottom: spacing.lg }}>
        <Card padding={0} style={{ overflow: "hidden" }}>
          <SectionHeader icon={<Network size={13} />} title="KNOWLEDGE GRAPH" right={`${graph.nodes.length} nodes · ${graph.links.length} edges`} />
          <div ref={graphBox} style={{ height: 460, position: "relative" }}>
            <ForceGraph3D
              graphData={graph}
              width={dims.w}
              height={dims.h}
              backgroundColor={colors.bgDeep}
              nodeColor={(n: object) => (n as GNode).color}
              nodeLabel={(n: object) => `${(n as GNode).name} · ${(n as GNode).type}`}
              nodeVal={(n: object) => (n as GNode).val}
              nodeOpacity={0.95}
              linkColor={(l: object) => (l as GLink).color}
              linkWidth={(l: object) => ((l as GLink).delegation ? 1.6 : 0.4)}
              linkDirectionalParticles={(l: object) => ((l as GLink).delegation ? 4 : 0)}
              linkDirectionalParticleWidth={2.2}
              linkDirectionalParticleColor={() => NODE_COLORS.agent}
              enableNodeDrag={false}
              onNodeClick={(n: object) => {
                const node = n as GNode;
                setSelected({ name: node.name, type: node.type, agent: node.agent });
              }}
            />
            <div style={{ position: "absolute", bottom: 8, left: 10, display: "flex", gap: 12 }}>
              {Object.entries(NODE_COLORS).map(([k, col]) => (
                <span key={k} style={{ display: "flex", alignItems: "center", gap: 4, ...typeScale.caption, color: colors.textDim, fontFamily: fonts.mono }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: col }} /> {k}
                </span>
              ))}
            </div>
          </div>
        </Card>

        {/* Detail / legend panel */}
        <Card>
          <SectionHeader icon={<Activity size={13} />} title="INSPECTOR" />
          {selected ? (
            <div style={{ marginTop: spacing.sm }}>
              <div style={{ ...typeScale.h3, color: colors.textPrimary, marginBottom: 4 }}>{selected.name}</div>
              <Badge variant="accent">{selected.type}</Badge>
              {selected.agent && (
                <div style={{ marginTop: spacing.md, display: "flex", flexDirection: "column", gap: 8 }}>
                  <KV k="goal" v={selected.agent.goal} />
                  <KV k="intent token" v={selected.agent.tokenId ? selected.agent.tokenId.slice(0, 18) + "…" : "—"} mono />
                  <KV k="plan hash" v={selected.agent.planHash ? selected.agent.planHash.slice(0, 18) + "…" : "—"} mono />
                  <KV k="plan assurance" v={selected.agent.verified ? "verified ✓" : "unverified"} color={selected.agent.verified ? colors.accent : colors.warning} />
                  <KV k="steps enforced" v={`${selected.agent.allowed} allow · ${selected.agent.blocked} block`} />
                  <KV k="tools" v={selected.agent.tools.join(", ")} />
                </div>
              )}
            </div>
          ) : (
            <div style={{ ...typeScale.caption, color: colors.textDim, marginTop: spacing.sm, lineHeight: 1.6 }}>
              Click any node in the graph to inspect it. The coordinator delegates signed, scope-bounded authority to each worker agent (purple edges); workers execute governed tools (orange).
            </div>
          )}
        </Card>
      </div>

      {/* Tables */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: spacing.md }}>
        {/* Agents */}
        <Card padding={0}>
          <SectionHeader icon={<ShieldCheck size={13} />} title="AGENTS" right={`${data.agents.length}`} />
          <div style={{ padding: spacing.md }}>
            {data.agents.map((a) => (
              <div key={a.id} style={rowStyle}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: a.isCoordinator ? NODE_COLORS.coordinator : NODE_COLORS.agent, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...typeScale.body, color: colors.textPrimary, fontFamily: fonts.mono, fontSize: 12 }}>{a.id}</div>
                  <div style={{ ...typeScale.caption, color: colors.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.goal}</div>
                </div>
                <Badge variant={a.verified ? "success" : "warning"}>{a.verified ? "signed" : "unsigned"}</Badge>
                <span style={{ ...typeScale.caption, color: colors.textSecondary, fontFamily: fonts.mono, width: 64, textAlign: "right" }}>{a.steps} steps</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Delegations + Tools */}
        <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
          <Card padding={0}>
            <SectionHeader icon={<GitBranch size={13} />} title="DELEGATIONS (AI GRAPH)" right={`${data.delegations.length}`} />
            <div style={{ padding: spacing.md }}>
              {data.delegations.map((d, i) => (
                <div key={i} style={rowStyle}>
                  <span style={{ ...typeScale.caption, color: colors.textSecondary, fontFamily: fonts.mono, fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.from.replace("overflow-", "")} <span style={{ color: NODE_COLORS.agent }}>→</span> {d.to.replace("overflow-", "")}
                  </span>
                  <span style={{ ...typeScale.caption, color: colors.textDim, fontFamily: fonts.mono }}>trust:{(d.trustId ?? "").slice(0, 8)}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card padding={0}>
            <SectionHeader icon={<Boxes size={13} />} title="GOVERNED TOOLS" right={`${data.tools.length}`} />
            <div style={{ padding: spacing.md, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {data.tools.map((t) => (
                <span key={t.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: radius.sm, background: "rgba(255,158,0,0.06)", border: "1px solid rgba(255,158,0,0.16)", ...typeScale.caption, color: colors.textSecondary, fontFamily: fonts.mono }}>
                  {t.name} <span style={{ color: NODE_COLORS.tool }}>×{t.count}</span>
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div style={{ ...typeScale.caption, color: colors.textDim, marginTop: spacing.lg, display: "flex", alignItems: "center", gap: 6 }}>
        <FileCheck2 size={12} /> Real data from <code style={{ fontFamily: fonts.mono, color: colors.textSecondary }}>npm run fleet</code> — re-run to refresh. Every number maps to a signed ArmorIQ intent token.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

interface GNode { id: string; name: string; type: string; color: string; val: number; agent?: AgentRow }
interface GLink { source: string; target: string; color: string; delegation?: boolean }

function buildGraph(data: Analytics | null): { nodes: GNode[]; links: GLink[] } {
  if (!data) return { nodes: [], links: [] };
  const nodes: GNode[] = [{ id: "__org", name: "Overflow", type: "org", color: NODE_COLORS.org, val: 16 }];
  const links: GLink[] = [];
  const toolSeen = new Set<string>();

  for (const a of data.agents) {
    nodes.push({
      id: a.id, name: a.role, agent: a,
      type: a.isCoordinator ? "coordinator" : "agent",
      color: a.isCoordinator ? NODE_COLORS.coordinator : NODE_COLORS.agent,
      val: a.isCoordinator ? 11 : 7,
    });
    if (a.isCoordinator) links.push({ source: "__org", target: a.id, color: "rgba(0,232,157,0.35)" });
    for (const t of a.tools) {
      const tid = "tool:" + t;
      if (!toolSeen.has(tid)) { toolSeen.add(tid); nodes.push({ id: tid, name: t, type: "tool", color: NODE_COLORS.tool, val: 3 }); }
      links.push({ source: a.id, target: tid, color: "rgba(255,158,0,0.16)" });
    }
  }
  for (const d of data.delegations) {
    links.push({ source: d.from, target: d.to, color: "rgba(123,111,255,0.7)", delegation: true });
  }
  return { nodes, links };
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
  borderBottom: `1px solid ${colors.border}`,
};

function SectionHeader({ icon, title, right }: { icon: React.ReactNode; title: string; right?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, color: colors.textDim }}>
        {icon}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", fontFamily: fonts.mono, color: colors.textDim }}>{title}</span>
      </div>
      {right && <span style={{ ...typeScale.caption, color: colors.textDim, fontFamily: fonts.mono }}>{right}</span>}
    </div>
  );
}

function KV({ k, v, mono, color }: { k: string; v: string; mono?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ ...typeScale.caption, color: colors.textDim }}>{k}</span>
      <span style={{ ...typeScale.caption, color: color ?? colors.textSecondary, fontFamily: mono ? fonts.mono : fonts.sans, textAlign: "right", maxWidth: "62%", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: spacing.xl, textAlign: "center", color: colors.textDim, fontFamily: fonts.mono, fontSize: 13 }}>
      {children}
    </div>
  );
}
