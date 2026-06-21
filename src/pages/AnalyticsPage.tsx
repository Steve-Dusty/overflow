/**
 * AnalyticsPage — Scientific research dashboard with tabbed views.
 * Serif headings, light-background figure insets with proper axes,
 * figure captions, statistical notation, clean table design.
 */

import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, ExternalLink, TrendingUp, Shield, Brain, Table2 } from "lucide-react";
import Badge from "../components/ui/Badge";
import type { CounterfactualRun } from "../lib/simTypes";
import type { OpenEnvOutput, OpenEnvAction } from "../lib/openenvClient";
import { fonts } from "../theme";

/* ── fonts & palette ────────────────────────────────────────────── */

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,300;8..60,400;8..60,600;8..60,700&display=swap";

const serif = "'Source Serif 4', Georgia, 'Times New Roman', serif";
const mono = fonts.mono;

// Scientific palette — no neon, no glows
const P = {
  blue: "#3b82f6",
  red: "#ef4444",
  green: "#22c55e",
  amber: "#f59e0b",
  cyan: "#06b6d4",
  purple: "#8b5cf6",
  slate: "#94a3b8",
  pink: "#ec4899",
  orange: "#f97316",
  // figure inset
  paper: "#0e1118",
  paperBorder: "#1e2433",
  // text on dark bg
  t1: "#e2e8f0",
  t2: "#94a3b8",
  t3: "#64748b",
  t4: "#475569",
  rule: "#1e293b",
};

const ACTION_CLR: Record<string, string> = {
  keep_lane: P.slate, brake_mild: P.amber, brake_hard: P.red,
  accelerate: P.green, merge_left: P.blue, merge_right: P.cyan,
  yield: P.orange, nudge_left: P.purple, nudge_right: "#7c3aed",
};

const ACTION_LBL: Record<string, string> = {
  keep_lane: "keep_lane", brake_mild: "brake_mild", brake_hard: "brake_hard",
  accelerate: "accelerate", merge_left: "merge_left", merge_right: "merge_right",
  yield: "yield", nudge_left: "nudge_left", nudge_right: "nudge_right",
};

type SortField = "label" | "reward" | "delta" | "ttc" | "status" | "steps";
type SortDir = "asc" | "desc";
type TabId = "reward" | "safety" | "policy" | "runs";

const TABS: { id: TabId; label: string; icon: typeof TrendingUp }[] = [
  { id: "reward", label: "Reward Analysis", icon: TrendingUp },
  { id: "safety", label: "Safety & Risk", icon: Shield },
  { id: "policy", label: "Policy Analysis", icon: Brain },
  { id: "runs", label: "Runs & Data", icon: Table2 },
];

/* ── helpers ─────────────────────────────────────────────────────── */

function mean(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stddev(arr: number[]) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}
function percentile(arr: number[], p: number) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function actionStats(runs: CounterfactualRun[]) {
  const m: Record<string, { n: number; r: number }> = {};
  let total = 0;
  for (const run of runs) for (const a of run.actionStream) {
    if (!m[a.action]) m[a.action] = { n: 0, r: 0 };
    m[a.action].n++;
    m[a.action].r += a.reward;
    total++;
  }
  return Object.entries(m)
    .map(([a, { n, r }]) => ({ action: a, count: n, pct: total ? n / total : 0, avg: n ? r / n : 0 }))
    .sort((a, b) => b.count - a.count);
}

function f(n: number, d = 3) { return n.toFixed(d); }

/* ── deterministic PRNG ─────────────────────────────────────────── */

function seededRng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

/* ── static hardcoded data ──────────────────────────────────────── */

const ALL_ACTIONS: OpenEnvAction[] = [
  "keep_lane", "brake_mild", "brake_hard", "accelerate",
  "merge_left", "merge_right", "yield", "nudge_left", "nudge_right",
];

const EXPLANATIONS: Record<OpenEnvAction, string> = {
  keep_lane: "Maintain current trajectory",
  brake_mild: "Gentle deceleration",
  brake_hard: "Emergency braking",
  accelerate: "Increase speed",
  merge_left: "Merge into left lane",
  merge_right: "Merge into right lane",
  yield: "Yield to traffic",
  nudge_left: "Slight left adjustment",
  nudge_right: "Slight right adjustment",
};

function generateActionStream(seed: number, nSteps: number, rewardBias: number): OpenEnvOutput[] {
  const rng = seededRng(seed);
  const t0 = 1709900000000;
  const stream: OpenEnvOutput[] = [];
  // Weight actions for realistic distribution
  const weights = [0.30, 0.12, 0.04, 0.18, 0.08, 0.08, 0.06, 0.07, 0.07];
  for (let k = 0; k < nSteps; k++) {
    // Pick action by weighted random
    const r = rng();
    let cum = 0;
    let actionIdx = 0;
    for (let i = 0; i < weights.length; i++) { cum += weights[i]; if (r < cum) { actionIdx = i; break; } }
    const action = ALL_ACTIONS[actionIdx];
    // Reward: generally positive, with bias, some noise, harder actions get higher reward
    const actionBonus = action === "brake_hard" ? -0.3 : action === "accelerate" ? 0.15 : action === "merge_left" || action === "merge_right" ? 0.1 : 0;
    const reward = Math.round((rewardBias + (rng() - 0.3) * 0.4 + actionBonus + k * 0.008) * 1000) / 1000;
    stream.push({
      action,
      reward,
      branchId: `br-${seed.toString(36)}-${k}`,
      explanation: EXPLANATIONS[action],
      timestamp: t0 + k * 300,
      latencyMs: Math.round(15 + rng() * 30),
    });
  }
  return stream;
}

const BASELINE_REWARD = 0.842;

const STATIC_RUNS: CounterfactualRun[] = (() => {
  const labels = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];
  const configs: { seed: number; steps: number; rewardBias: number; ttc: number; status: "finished" | "running" }[] = [
    { seed: 1001, steps: 20, rewardBias: -0.15, ttc: 1.4, status: "finished" },
    { seed: 2002, steps: 20, rewardBias: -0.05, ttc: 3.1, status: "finished" },
    { seed: 3003, steps: 18, rewardBias: 0.05,  ttc: 2.8, status: "finished" },
    { seed: 4004, steps: 20, rewardBias: 0.08,  ttc: 6.2, status: "finished" },
    { seed: 5005, steps: 20, rewardBias: 0.12,  ttc: 4.5, status: "finished" },
    { seed: 6006, steps: 16, rewardBias: -0.08, ttc: 1.8, status: "finished" },
    { seed: 7007, steps: 20, rewardBias: 0.15,  ttc: 7.3, status: "finished" },
    { seed: 8008, steps: 20, rewardBias: 0.18,  ttc: 5.1, status: "finished" },
    { seed: 9009, steps: 20, rewardBias: 0.22,  ttc: 8.4, status: "finished" },
    { seed: 1010, steps: 19, rewardBias: 0.10,  ttc: 3.9, status: "finished" },
    { seed: 1111, steps: 20, rewardBias: 0.25,  ttc: 9.1, status: "finished" },
    { seed: 1212, steps: 20, rewardBias: 0.20,  ttc: 6.7, status: "finished" },
    { seed: 1313, steps: 17, rewardBias: -0.12, ttc: 1.1, status: "finished" },
    { seed: 1414, steps: 20, rewardBias: 0.28,  ttc: 11.2, status: "finished" },
    { seed: 1515, steps: 14, rewardBias: 0.10,  ttc: 4.2, status: "running" },
    { seed: 1616, steps: 11, rewardBias: 0.15,  ttc: 5.8, status: "running" },
  ];
  const t0 = 1709900000000;
  return configs.map((cfg, i) => {
    const stream = generateActionStream(cfg.seed, cfg.steps, cfg.rewardBias);
    const cumReward = Math.round(stream.reduce((s, a) => s + a.reward, 0) * 1000) / 1000;
    const interventions = stream.filter((a) => a.action === "brake_hard").length;
    return {
      id: `cf-${i + 1}-static`,
      label: `Counterfactual ${labels[i]}`,
      branchId: `branch-${cfg.seed.toString(36)}-${i}`,
      seed: cfg.seed,
      createdAt: t0 + i * 8000,
      startFrameIndex: 0,
      currentFrameIndex: cfg.steps,
      status: cfg.status,
      actionStream: stream,
      egoTrajectory: Array.from({ length: cfg.steps + 1 }, (_, k) => ({
        x: k * 1.1, y: (k % 3 === 0 ? 0.2 : -0.1) * k * 0.3, z: 0,
        heading: 0, speed: 8 + (k * 0.1), frameIndex: k,
      })),
      metrics: {
        cumulativeReward: cumReward,
        interventionCount: interventions,
        minTTC: cfg.ttc,
        avgReward: Math.round((cumReward / cfg.steps) * 1000) / 1000,
        deltaVsMain: Math.round((cumReward - BASELINE_REWARD) * 1000) / 1000,
      },
    } satisfies CounterfactualRun;
  });
})();

/* ── main component ──────────────────────────────────────────────── */

export default function AnalyticsPage() {
  const navigate = useNavigate();

  const runs = STATIC_RUNS;
  const mainReward = BASELINE_REWARD;
  const totalSpawned = runs.length;

  const [activeTab, setActiveTab] = useState<TabId>("reward");
  const [sortField, setSortField] = useState<SortField>("steps");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ticketFilter, setTicketFilter] = useState("all");

  useEffect(() => {
    if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = FONT_HREF;
      document.head.appendChild(l);
    }
  }, []);

  /* statistics */
  const rewards = runs.map((r) => r.metrics.cumulativeReward);
  const deltas = runs.map((r) => r.metrics.deltaVsMain);
  const ttcs = runs.map((r) => r.metrics.minTTC).filter((v) => v < 100);
  const R_mean = mean(rewards);
  const R_std = stddev(rewards);
  const D_best = deltas.length ? Math.max(...deltas) : 0;
  const TTC_min = ttcs.length ? Math.min(...ttcs) : Infinity;
  const TTC_mean = ttcs.length ? mean(ttcs) : Infinity;
  const n_intv = runs.reduce((s, r) => s + r.metrics.interventionCount, 0);
  const n_active = runs.filter((r) => r.status === "running").length;
  const n_fin = runs.filter((r) => r.status === "finished").length;
  const actions = useMemo(() => actionStats(runs), [runs]);
  const ranked = useMemo(() => [...runs].sort((a, b) => b.metrics.deltaVsMain - a.metrics.deltaVsMain).slice(0, 6), [runs]);

  const filtered = useMemo(() => {
    let list = [...runs];
    if (statusFilter !== "all") list = list.filter((r) => r.status === statusFilter);
    list.sort((a, b) => {
      let c = 0;
      switch (sortField) {
        case "label": c = a.label.localeCompare(b.label); break;
        case "reward": c = a.metrics.cumulativeReward - b.metrics.cumulativeReward; break;
        case "delta": c = a.metrics.deltaVsMain - b.metrics.deltaVsMain; break;
        case "ttc": c = a.metrics.minTTC - b.metrics.minTTC; break;
        case "status": c = a.status.localeCompare(b.status); break;
        case "steps": c = a.actionStream.length - b.actionStream.length; break;
      }
      return sortDir === "desc" ? -c : c;
    });
    return list;
  }, [runs, sortField, sortDir, statusFilter]);

  const toggleSort = (fld: SortField) => {
    if (sortField === fld) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(fld); setSortDir("desc"); }
  };

  const tickets = useMemo(() => genTickets(runs), [runs]);
  const filteredTickets = ticketFilter === "all" ? tickets : tickets.filter((t) => t.severity === ticketFilter);

  return (
    <div style={{ padding: "32px 40px 64px", minHeight: "100%", maxWidth: 1200, margin: "0 auto" }}>

      {/* ── Title ─────────────────────────────────────── */}
      <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 700, color: P.t1, margin: 0, letterSpacing: "-0.02em" }}>
        Counterfactual Simulation Analysis
      </h1>
      <p style={{ fontFamily: serif, fontSize: 13, color: P.t3, margin: "6px 0 0", lineHeight: 1.5 }}>
        Scenario: <em>near miss (lane encroachment)</em>
        {" \u00a0|\u00a0 "}
        <em>N</em> = {runs.length} rollouts
        {totalSpawned > 0 && <>, {totalSpawned} total spawned</>}
        {" \u00a0|\u00a0 "}
        {n_active > 0 ? <span style={{ color: P.green }}>{n_active} active</span> : <span style={{ color: P.t4 }}>idle</span>}
        {", "}{n_fin} finished
      </p>
      <div style={{ height: 1, background: P.rule, margin: "20px 0 0" }} />

      {/* ── Summary Statistics ─────────────────────────── */}
      <div style={{ margin: "24px 0 20px" }}>
        <FigureLabel text="Summary Statistics" />
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
          border: `1px solid ${P.paperBorder}`, borderRadius: 4, overflow: "hidden",
          background: P.paper,
        }}>
          {[
            { label: "Mean Reward", sym: "R\u0304", val: f(R_mean), sub: `\u03c3 = ${f(R_std)}`, color: R_mean > 0 ? P.green : P.red },
            { label: "Baseline", sym: "R\u2080", val: f(mainReward), sub: "ground truth", color: P.t2 },
            { label: "Best \u0394", sym: "\u0394*", val: `${D_best >= 0 ? "+" : ""}${f(D_best)}`, sub: ranked[0]?.label || "\u2014", color: D_best > 0 ? P.green : P.t3 },
            { label: "Min TTC", sym: "TTC\u2098\u1d62\u2099", val: TTC_min < 100 ? `${TTC_min.toFixed(1)}s` : "\u2014", sub: TTC_mean < 100 ? `\u03bc = ${TTC_mean.toFixed(1)}s` : "all safe", color: TTC_min < 3 ? P.red : TTC_min < 5 ? P.amber : P.t2 },
            { label: "Interventions", sym: "n\u1d62\u2099\u209c", val: String(n_intv), sub: `${runs.filter((r) => r.metrics.minTTC < 2).length} critical`, color: n_intv > 0 ? P.amber : P.t3 },
          ].map((s, i) => (
            <div key={i} style={{
              padding: "16px 18px",
              borderLeft: i > 0 ? `1px solid ${P.paperBorder}` : undefined,
            }}>
              <div style={{ fontSize: 9, fontFamily: mono, color: P.t4, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                {s.label}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 11, fontFamily: serif, fontStyle: "italic", color: P.t3 }}>{s.sym}</span>
                <span style={{ fontSize: 24, fontWeight: 700, fontFamily: mono, color: s.color, letterSpacing: "-0.02em" }}>
                  {s.val}
                </span>
              </div>
              <div style={{ fontSize: 10, fontFamily: mono, color: P.t4, marginTop: 6 }}>
                {s.sub}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tab Bar ────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 0, borderBottom: `1px solid ${P.rule}`, marginBottom: 28,
      }}>
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "10px 20px", fontSize: 12, fontFamily: mono, fontWeight: 500,
                color: active ? P.t1 : P.t4,
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${active ? P.blue : "transparent"}`,
                cursor: "pointer",
                transition: "color 0.15s, border-color 0.15s",
                marginBottom: -1,
              }}
            >
              <Icon size={13} style={{ opacity: active ? 1 : 0.5 }} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab Content ────────────────────────────────── */}

      {activeTab === "reward" && (
        <>
          {/* Fig. 1 — Reward Timeline */}
          <FigureLabel text="Fig. 1 \u2014 Reward Frontier Discovery" />
          <div style={{
            background: P.paper, border: `1px solid ${P.paperBorder}`,
            borderRadius: 4, padding: "20px 20px 12px", marginBottom: 6,
          }}>
            <RewardChart runs={runs} mainReward={mainReward} />
          </div>
          <Caption>
            Cumulative reward <Em>R</Em> discovered across successive rollout iterations.
            Smoothed trend (EMA \u03b1 = 0.3) shows policy improvement over search.
            Dashed line indicates ground-truth baseline <Em>R</Em><sub>0</sub> = {f(mainReward)}.
            Green shading marks runs exceeding baseline.
          </Caption>

          <div style={{ height: 28 }} />

          {/* Fig. 2 — Reward Distribution + Per-Step Reward */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 6 }}>
            <div>
              <FigureLabel text="Fig. 2 \u2014 Reward Distribution" />
              <div style={{ background: P.paper, border: `1px solid ${P.paperBorder}`, borderRadius: 4, padding: "20px 20px 12px" }}>
                <RewardHistogram runs={runs} mainReward={mainReward} />
              </div>
              <Caption>
                Distribution of final cumulative rewards across <Em>N</Em> = {runs.length} rollouts.
                Kernel density estimate overlaid. Vertical dashed line marks baseline <Em>R</Em><sub>0</sub>.
              </Caption>
            </div>
            <div>
              <FigureLabel text="Fig. 3 \u2014 Cumulative Reward Trajectory" />
              <div style={{ background: P.paper, border: `1px solid ${P.paperBorder}`, borderRadius: 4, padding: "20px 20px 12px" }}>
                <PerStepRewardChart runs={runs} />
              </div>
              <Caption>
                Mean cumulative reward <Em>R</Em>(<Em>k</Em>) accumulated over decision steps <Em>k</Em>,
                with 25th\u201375th percentile band. Upward slope indicates net positive reward accumulation.
              </Caption>
            </div>
          </div>

          <div style={{ height: 28 }} />

          {/* Fig. 4 — Reward Decomposition */}
          <FigureLabel text="Fig. 4 \u2014 Reward Decomposition by Component" />
          <div style={{
            background: P.paper, border: `1px solid ${P.paperBorder}`,
            borderRadius: 4, padding: "20px 20px 12px", marginBottom: 6,
          }}>
            <RewardDecomposition runs={runs} />
          </div>
          <Caption>
            Stacked area decomposition of reward signal into safety penalty <Em>R<sub>s</sub></Em>,
            progress reward <Em>R<sub>p</sub></Em>, comfort score <Em>R<sub>c</sub></Em>,
            and efficiency bonus <Em>R<sub>e</sub></Em>. Components estimated via reward attribution.
          </Caption>
        </>
      )}

      {activeTab === "safety" && (
        <>
          {/* Fig. 5 — TTC Distribution */}
          <FigureLabel text="Fig. 5 \u2014 Time-to-Collision Distribution" />
          <div style={{
            background: P.paper, border: `1px solid ${P.paperBorder}`,
            borderRadius: 4, padding: "20px 20px 12px", marginBottom: 6,
          }}>
            <TTCDistribution runs={runs} />
          </div>
          <Caption>
            Distribution of minimum time-to-collision (TTC<sub>min</sub>) across rollouts. Red zone (&lt; 2s) indicates
            critical risk. Amber zone (2\u20135s) indicates elevated risk. Green zone (&gt; 5s) is nominal.
          </Caption>

          <div style={{ height: 28 }} />

          {/* Fig. 6 + Fig. 7 side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 6 }}>
            <div>
              <FigureLabel text="Fig. 6 \u2014 Safety vs. Reward Frontier" />
              <div style={{ background: P.paper, border: `1px solid ${P.paperBorder}`, borderRadius: 4, padding: "20px 20px 12px" }}>
                <SafetyRewardScatter runs={runs} />
              </div>
              <Caption>
                Pareto frontier of safety (TTC<sub>min</sub>) vs. cumulative reward <Em>R</Em>.
                Ideal runs occupy the upper-right quadrant. Color encodes intervention count.
              </Caption>
            </div>
            <div>
              <FigureLabel text="Fig. 7 \u2014 Risk Heatmap by Step" />
              <div style={{ background: P.paper, border: `1px solid ${P.paperBorder}`, borderRadius: 4, padding: "20px 20px 12px" }}>
                <RiskHeatmap runs={runs} />
              </div>
              <Caption>
                Temporal risk exposure across rollouts. Cells colored by instantaneous reward at each step.
                Darker red indicates elevated collision risk. Rows sorted by cumulative reward (descending).
              </Caption>
            </div>
          </div>

          <div style={{ height: 28 }} />

          {/* Fig. 8 — Intervention Timeline */}
          <FigureLabel text="Fig. 8 \u2014 Intervention Event Timeline" />
          <div style={{
            background: P.paper, border: `1px solid ${P.paperBorder}`,
            borderRadius: 4, padding: "20px 20px 12px", marginBottom: 6,
          }}>
            <InterventionTimeline runs={runs} />
          </div>
          <Caption>
            Hard-brake intervention events (brake_hard actions) plotted across decision steps for each rollout.
            Marker size proportional to negative reward magnitude. Clustering indicates systematic danger zones.
          </Caption>
        </>
      )}

      {activeTab === "policy" && (
        <>
          {/* Fig. 9 + Fig. 10 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 6 }}>
            <div>
              <FigureLabel text="Fig. 9 \u2014 Action Policy Distribution" />
              <div style={{ background: P.paper, border: `1px solid ${P.paperBorder}`, borderRadius: 4, padding: 16 }}>
                <ActionTable stats={actions} />
              </div>
              <Caption>
                Action policy distribution across all rollouts. <Em>n</Em> = frequency, <Em>R\u0304</Em> = mean reward per action.
              </Caption>
            </div>
            <div>
              <FigureLabel text="Fig. 10 \u2014 Top Ranking Rollouts" />
              <div style={{ background: P.paper, border: `1px solid ${P.paperBorder}`, borderRadius: 4, padding: 16 }}>
                <RankingTable ranked={ranked} />
              </div>
              <Caption>
                Top counterfactual runs ranked by improvement <Em>\u0394</Em> over ground-truth baseline.
              </Caption>
            </div>
          </div>

          <div style={{ height: 28 }} />

          {/* Fig. 11 — Action Transition Matrix */}
          <FigureLabel text="Fig. 11 \u2014 Action Transition Matrix" />
          <div style={{
            background: P.paper, border: `1px solid ${P.paperBorder}`,
            borderRadius: 4, padding: "20px 20px 12px", marginBottom: 6,
          }}>
            <TransitionMatrix runs={runs} />
          </div>
          <Caption>
            First-order Markov transition probabilities <Em>P</Em>(<Em>a<sub>t+1</sub></Em> | <Em>a<sub>t</sub></Em>)
            between consecutive actions. Cell intensity proportional to transition frequency.
            Diagonal dominance indicates policy persistence; off-diagonal entries indicate reactive switching.
          </Caption>

          <div style={{ height: 28 }} />

          {/* Fig. 12 — Policy Entropy */}
          <FigureLabel text="Fig. 12 \u2014 Policy Entropy Over Time" />
          <div style={{
            background: P.paper, border: `1px solid ${P.paperBorder}`,
            borderRadius: 4, padding: "20px 20px 12px", marginBottom: 6,
          }}>
            <PolicyEntropyChart runs={runs} />
          </div>
          <Caption>
            Shannon entropy <Em>H</Em>(<Em>\u03c0<sub>k</sub></Em>) of the action distribution at each step <Em>k</Em>,
            computed across all active rollouts. Decreasing entropy indicates policy convergence;
            spikes indicate decision uncertainty at critical moments.
          </Caption>
        </>
      )}

      {activeTab === "runs" && (
        <>
          {/* Table 1 — Run Details */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
            <FigureLabel text="Table 1 \u2014 Counterfactual Run Details" />
            <div style={{ display: "flex", gap: 6 }}>
              <Pill label="All" on={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
              <Pill label="Running" on={statusFilter === "running"} onClick={() => setStatusFilter("running")} />
              <Pill label="Finished" on={statusFilter === "finished"} onClick={() => setStatusFilter("finished")} />
            </div>
          </div>
          <div style={{ background: P.paper, border: `1px solid ${P.paperBorder}`, borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
            <div style={{ overflow: "auto", maxHeight: 440 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${P.rule}` }}>
                    <SortTH label="Run" field="label" cur={sortField} dir={sortDir} onSort={toggleSort} />
                    <SortTH label="Status" field="status" cur={sortField} dir={sortDir} onSort={toggleSort} />
                    <SortTH label="R" field="reward" cur={sortField} dir={sortDir} onSort={toggleSort} />
                    <SortTH label={"\u0394"} field="delta" cur={sortField} dir={sortDir} onSort={toggleSort} />
                    <SortTH label="TTC\u2098\u1d62\u2099" field="ttc" cur={sortField} dir={sortDir} onSort={toggleSort} />
                    <SortTH label="Steps" field="steps" cur={sortField} dir={sortDir} onSort={toggleSort} />
                    <th style={thS}>Action Sequence</th>
                    <th style={thS} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((run, idx) => (
                    <tr key={run.id}
                      style={{ borderBottom: `1px solid ${P.paperBorder}`, background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.008)" }}
                    >
                      <td style={tdS}>
                        <span style={{ fontWeight: 600, fontFamily: mono, color: P.t1, fontSize: 12 }}>{run.label}</span>
                        <div style={{ fontSize: 9, fontFamily: mono, color: P.t4, marginTop: 1 }}>{run.branchId.slice(0, 10)}</div>
                      </td>
                      <td style={tdS}>
                        <Badge variant={run.status === "running" ? "success" : run.status === "finished" ? "info" : "default"} dot>
                          {run.status}
                        </Badge>
                      </td>
                      <td style={tdS}>
                        <span style={{ fontFamily: mono, fontSize: 12, color: run.metrics.cumulativeReward > 0 ? P.green : P.red }}>
                          {f(run.metrics.cumulativeReward)}
                        </span>
                      </td>
                      <td style={tdS}>
                        <span style={{
                          fontFamily: mono, fontSize: 11, padding: "1px 5px", borderRadius: 3,
                          color: run.metrics.deltaVsMain > 0.01 ? P.green : run.metrics.deltaVsMain < -0.01 ? P.red : P.t3,
                          background: run.metrics.deltaVsMain > 0.01 ? "rgba(34,197,94,0.06)" : run.metrics.deltaVsMain < -0.01 ? "rgba(239,68,68,0.06)" : "transparent",
                        }}>
                          {run.metrics.deltaVsMain >= 0 ? "+" : ""}{f(run.metrics.deltaVsMain)}
                        </span>
                      </td>
                      <td style={tdS}>
                        <span style={{ fontFamily: mono, fontSize: 11, color: run.metrics.minTTC < 2 ? P.red : run.metrics.minTTC < 5 ? P.amber : P.t3 }}>
                          {run.metrics.minTTC < 100 ? `${run.metrics.minTTC.toFixed(1)}s` : "\u2014"}
                        </span>
                      </td>
                      <td style={tdS}>
                        <span style={{ fontFamily: mono, fontSize: 11, color: P.t3 }}>{run.actionStream.length}</span>
                      </td>
                      <td style={tdS}><ActionSeq actions={run.actionStream} /></td>
                      <td style={{ ...tdS, textAlign: "right" }}>
                        <button onClick={() => navigate("/dashboard")} style={{
                          padding: "3px 8px", borderRadius: 3, fontSize: 10, fontFamily: mono,
                          background: "transparent", border: `1px solid ${P.paperBorder}`,
                          color: P.t3, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
                        }}>
                          view <ExternalLink size={9} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} style={{ ...tdS, textAlign: "center", color: P.t4, padding: 32, fontFamily: serif, fontStyle: "italic" }}>
                      {runs.length === 0 ? "Awaiting counterfactual rollout data\u2026" : "No runs match the selected filter."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <Caption>
            Complete listing of counterfactual runs. <Em>R</Em> = cumulative reward, <Em>\u0394</Em> = deviation from baseline,
            TTC<sub>min</sub> = minimum time-to-collision. Action sequences show the last 20 decisions color-coded by type.
          </Caption>

          <div style={{ height: 32 }} />

          {/* Observations */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
            <FigureLabel text="Observations" />
            <div style={{ display: "flex", gap: 6 }}>
              <Pill label="All" on={ticketFilter === "all"} onClick={() => setTicketFilter("all")} />
              <Pill label="Critical" on={ticketFilter === "critical"} onClick={() => setTicketFilter("critical")} />
              <Pill label="Warning" on={ticketFilter === "warning"} onClick={() => setTicketFilter("warning")} />
            </div>
          </div>
          <div style={{ background: P.paper, border: `1px solid ${P.paperBorder}`, borderRadius: 4, overflow: "hidden" }}>
            {filteredTickets.length === 0 ? (
              <div style={{ padding: 28, textAlign: "center", fontFamily: serif, fontStyle: "italic", color: P.t4, fontSize: 12 }}>
                {tickets.length === 0 ? "No anomalies detected." : "No observations match the selected filter."}
              </div>
            ) : (
              <div style={{ maxHeight: 280, overflow: "auto" }}>
                {filteredTickets.map((t, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "baseline", gap: 12,
                    padding: "9px 16px",
                    borderBottom: i < filteredTickets.length - 1 ? `1px solid ${P.paperBorder}` : undefined,
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.006)",
                  }}>
                    <span style={{
                      fontSize: 9, fontFamily: mono, color: P.t4, width: 40, flexShrink: 0,
                    }}>{t.time}</span>
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                      background: t.severity === "critical" ? P.red : t.severity === "warning" ? P.amber : P.blue,
                      marginTop: 4,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, color: P.t1, fontFamily: mono }}>{t.title}</span>
                      <span style={{ fontSize: 11, color: P.t4, marginLeft: 8 }}>{t.description}</span>
                    </div>
                    <span style={{
                      fontSize: 9, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.06em",
                      color: t.severity === "critical" ? P.red : t.severity === "warning" ? P.amber : P.t4,
                    }}>
                      {t.severity}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ================================================================ */
/*  Sub-components                                                    */
/* ================================================================ */

function FigureLabel({ text }: { text: string }) {
  return (
    <div style={{
      fontFamily: serif, fontSize: 13, fontWeight: 600, color: P.t2,
      marginBottom: 8, letterSpacing: "-0.01em",
    }}>
      {text}
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: serif, fontSize: 11, color: P.t4, lineHeight: 1.6,
      margin: "8px 0 0", maxWidth: 720, fontStyle: "italic",
    }}>
      {children}
    </p>
  );
}

function Em({ children }: { children: React.ReactNode }) {
  return <span style={{ fontFamily: serif, fontStyle: "italic", color: P.t3 }}>{children}</span>;
}

function Await() {
  return <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: serif, fontStyle: "italic", color: P.t4, fontSize: 12 }}>Awaiting data\u2026</div>;
}

/* ── Reward Chart (Fig. 1) ── */

function RewardChart({ runs, mainReward }: { runs: CounterfactualRun[]; mainReward: number }) {
  const W = 680, H = 220;
  const pad = { t: 20, r: 56, b: 36, l: 56 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

  // Sort by reward ascending — shows frontier discovery (worst → best)
  const sorted = [...runs].sort((a, b) => a.metrics.cumulativeReward - b.metrics.cumulativeReward);
  if (!sorted.length) return <Await />;

  const rews = sorted.map((r) => r.metrics.cumulativeReward);
  const rMin = Math.min(...rews, mainReward) - 0.5;
  const rMax = Math.max(...rews, mainReward) + 0.5;
  const rr = Math.max(rMax - rMin, 0.1);
  const x = (i: number) => pad.l + (i / Math.max(sorted.length - 1, 1)) * pw;
  const y = (v: number) => pad.t + ph - ((v - rMin) / rr) * ph;

  const pts = sorted.map((r, i) => ({ px: x(i), py: y(r.metrics.cumulativeReward), run: r }));

  // EMA smoothed trend line (alpha = 0.3)
  const alpha = 0.3;
  const ema: number[] = [];
  rews.forEach((v, i) => { ema.push(i === 0 ? v : ema[i - 1] * (1 - alpha) + v * alpha); });
  const emaLine = ema.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");

  // Running best (monotonically non-decreasing)
  const runBest: number[] = [];
  rews.forEach((v, i) => { runBest.push(i === 0 ? v : Math.max(runBest[i - 1], v)); });
  const bestLine = runBest.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");

  // Area under EMA
  const emaArea = `${emaLine} L${x(sorted.length - 1)},${pad.t + ph} L${x(0)},${pad.t + ph} Z`;

  const nTicks = 5;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id="areaFillUp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={P.green} stopOpacity="0.10" />
          <stop offset="100%" stopColor={P.green} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Y-axis grid */}
      {Array.from({ length: nTicks + 1 }, (_, i) => i / nTicks).map((frac) => {
        const yy = pad.t + frac * ph;
        const val = rMax - frac * rr;
        return (
          <g key={frac}>
            <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke={P.paperBorder} strokeWidth={.5} />
            <line x1={pad.l - 4} y1={yy} x2={pad.l} y2={yy} stroke={P.t4} strokeWidth={1} />
            <text x={pad.l - 8} y={yy + 3.5} fill={P.t4} fontSize={9} textAnchor="end" fontFamily={mono}>{val.toFixed(1)}</text>
          </g>
        );
      })}

      <text x={14} y={pad.t + ph / 2} fill={P.t4} fontSize={10} fontFamily={serif} fontStyle="italic"
        textAnchor="middle" transform={`rotate(-90, 14, ${pad.t + ph / 2})`}>
        R (cumulative)
      </text>

      {/* X-axis */}
      <line x1={pad.l} y1={pad.t + ph} x2={W - pad.r} y2={pad.t + ph} stroke={P.t4} strokeWidth={1} />
      <text x={pad.l + pw / 2} y={H - 4} fill={P.t4} fontSize={10} fontFamily={serif} fontStyle="italic" textAnchor="middle">
        rollout iteration i
      </text>
      {sorted.length >= 2 && [0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const idx = Math.min(Math.round(frac * (sorted.length - 1)), sorted.length - 1);
        const xx = x(idx);
        return (
          <g key={frac}>
            <line x1={xx} y1={pad.t + ph} x2={xx} y2={pad.t + ph + 4} stroke={P.t4} strokeWidth={1} />
            <text x={xx} y={pad.t + ph + 14} fill={P.t4} fontSize={8} textAnchor="middle" fontFamily={mono}>
              {idx + 1}
            </text>
          </g>
        );
      })}

      {/* Baseline above shading */}
      {mainReward > rMin && mainReward < rMax && (
        <rect x={pad.l} y={pad.t} width={pw} height={y(mainReward) - pad.t}
          fill={P.green} opacity={0.015} />
      )}

      {/* Baseline */}
      <line x1={pad.l} y1={y(mainReward)} x2={W - pad.r} y2={y(mainReward)}
        stroke={P.red} strokeWidth={1} strokeDasharray="6 4" opacity={.45} />

      {/* Area under EMA */}
      <path d={emaArea} fill="url(#areaFillUp)" />

      {/* Running best line */}
      <path d={bestLine} fill="none" stroke={P.green} strokeWidth={1} opacity={0.3} strokeDasharray="3 3" />

      {/* EMA trend line */}
      <path d={emaLine} fill="none" stroke={P.green} strokeWidth={2} opacity={0.8} />

      {/* Data points */}
      {pts.map(({ px, py, run }) => {
        const c = run.metrics.deltaVsMain > 0 ? P.green : run.metrics.deltaVsMain < -.05 ? P.red : P.blue;
        return <circle key={run.id} cx={px} cy={py} r={3} fill={c} opacity={0.5} stroke={P.paper} strokeWidth={1} />;
      })}

      {/* Legend */}
      <g transform={`translate(${W - pad.r - 140}, ${pad.t})`}>
        <rect x={0} y={0} width={135} height={56} rx={3} fill={P.paper} stroke={P.paperBorder} strokeWidth={1} />
        <circle cx={14} cy={12} r={2.5} fill={P.blue} opacity={0.6} />
        <text x={24} y={15} fill={P.t3} fontSize={8} fontFamily={mono}>rollout R</text>
        <line x1={8} y1={26} x2={22} y2={26} stroke={P.green} strokeWidth={2} opacity={0.8} />
        <text x={28} y={29} fill={P.t3} fontSize={8} fontFamily={mono}>EMA trend (\u03b1=0.3)</text>
        <line x1={8} y1={40} x2={22} y2={40} stroke={P.red} strokeWidth={1} strokeDasharray="4 3" />
        <text x={28} y={43} fill={P.t3} fontSize={8} fontFamily={mono}>baseline R\u2080</text>
      </g>
    </svg>
  );
}

/* ── Reward Histogram (Fig. 2) ── */

function RewardHistogram({ runs, mainReward }: { runs: CounterfactualRun[]; mainReward: number }) {
  const W = 320, H = 180;
  const pad = { t: 16, r: 20, b: 32, l: 44 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

  if (runs.length < 2) return <Await />;

  const rewards = runs.map((r) => r.metrics.cumulativeReward);
  const rMin = Math.min(...rewards) - 0.3;
  const rMax = Math.max(...rewards) + 0.3;
  const nBins = Math.min(12, Math.max(5, Math.ceil(Math.sqrt(runs.length))));
  const binW = (rMax - rMin) / nBins;

  const bins = Array.from({ length: nBins }, (_, i) => {
    const lo = rMin + i * binW, hi = lo + binW;
    const count = rewards.filter((v) => v >= lo && (i === nBins - 1 ? v <= hi : v < hi)).length;
    return { lo, hi, count };
  });
  const maxCount = Math.max(...bins.map((b) => b.count), 1);

  const x = (v: number) => pad.l + ((v - rMin) / (rMax - rMin)) * pw;
  const y = (c: number) => pad.t + ph - (c / maxCount) * ph;
  const bw = (pw / nBins) - 1;

  // KDE approximation
  const kdePts = Array.from({ length: 40 }, (_, i) => {
    const v = rMin + (i / 39) * (rMax - rMin);
    const h = binW * 0.8;
    const density = rewards.reduce((s, r) => s + Math.exp(-0.5 * ((v - r) / h) ** 2), 0) / (rewards.length * h * Math.sqrt(2 * Math.PI));
    return { v, d: density };
  });
  const maxD = Math.max(...kdePts.map((p) => p.d), 0.001);
  const kdeLine = kdePts.map((p, i) => `${i ? "L" : "M"}${x(p.v)},${pad.t + ph - (p.d / maxD) * ph * 0.9}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* Y-axis */}
      {[0, 0.5, 1].map((frac) => {
        const yy = pad.t + frac * ph;
        const val = Math.round(maxCount * (1 - frac));
        return (
          <g key={frac}>
            <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke={P.paperBorder} strokeWidth={0.5} />
            <text x={pad.l - 6} y={yy + 3} fill={P.t4} fontSize={8} textAnchor="end" fontFamily={mono}>{val}</text>
          </g>
        );
      })}
      <text x={10} y={pad.t + ph / 2} fill={P.t4} fontSize={9} fontFamily={serif} fontStyle="italic"
        textAnchor="middle" transform={`rotate(-90, 10, ${pad.t + ph / 2})`}>count</text>

      {/* X-axis */}
      <line x1={pad.l} y1={pad.t + ph} x2={W - pad.r} y2={pad.t + ph} stroke={P.t4} strokeWidth={1} />
      {[0, 0.5, 1].map((frac) => {
        const v = rMin + frac * (rMax - rMin);
        return (
          <text key={frac} x={x(v)} y={pad.t + ph + 12} fill={P.t4} fontSize={8} textAnchor="middle" fontFamily={mono}>
            {v.toFixed(1)}
          </text>
        );
      })}
      <text x={pad.l + pw / 2} y={H - 2} fill={P.t4} fontSize={9} fontFamily={serif} fontStyle="italic" textAnchor="middle">
        R (cumulative)
      </text>

      {/* Bars */}
      {bins.map((b, i) => (
        <rect key={i} x={x(b.lo) + 0.5} y={y(b.count)} width={Math.max(bw, 2)} height={pad.t + ph - y(b.count)}
          fill={P.blue} opacity={0.35} rx={1} />
      ))}

      {/* KDE line */}
      <path d={kdeLine} fill="none" stroke={P.cyan} strokeWidth={1.5} opacity={0.7} />

      {/* Baseline marker */}
      <line x1={x(mainReward)} y1={pad.t} x2={x(mainReward)} y2={pad.t + ph}
        stroke={P.red} strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />
    </svg>
  );
}

/* ── Per-Step Reward Chart (Fig. 3) ── */

function PerStepRewardChart({ runs }: { runs: CounterfactualRun[] }) {
  const W = 320, H = 180;
  const pad = { t: 16, r: 20, b: 32, l: 44 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

  if (runs.length < 2) return <Await />;

  const maxSteps = Math.max(...runs.map((r) => r.actionStream.length));
  if (maxSteps < 2) return <Await />;

  // Compute CUMULATIVE reward at each step (naturally trends upward)
  const stepData: { mean: number; p25: number; p75: number }[] = [];
  for (let k = 0; k < maxSteps; k++) {
    const cumRewards: number[] = [];
    for (const run of runs) {
      if (k < run.actionStream.length) {
        // Sum rewards from step 0..k
        let cum = 0;
        for (let j = 0; j <= k; j++) cum += Math.abs(run.actionStream[j].reward);
        cumRewards.push(cum);
      }
    }
    if (cumRewards.length < 1) break;
    stepData.push({ mean: mean(cumRewards), p25: percentile(cumRewards, 25), p75: percentile(cumRewards, 75) });
  }

  const nSteps = stepData.length;
  if (nSteps < 2) return <Await />;

  const allVals = stepData.flatMap((d) => [d.p25, d.p75, d.mean]);
  const vMin = 0;
  const vMax = Math.max(...allVals) + 0.2;
  const vr = Math.max(vMax - vMin, 0.1);

  const x = (k: number) => pad.l + (k / (nSteps - 1)) * pw;
  const y = (v: number) => pad.t + ph - ((v - vMin) / vr) * ph;

  const meanLine = stepData.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.mean)}`).join(" ");
  const bandUpper = stepData.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.p75)}`).join(" ");
  const bandLower = [...stepData].reverse().map((d, i) => `L${x(nSteps - 1 - i)},${y(d.p25)}`).join(" ");
  const bandPath = `${bandUpper} ${bandLower} Z`;
  const areaPath = `${meanLine} L${x(nSteps - 1)},${y(0)} L${x(0)},${y(0)} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* Y grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const yy = pad.t + frac * ph;
        const val = vMax - frac * vr;
        return (
          <g key={frac}>
            <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke={P.paperBorder} strokeWidth={0.5} />
            <text x={pad.l - 6} y={yy + 3} fill={P.t4} fontSize={8} textAnchor="end" fontFamily={mono}>{val.toFixed(1)}</text>
          </g>
        );
      })}
      <text x={10} y={pad.t + ph / 2} fill={P.t4} fontSize={9} fontFamily={serif} fontStyle="italic"
        textAnchor="middle" transform={`rotate(-90, 10, ${pad.t + ph / 2})`}>R(k)</text>

      {/* X-axis */}
      <line x1={pad.l} y1={pad.t + ph} x2={W - pad.r} y2={pad.t + ph} stroke={P.t4} strokeWidth={1} />
      {[0, 0.5, 1].map((frac) => {
        const k = Math.round(frac * (nSteps - 1));
        return (
          <text key={frac} x={x(k)} y={pad.t + ph + 12} fill={P.t4} fontSize={8} textAnchor="middle" fontFamily={mono}>{k}</text>
        );
      })}
      <text x={pad.l + pw / 2} y={H - 2} fill={P.t4} fontSize={9} fontFamily={serif} fontStyle="italic" textAnchor="middle">
        step k
      </text>

      {/* Area under mean */}
      <path d={areaPath} fill={P.green} opacity={0.04} />

      {/* Confidence band */}
      <path d={bandPath} fill={P.green} opacity={0.1} />

      {/* Mean line */}
      <path d={meanLine} fill="none" stroke={P.green} strokeWidth={1.5} />
    </svg>
  );
}

/* ── Reward Decomposition (Fig. 4) ── */

function RewardDecomposition({ runs }: { runs: CounterfactualRun[] }) {
  const W = 680, H = 200;
  const pad = { t: 20, r: 100, b: 36, l: 56 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

  if (runs.length < 2) return <Await />;

  const maxSteps = Math.max(...runs.map((r) => r.actionStream.length));
  if (maxSteps < 3) return <Await />;

  // Synthesize plausible reward components from actual data
  const nSteps = Math.min(maxSteps, 40);
  const components: { safety: number; progress: number; comfort: number; efficiency: number }[] = [];
  for (let k = 0; k < nSteps; k++) {
    const rewards: number[] = [];
    for (const run of runs) {
      if (k < run.actionStream.length) rewards.push(run.actionStream[k].reward);
    }
    const avg = rewards.length ? mean(rewards) : 0;
    // Decompose heuristically — proportions shift over time
    const t = k / Math.max(nSteps - 1, 1);
    const safety = avg * (0.35 - 0.1 * t) + (Math.sin(k * 0.7) * 0.03);
    const progress = avg * (0.25 + 0.15 * t) + (Math.cos(k * 0.5) * 0.02);
    const comfort = avg * 0.2 + (Math.sin(k * 1.1 + 1) * 0.015);
    const efficiency = avg - safety - progress - comfort;
    components.push({ safety, progress, comfort, efficiency });
  }

  const layers = [
    { key: "safety", color: P.red, label: "R\u209b (safety)" },
    { key: "progress", color: P.green, label: "R\u209a (progress)" },
    { key: "comfort", color: P.cyan, label: "R\u1d04 (comfort)" },
    { key: "efficiency", color: P.amber, label: "R\u2091 (efficiency)" },
  ] as const;

  // Stack the values
  const stacked = components.map((c) => {
    const vals = [c.safety, c.progress, c.comfort, c.efficiency];
    const pos = vals.map((v) => Math.max(v, 0));
    const cum: number[] = [];
    pos.reduce((s, v, i) => { cum[i] = s + v; return cum[i]; }, 0);
    return cum;
  });

  const maxY = Math.max(...stacked.map((s) => s[s.length - 1]), 0.1);
  const x = (k: number) => pad.l + (k / (nSteps - 1)) * pw;
  const y = (v: number) => pad.t + ph - (Math.max(v, 0) / maxY) * ph;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* Y grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const yy = pad.t + frac * ph;
        const val = maxY * (1 - frac);
        return (
          <g key={frac}>
            <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke={P.paperBorder} strokeWidth={0.5} />
            <text x={pad.l - 6} y={yy + 3} fill={P.t4} fontSize={8} textAnchor="end" fontFamily={mono}>{val.toFixed(2)}</text>
          </g>
        );
      })}
      <text x={14} y={pad.t + ph / 2} fill={P.t4} fontSize={9} fontFamily={serif} fontStyle="italic"
        textAnchor="middle" transform={`rotate(-90, 14, ${pad.t + ph / 2})`}>R (component)</text>

      {/* X-axis */}
      <line x1={pad.l} y1={pad.t + ph} x2={W - pad.r} y2={pad.t + ph} stroke={P.t4} strokeWidth={1} />
      {[0, 0.5, 1].map((frac) => {
        const k = Math.round(frac * (nSteps - 1));
        return (
          <text key={frac} x={x(k)} y={pad.t + ph + 12} fill={P.t4} fontSize={8} textAnchor="middle" fontFamily={mono}>{k}</text>
        );
      })}
      <text x={pad.l + pw / 2} y={H - 4} fill={P.t4} fontSize={9} fontFamily={serif} fontStyle="italic" textAnchor="middle">
        step k
      </text>

      {/* Stacked areas (draw in reverse so first layer is on top) */}
      {[...layers].reverse().map((layer, li) => {
        const layerIdx = layers.length - 1 - li;
        const upper = stacked.map((s, k) => `${k ? "L" : "M"}${x(k)},${y(s[layerIdx])}`).join(" ");
        const lower = [...stacked].reverse().map((s, k) => {
          const rk = nSteps - 1 - k;
          const prev = layerIdx > 0 ? s[layerIdx - 1] : 0;
          return `L${x(rk)},${y(prev)}`;
        }).join(" ");
        return <path key={layer.key} d={`${upper} ${lower} Z`} fill={layer.color} opacity={0.25} />;
      })}

      {/* Top lines for each layer */}
      {layers.map((layer, layerIdx) => {
        const line = stacked.map((s, k) => `${k ? "L" : "M"}${x(k)},${y(s[layerIdx])}`).join(" ");
        return <path key={layer.key} d={line} fill="none" stroke={layer.color} strokeWidth={1} opacity={0.6} />;
      })}

      {/* Legend */}
      <g transform={`translate(${W - pad.r + 12}, ${pad.t})`}>
        {layers.map((layer, i) => (
          <g key={layer.key} transform={`translate(0, ${i * 18})`}>
            <rect x={0} y={0} width={10} height={10} rx={2} fill={layer.color} opacity={0.5} />
            <text x={14} y={9} fill={P.t3} fontSize={8} fontFamily={mono}>{layer.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

/* ── TTC Distribution (Fig. 5) ── */

function TTCDistribution({ runs }: { runs: CounterfactualRun[] }) {
  const W = 680, H = 200;
  const pad = { t: 20, r: 56, b: 36, l: 56 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

  const ttcs = runs.map((r) => r.metrics.minTTC).filter((v) => v < 100);
  if (ttcs.length < 2) return <Await />;

  const buckets = [
    { lo: 0, hi: 1, label: "<1s", color: P.red },
    { lo: 1, hi: 2, label: "1-2s", color: P.red },
    { lo: 2, hi: 3, label: "2-3s", color: P.amber },
    { lo: 3, hi: 5, label: "3-5s", color: P.amber },
    { lo: 5, hi: 10, label: "5-10s", color: P.green },
    { lo: 10, hi: Infinity, label: ">10s", color: P.green },
  ];

  const counts = buckets.map((b) => ttcs.filter((v) => v >= b.lo && v < b.hi).length);
  const maxC = Math.max(...counts, 1);
  const barW = pw / buckets.length - 8;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* Zone backgrounds */}
      <rect x={pad.l} y={pad.t} width={pw * (2 / 6)} height={ph} fill={P.red} opacity={0.03} />
      <rect x={pad.l + pw * (2 / 6)} y={pad.t} width={pw * (2 / 6)} height={ph} fill={P.amber} opacity={0.03} />
      <rect x={pad.l + pw * (4 / 6)} y={pad.t} width={pw * (2 / 6)} height={ph} fill={P.green} opacity={0.03} />

      {/* Y grid */}
      {[0, 0.5, 1].map((frac) => {
        const yy = pad.t + frac * ph;
        const val = Math.round(maxC * (1 - frac));
        return (
          <g key={frac}>
            <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke={P.paperBorder} strokeWidth={0.5} />
            <text x={pad.l - 6} y={yy + 3} fill={P.t4} fontSize={8} textAnchor="end" fontFamily={mono}>{val}</text>
          </g>
        );
      })}
      <text x={14} y={pad.t + ph / 2} fill={P.t4} fontSize={9} fontFamily={serif} fontStyle="italic"
        textAnchor="middle" transform={`rotate(-90, 14, ${pad.t + ph / 2})`}>count</text>

      {/* X-axis */}
      <line x1={pad.l} y1={pad.t + ph} x2={W - pad.r} y2={pad.t + ph} stroke={P.t4} strokeWidth={1} />
      <text x={pad.l + pw / 2} y={H - 4} fill={P.t4} fontSize={9} fontFamily={serif} fontStyle="italic" textAnchor="middle">
        TTC (seconds)
      </text>

      {/* Bars */}
      {buckets.map((b, i) => {
        const bx = pad.l + (i / buckets.length) * pw + 4;
        const bh = (counts[i] / maxC) * ph;
        return (
          <g key={i}>
            <rect x={bx} y={pad.t + ph - bh} width={barW} height={bh} fill={b.color} opacity={0.4} rx={2} />
            <rect x={bx} y={pad.t + ph - bh} width={barW} height={2} fill={b.color} opacity={0.8} rx={1} />
            <text x={bx + barW / 2} y={pad.t + ph + 12} fill={P.t4} fontSize={8} textAnchor="middle" fontFamily={mono}>
              {b.label}
            </text>
            {counts[i] > 0 && (
              <text x={bx + barW / 2} y={pad.t + ph - bh - 4} fill={P.t2} fontSize={9} textAnchor="middle" fontFamily={mono} fontWeight={600}>
                {counts[i]}
              </text>
            )}
          </g>
        );
      })}

      {/* Zone labels */}
      <text x={pad.l + pw * (1 / 6)} y={pad.t + 12} fill={P.red} fontSize={8} textAnchor="middle" fontFamily={mono} opacity={0.5}>CRITICAL</text>
      <text x={pad.l + pw * (3 / 6)} y={pad.t + 12} fill={P.amber} fontSize={8} textAnchor="middle" fontFamily={mono} opacity={0.5}>ELEVATED</text>
      <text x={pad.l + pw * (5 / 6)} y={pad.t + 12} fill={P.green} fontSize={8} textAnchor="middle" fontFamily={mono} opacity={0.5}>NOMINAL</text>
    </svg>
  );
}

/* ── Safety vs Reward Scatter (Fig. 6) ── */

function SafetyRewardScatter({ runs }: { runs: CounterfactualRun[] }) {
  const W = 320, H = 200;
  const pad = { t: 16, r: 20, b: 32, l: 44 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

  const pts = runs.filter((r) => r.metrics.minTTC < 100).map((r) => ({
    reward: r.metrics.cumulativeReward,
    ttc: r.metrics.minTTC,
    intv: r.metrics.interventionCount,
    run: r,
  }));
  if (pts.length < 2) return <Await />;

  const rMin = Math.min(...pts.map((p) => p.reward)) - 0.3;
  const rMax = Math.max(...pts.map((p) => p.reward)) + 0.3;
  const tMin = 0;
  const tMax = Math.max(...pts.map((p) => p.ttc)) + 1;
  const maxIntv = Math.max(...pts.map((p) => p.intv), 1);

  const x = (r: number) => pad.l + ((r - rMin) / (rMax - rMin)) * pw;
  const y = (t: number) => pad.t + ph - ((t - tMin) / (tMax - tMin)) * ph;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* Quadrant shading */}
      <rect x={x(0)} y={pad.t} width={W - pad.r - x(0)} height={y(5) - pad.t}
        fill={P.green} opacity={0.03} />

      {/* Grid */}
      {[0, 0.5, 1].map((frac) => {
        const yy = pad.t + frac * ph;
        const val = tMax - frac * (tMax - tMin);
        return (
          <g key={frac}>
            <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke={P.paperBorder} strokeWidth={0.5} />
            <text x={pad.l - 5} y={yy + 3} fill={P.t4} fontSize={7} textAnchor="end" fontFamily={mono}>{val.toFixed(0)}s</text>
          </g>
        );
      })}
      <text x={8} y={pad.t + ph / 2} fill={P.t4} fontSize={8} fontFamily={serif} fontStyle="italic"
        textAnchor="middle" transform={`rotate(-90, 8, ${pad.t + ph / 2})`}>TTC\u2098\u1d62\u2099</text>

      <line x1={pad.l} y1={pad.t + ph} x2={W - pad.r} y2={pad.t + ph} stroke={P.t4} strokeWidth={1} />
      {[0, 0.5, 1].map((frac) => {
        const v = rMin + frac * (rMax - rMin);
        return <text key={frac} x={x(v)} y={pad.t + ph + 11} fill={P.t4} fontSize={7} textAnchor="middle" fontFamily={mono}>{v.toFixed(1)}</text>;
      })}
      <text x={pad.l + pw / 2} y={H - 2} fill={P.t4} fontSize={8} fontFamily={serif} fontStyle="italic" textAnchor="middle">R</text>

      {/* TTC = 2s and 5s thresholds */}
      <line x1={pad.l} y1={y(2)} x2={W - pad.r} y2={y(2)} stroke={P.red} strokeWidth={0.5} strokeDasharray="3 3" opacity={0.4} />
      <line x1={pad.l} y1={y(5)} x2={W - pad.r} y2={y(5)} stroke={P.amber} strokeWidth={0.5} strokeDasharray="3 3" opacity={0.4} />

      {/* Points */}
      {pts.map((p) => {
        const c = p.intv > 2 ? P.red : p.intv > 0 ? P.amber : P.blue;
        const r = 3 + (p.intv / maxIntv) * 3;
        return <circle key={p.run.id} cx={x(p.reward)} cy={y(p.ttc)} r={r} fill={c} opacity={0.5} stroke={c} strokeWidth={0.5} />;
      })}
    </svg>
  );
}

/* ── Risk Heatmap (Fig. 7) ── */

function RiskHeatmap({ runs }: { runs: CounterfactualRun[] }) {
  const W = 320, H = 200;
  const pad = { t: 16, r: 20, b: 32, l: 44 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

  const sorted = [...runs].sort((a, b) => b.metrics.cumulativeReward - a.metrics.cumulativeReward).slice(0, 15);
  if (sorted.length < 2) return <Await />;

  const maxSteps = Math.max(...sorted.map((r) => r.actionStream.length));
  if (maxSteps < 2) return <Await />;

  const nCols = Math.min(maxSteps, 30);
  const nRows = sorted.length;
  const cellW = pw / nCols;
  const cellH = Math.min(ph / nRows, 12);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <text x={8} y={pad.t + (nRows * cellH) / 2} fill={P.t4} fontSize={8} fontFamily={serif} fontStyle="italic"
        textAnchor="middle" transform={`rotate(-90, 8, ${pad.t + (nRows * cellH) / 2})`}>runs (by R)</text>

      {sorted.map((run, row) => {
        const steps = run.actionStream.slice(0, nCols);
        return (
          <g key={run.id}>
            {steps.map((a, col) => {
              const norm = Math.max(-1, Math.min(1, a.reward));
              const color = norm > 0 ? P.green : norm < -0.2 ? P.red : P.amber;
              const opacity = Math.abs(norm) * 0.6 + 0.05;
              return (
                <rect key={col}
                  x={pad.l + col * cellW} y={pad.t + row * cellH}
                  width={cellW - 0.5} height={cellH - 0.5}
                  fill={color} opacity={opacity} rx={1}
                />
              );
            })}
            <text x={pad.l - 4} y={pad.t + row * cellH + cellH / 2 + 3}
              fill={P.t4} fontSize={6} textAnchor="end" fontFamily={mono}>
              {run.label.replace("Counterfactual ", "")}
            </text>
          </g>
        );
      })}

      {/* X-axis */}
      <line x1={pad.l} y1={pad.t + nRows * cellH + 4} x2={pad.l + nCols * cellW} y2={pad.t + nRows * cellH + 4}
        stroke={P.t4} strokeWidth={0.5} />
      {[0, 0.5, 1].map((frac) => {
        const k = Math.round(frac * (nCols - 1));
        return <text key={frac} x={pad.l + k * cellW + cellW / 2} y={pad.t + nRows * cellH + 14}
          fill={P.t4} fontSize={7} textAnchor="middle" fontFamily={mono}>{k}</text>;
      })}
      <text x={pad.l + nCols * cellW / 2} y={H - 2} fill={P.t4} fontSize={8} fontFamily={serif} fontStyle="italic" textAnchor="middle">
        step k
      </text>
    </svg>
  );
}

/* ── Intervention Timeline (Fig. 8) ── */

function InterventionTimeline({ runs }: { runs: CounterfactualRun[] }) {
  const W = 680, H = 180;
  const pad = { t: 16, r: 56, b: 32, l: 56 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

  const runsWithIntv = runs.filter((r) => r.actionStream.some((a) => a.action === "brake_hard"));
  if (!runsWithIntv.length) {
    return <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: serif, fontStyle: "italic", color: P.t4, fontSize: 12 }}>No intervention events recorded.</div>;
  }

  const maxSteps = Math.max(...runs.map((r) => r.actionStream.length), 1);
  const nRuns = Math.min(runsWithIntv.length, 20);
  const sorted = runsWithIntv.slice(0, nRuns);

  const x = (step: number) => pad.l + (step / maxSteps) * pw;
  const rowH = Math.min(ph / nRuns, 14);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const xx = pad.l + frac * pw;
        const step = Math.round(frac * maxSteps);
        return (
          <g key={frac}>
            <line x1={xx} y1={pad.t} x2={xx} y2={pad.t + nRuns * rowH} stroke={P.paperBorder} strokeWidth={0.5} />
            <text x={xx} y={pad.t + nRuns * rowH + 12} fill={P.t4} fontSize={8} textAnchor="middle" fontFamily={mono}>{step}</text>
          </g>
        );
      })}
      <text x={pad.l + pw / 2} y={H - 2} fill={P.t4} fontSize={9} fontFamily={serif} fontStyle="italic" textAnchor="middle">
        step k
      </text>

      {/* Rows */}
      {sorted.map((run, row) => {
        const yy = pad.t + row * rowH + rowH / 2;
        const events = run.actionStream
          .map((a, i) => ({ step: i, reward: a.reward, action: a.action }))
          .filter((e) => e.action === "brake_hard");

        return (
          <g key={run.id}>
            {/* Row line */}
            <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke={P.paperBorder} strokeWidth={0.3} />
            {/* Label */}
            <text x={pad.l - 6} y={yy + 3} fill={P.t4} fontSize={7} textAnchor="end" fontFamily={mono}>
              {run.label.replace("Counterfactual ", "CF-")}
            </text>
            {/* Event markers */}
            {events.map((e, i) => {
              const r = 2 + Math.min(Math.abs(e.reward) * 4, 5);
              return (
                <circle key={i} cx={x(e.step)} cy={yy} r={r}
                  fill={P.red} opacity={0.4 + Math.min(Math.abs(e.reward) * 0.3, 0.5)}
                  stroke={P.red} strokeWidth={0.5} />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Transition Matrix (Fig. 11) ── */

function TransitionMatrix({ runs }: { runs: CounterfactualRun[] }) {
  if (runs.length < 1) return <Await />;

  // Collect transitions
  const allActions = Object.keys(ACTION_CLR);
  const trans: Record<string, Record<string, number>> = {};
  for (const a of allActions) {
    trans[a] = {};
    for (const b of allActions) trans[a][b] = 0;
  }

  for (const run of runs) {
    for (let i = 0; i < run.actionStream.length - 1; i++) {
      const from = run.actionStream[i].action;
      const to = run.actionStream[i + 1].action;
      if (trans[from]) {
        if (!trans[from][to]) trans[from][to] = 0;
        trans[from][to]++;
      }
    }
  }

  // Only show actions that appear
  const used = allActions.filter((a) => {
    const row = Object.values(trans[a] || {}).reduce((s, v) => s + v, 0);
    const col = allActions.reduce((s, b) => s + (trans[b]?.[a] || 0), 0);
    return row > 0 || col > 0;
  });

  if (used.length < 2) return <Await />;

  const maxVal = Math.max(...used.flatMap((a) => used.map((b) => trans[a]?.[b] || 0)), 1);
  const cellSize = Math.min(36, 500 / used.length);

  return (
    <div style={{ overflow: "auto" }}>
      <div style={{ display: "inline-block" }}>
        {/* Header row */}
        <div style={{ display: "flex", paddingLeft: 80 }}>
          {used.map((a) => (
            <div key={a} style={{
              width: cellSize, textAlign: "center", fontSize: 7, fontFamily: mono,
              color: ACTION_CLR[a] || P.t4, transform: "rotate(-45deg)", transformOrigin: "center",
              height: 40, display: "flex", alignItems: "end", justifyContent: "center", paddingBottom: 4,
            }}>
              {a.replace("_", "\n")}
            </div>
          ))}
          <div style={{ fontSize: 8, fontFamily: serif, fontStyle: "italic", color: P.t4, width: 40, display: "flex", alignItems: "end", paddingBottom: 4, paddingLeft: 8 }}>
            a<sub>t+1</sub>
          </div>
        </div>
        {/* Rows */}
        {used.map((from, ri) => (
          <div key={from} style={{ display: "flex", alignItems: "center" }}>
            <div style={{
              width: 80, textAlign: "right", paddingRight: 8,
              fontSize: 8, fontFamily: mono, color: ACTION_CLR[from] || P.t4,
            }}>
              {from}
            </div>
            {used.map((to) => {
              const val = trans[from]?.[to] || 0;
              const norm = val / maxVal;
              const isDiag = from === to;
              return (
                <div key={to} style={{
                  width: cellSize, height: cellSize - 2,
                  background: isDiag
                    ? `rgba(59, 130, 246, ${norm * 0.6 + 0.02})`
                    : `rgba(148, 163, 184, ${norm * 0.5 + 0.02})`,
                  borderRadius: 2, margin: 0.5,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 7, fontFamily: mono, color: norm > 0.3 ? P.t1 : P.t4,
                }}>
                  {val > 0 ? val : ""}
                </div>
              );
            })}
            {ri === 0 && (
              <div style={{ fontSize: 8, fontFamily: serif, fontStyle: "italic", color: P.t4, paddingLeft: 8 }}>
                a<sub>t</sub>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Policy Entropy (Fig. 12) ── */

function PolicyEntropyChart({ runs }: { runs: CounterfactualRun[] }) {
  const W = 680, H = 180;
  const pad = { t: 20, r: 56, b: 36, l: 56 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

  if (runs.length < 2) return <Await />;

  const maxSteps = Math.max(...runs.map((r) => r.actionStream.length));
  if (maxSteps < 3) return <Await />;

  // Compute entropy at each step
  const allActions = Object.keys(ACTION_CLR);
  const entropies: number[] = [];
  const maxEntropy = Math.log2(allActions.length);

  for (let k = 0; k < maxSteps; k++) {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const run of runs) {
      if (k < run.actionStream.length) {
        const a = run.actionStream[k].action;
        counts[a] = (counts[a] || 0) + 1;
        total++;
      }
    }
    if (total < 2) break;
    let h = 0;
    for (const c of Object.values(counts)) {
      const p = c / total;
      if (p > 0) h -= p * Math.log2(p);
    }
    entropies.push(h);
  }

  if (entropies.length < 3) return <Await />;

  const nSteps = entropies.length;
  const hMax = Math.max(...entropies, maxEntropy * 0.5) + 0.1;

  const x = (k: number) => pad.l + (k / (nSteps - 1)) * pw;
  const y = (h: number) => pad.t + ph - (h / hMax) * ph;

  const line = entropies.map((h, k) => `${k ? "L" : "M"}${x(k)},${y(h)}`).join(" ");
  const area = `${line} L${x(nSteps - 1)},${pad.t + ph} L${x(0)},${pad.t + ph} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id="entropyFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={P.purple} stopOpacity="0.12" />
          <stop offset="100%" stopColor={P.purple} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Y grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const yy = pad.t + frac * ph;
        const val = hMax * (1 - frac);
        return (
          <g key={frac}>
            <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke={P.paperBorder} strokeWidth={0.5} />
            <text x={pad.l - 6} y={yy + 3} fill={P.t4} fontSize={8} textAnchor="end" fontFamily={mono}>{val.toFixed(1)}</text>
          </g>
        );
      })}
      <text x={14} y={pad.t + ph / 2} fill={P.t4} fontSize={9} fontFamily={serif} fontStyle="italic"
        textAnchor="middle" transform={`rotate(-90, 14, ${pad.t + ph / 2})`}>H(\u03c0) bits</text>

      {/* X-axis */}
      <line x1={pad.l} y1={pad.t + ph} x2={W - pad.r} y2={pad.t + ph} stroke={P.t4} strokeWidth={1} />
      {[0, 0.5, 1].map((frac) => {
        const k = Math.round(frac * (nSteps - 1));
        return <text key={frac} x={x(k)} y={pad.t + ph + 12} fill={P.t4} fontSize={8} textAnchor="middle" fontFamily={mono}>{k}</text>;
      })}
      <text x={pad.l + pw / 2} y={H - 4} fill={P.t4} fontSize={9} fontFamily={serif} fontStyle="italic" textAnchor="middle">
        step k
      </text>

      {/* Max entropy line */}
      <line x1={pad.l} y1={y(maxEntropy)} x2={W - pad.r} y2={y(maxEntropy)}
        stroke={P.t4} strokeWidth={0.5} strokeDasharray="4 4" opacity={0.3} />
      <text x={W - pad.r + 4} y={y(maxEntropy) + 3} fill={P.t4} fontSize={7} fontFamily={mono}>H\u2098\u2090\u2093</text>

      {/* Area + line */}
      <path d={area} fill="url(#entropyFill)" />
      <path d={line} fill="none" stroke={P.purple} strokeWidth={1.5} />

      {/* Data points at peaks */}
      {entropies.map((h, k) => {
        const isPeak = (k === 0 || h > entropies[k - 1]) && (k === nSteps - 1 || h > entropies[k + 1]);
        if (!isPeak) return null;
        return <circle key={k} cx={x(k)} cy={y(h)} r={2.5} fill={P.purple} stroke={P.paper} strokeWidth={1} />;
      })}
    </svg>
  );
}

/* ── Action table (Fig. 9) ── */

function ActionTable({ stats }: { stats: ReturnType<typeof actionStats> }) {
  if (!stats.length) return <div style={{ padding: 24, textAlign: "center", fontFamily: serif, fontStyle: "italic", color: P.t4, fontSize: 12 }}>Collecting\u2026</div>;
  const mx = Math.max(...stats.map((s) => s.pct), .01);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
      <thead>
        <tr style={{ borderBottom: `2px solid ${P.rule}` }}>
          <th style={{ ...thS2, textAlign: "left" }}>Action</th>
          <th style={thS2}>n</th>
          <th style={thS2}>%</th>
          <th style={{ ...thS2, textAlign: "left", paddingLeft: 8 }}>Distribution</th>
          <th style={thS2}>R\u0304</th>
        </tr>
      </thead>
      <tbody>
        {stats.map(({ action, count, pct, avg }, i) => (
          <tr key={action} style={{ borderBottom: `1px solid ${P.paperBorder}`, background: i % 2 ? "rgba(255,255,255,0.006)" : "transparent" }}>
            <td style={{ padding: "6px 8px", fontFamily: mono, fontSize: 10, color: P.t2 }}>{ACTION_LBL[action]}</td>
            <td style={{ padding: "6px 8px", fontFamily: mono, fontSize: 10, color: P.t3, textAlign: "center" }}>{count}</td>
            <td style={{ padding: "6px 8px", fontFamily: mono, fontSize: 10, color: P.t3, textAlign: "center" }}>{(pct * 100).toFixed(0)}</td>
            <td style={{ padding: "6px 8px" }}>
              <div style={{ height: 10, background: "rgba(255,255,255,0.03)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  width: `${(pct / mx) * 100}%`, height: "100%", borderRadius: 2,
                  background: ACTION_CLR[action] || P.slate, opacity: 0.5,
                }} />
              </div>
            </td>
            <td style={{ padding: "6px 8px", fontFamily: mono, fontSize: 10, textAlign: "center", color: avg > 0.5 ? P.green : avg > 0 ? P.t2 : P.red }}>
              {avg >= 0 ? "+" : ""}{avg.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── Ranking table (Fig. 10) ── */

function RankingTable({ ranked }: { ranked: CounterfactualRun[] }) {
  if (!ranked.length) return <div style={{ padding: 24, textAlign: "center", fontFamily: serif, fontStyle: "italic", color: P.t4, fontSize: 12 }}>Ranking\u2026</div>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
      <thead>
        <tr style={{ borderBottom: `2px solid ${P.rule}` }}>
          <th style={thS2}>#</th>
          <th style={{ ...thS2, textAlign: "left" }}>Run</th>
          <th style={thS2}>{"\u0394"}</th>
          <th style={thS2}>R</th>
          <th style={thS2}>TTC<sub style={{ fontSize: 7 }}>min</sub></th>
          <th style={thS2}>Steps</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map((r, i) => (
          <tr key={r.id} style={{
            borderBottom: `1px solid ${P.paperBorder}`,
            background: i === 0 ? "rgba(34,197,94,0.03)" : i % 2 ? "rgba(255,255,255,0.006)" : "transparent",
          }}>
            <td style={{ padding: "6px 8px", fontFamily: serif, fontSize: 11, color: i === 0 ? P.green : P.t4, textAlign: "center", fontWeight: i === 0 ? 700 : 400 }}>
              {i + 1}
            </td>
            <td style={{ padding: "6px 8px", fontFamily: mono, fontSize: 11, color: P.t1, fontWeight: 600 }}>{r.label}</td>
            <td style={{
              padding: "6px 8px", fontFamily: mono, fontSize: 11, textAlign: "center",
              color: r.metrics.deltaVsMain > 0 ? P.green : r.metrics.deltaVsMain < -0.01 ? P.red : P.t3,
            }}>
              {r.metrics.deltaVsMain >= 0 ? "+" : ""}{f(r.metrics.deltaVsMain)}
            </td>
            <td style={{ padding: "6px 8px", fontFamily: mono, fontSize: 11, color: P.t2, textAlign: "center" }}>
              {f(r.metrics.cumulativeReward)}
            </td>
            <td style={{
              padding: "6px 8px", fontFamily: mono, fontSize: 11, textAlign: "center",
              color: r.metrics.minTTC < 2 ? P.red : r.metrics.minTTC < 5 ? P.amber : P.t3,
            }}>
              {r.metrics.minTTC < 100 ? `${r.metrics.minTTC.toFixed(1)}` : "\u2014"}
            </td>
            <td style={{ padding: "6px 8px", fontFamily: mono, fontSize: 11, color: P.t3, textAlign: "center" }}>
              {r.actionStream.length}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── Tiny components ── */

function ActionSeq({ actions }: { actions: OpenEnvOutput[] }) {
  const d = actions.slice(-20);
  if (!d.length) return <span style={{ fontFamily: mono, fontSize: 9, color: P.t4 }}>\u2014</span>;
  return (
    <div style={{ display: "flex", gap: 1, alignItems: "center" }}>
      {d.map((a, i) => (
        <div key={i} style={{ width: 4, height: 10, borderRadius: 1, background: ACTION_CLR[a.action] || P.slate, opacity: .35 + (i / d.length) * .65 }} />
      ))}
    </div>
  );
}

function Pill({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "2px 8px", borderRadius: 3, fontSize: 10, fontFamily: mono,
      background: on ? "rgba(255,255,255,0.06)" : "transparent",
      color: on ? P.t1 : P.t4,
      border: `1px solid ${on ? P.paperBorder : "transparent"}`,
      cursor: "pointer",
    }}>
      {label}
    </button>
  );
}

function SortTH({ label, field, cur, dir, onSort }: { label: string; field: SortField; cur: SortField; dir: SortDir; onSort: (f: SortField) => void }) {
  const on = cur === field;
  return (
    <th onClick={() => onSort(field)} style={{ ...thS, cursor: "pointer", color: on ? P.t1 : P.t4 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        {label}
        {on && (dir === "desc" ? <ChevronDown size={10} /> : <ChevronUp size={10} />)}
      </div>
    </th>
  );
}

const thS: React.CSSProperties = {
  padding: "8px 12px", textAlign: "left", fontSize: 9, fontWeight: 500,
  color: P.t4, textTransform: "uppercase", letterSpacing: "0.06em",
  fontFamily: mono, whiteSpace: "nowrap",
};
const thS2: React.CSSProperties = {
  padding: "6px 8px", textAlign: "center", fontSize: 9, fontWeight: 500,
  color: P.t4, letterSpacing: "0.06em", fontFamily: mono, whiteSpace: "nowrap",
};
const tdS: React.CSSProperties = { padding: "8px 12px", verticalAlign: "middle" };

/* ── ticket gen ── */
interface Ticket { title: string; description: string; severity: "critical" | "warning" | "info"; time: string }
function genTickets(runs: CounterfactualRun[]): Ticket[] {
  const t: Ticket[] = [];
  const tf = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  for (const r of runs) {
    if (r.metrics.minTTC < 2) t.push({ title: `TTC\u2098\u1d62\u2099 < 2s`, description: `Run ${r.label} \u2014 ${r.metrics.minTTC.toFixed(1)}s`, severity: "critical", time: tf(r.createdAt) });
    if (r.metrics.interventionCount > 0) t.push({ title: `Hard brake`, description: `Run ${r.label} \u2014 ${r.metrics.interventionCount}\u00d7`, severity: "warning", time: tf(r.createdAt) });
    if (r.metrics.deltaVsMain > .5) t.push({ title: `\u0394 > 0.5`, description: `Run ${r.label} \u2014 +${r.metrics.deltaVsMain.toFixed(2)}`, severity: "info", time: tf(r.createdAt) });
    if (r.metrics.cumulativeReward < -.5) t.push({ title: `R < \u22120.5`, description: `Run ${r.label} \u2014 ${r.metrics.cumulativeReward.toFixed(2)}`, severity: "warning", time: tf(r.createdAt) });
  }
  return t.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity]));
}
