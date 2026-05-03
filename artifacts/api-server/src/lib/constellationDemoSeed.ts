// Server-side mirror of artifacts/synozur/src/data/constellation-demo-seed.ts.
// The two files are intentionally duplicated rather than shared via a lib —
// the synozur app is a leaf workspace package that doesn't import from
// `@workspace/api-server`, and creating a new lib for one fixture is more
// machinery than the value warrants. If a second demo seed lands, promote
// this to a `@workspace/demos` lib in one step.

export const CONSTELLATION_DEMO_SEED_ID = "anomaly-bank-2026q1" as const;

export interface DemoDeliverable {
  id: string;
  name: string;
  owner: string;
  dueOn: string;
  status: "on_track" | "at_risk" | "slipping" | "complete";
  percentComplete: number;
  notes?: string;
}

export interface DemoRisk {
  id: string;
  title: string;
  severity: "low" | "medium" | "high";
  trend: "improving" | "stable" | "worsening";
  surfacedOn: string;
  impactedDeliverableIds: string[];
  rationale: string;
  recommendation: string;
}

export interface DemoFinancials {
  contractValue: number;
  burnedToDate: number;
  forecastAtComplete: number;
  marginPct: number;
}

export interface DemoSeed {
  id: typeof CONSTELLATION_DEMO_SEED_ID;
  client: { name: string; industry: string; region: string };
  engagement: {
    name: string;
    phase: string;
    startedOn: string;
    targetEndOn: string;
    leadConsultant: string;
    executiveSponsor: string;
  };
  weekOf: string;
  deliverables: DemoDeliverable[];
  risks: DemoRisk[];
  financials: DemoFinancials;
  recentEvents: Array<{ ts: string; summary: string }>;
}

export const CONSTELLATION_DEMO_SEED_FIXTURE: DemoSeed = {
  id: CONSTELLATION_DEMO_SEED_ID,
  client: {
    name: "Anomaly Bank",
    industry: "Regional Banking",
    region: "North America",
  },
  engagement: {
    name: "AI-Augmented Underwriting Modernization",
    phase: "Build — Sprint 4 of 8",
    startedOn: "2026-02-02",
    targetEndOn: "2026-06-19",
    leadConsultant: "Priya Raman",
    executiveSponsor: "Marcus Chen, EVP Operations",
  },
  weekOf: "2026-04-27",
  deliverables: [
    { id: "d-disc", name: "Discovery synthesis & target-state blueprint", owner: "Priya Raman", dueOn: "2026-03-13", status: "complete", percentComplete: 100 },
    { id: "d-data", name: "Underwriting data model v1", owner: "Theo Park", dueOn: "2026-04-17", status: "complete", percentComplete: 100 },
    { id: "d-mlops", name: "Model training pipeline (Azure ML)", owner: "Alina Voss", dueOn: "2026-05-08", status: "on_track", percentComplete: 72 },
    {
      id: "d-copilot",
      name: "Underwriter Copilot UX prototype",
      owner: "Jordan Mireles",
      dueOn: "2026-05-15",
      status: "slipping",
      percentComplete: 41,
      notes: "Stakeholder review pulled forward; two of three personas still pending sign-off from Risk.",
    },
    {
      id: "d-gov",
      name: "Model governance & audit playbook",
      owner: "Priya Raman",
      dueOn: "2026-05-29",
      status: "at_risk",
      percentComplete: 28,
      notes: "Awaiting regulatory counsel response on adverse-action disclosure language.",
    },
    { id: "d-rollout", name: "Pilot rollout plan & enablement", owner: "Marcus Chen", dueOn: "2026-06-12", status: "on_track", percentComplete: 15 },
  ],
  risks: [
    {
      id: "r-copilot-slip",
      title: "Underwriter Copilot prototype slipping by ~6 business days",
      severity: "high",
      trend: "worsening",
      surfacedOn: "2026-04-29",
      impactedDeliverableIds: ["d-copilot", "d-rollout"],
      rationale:
        "Velocity over the last two sprints has trended down 22%. The remaining persona reviews depend on Risk department availability, which has not been confirmed for the next two weeks. If the prototype slips past 5/22, the pilot rollout enablement window collapses below the agreed-on two weeks.",
      recommendation:
        "Move the Risk persona review forward by carving a 90-minute working session this week with the Risk lead and Jordan; pre-circulate the two open decision points so the meeting is decision-only.",
    },
    {
      id: "r-gov-counsel",
      title: "Model governance playbook blocked on regulatory counsel response",
      severity: "medium",
      trend: "stable",
      surfacedOn: "2026-04-22",
      impactedDeliverableIds: ["d-gov"],
      rationale:
        "External counsel was engaged 11 business days ago on adverse-action disclosure language. SLA was 7 business days. No second-touch has been logged.",
      recommendation:
        "Escalate to executive sponsor for a direct nudge; in parallel, draft the disclosure language internally so the playbook can ship contingent on counsel review rather than blocked by it.",
    },
    {
      id: "r-data-drift",
      title: "Training data drift detected on two underwriting features",
      severity: "low",
      trend: "improving",
      surfacedOn: "2026-04-30",
      impactedDeliverableIds: ["d-mlops"],
      rationale:
        "Two features show a >0.15 PSI shift between the v0 baseline and the most recent week. Within tolerance for the build phase but worth flagging before pilot.",
      recommendation:
        "Add a drift-monitor dashboard to the MLOps pipeline now so we have a baseline before pilot; no schedule impact.",
    },
  ],
  financials: {
    contractValue: 1_480_000,
    burnedToDate: 612_000,
    forecastAtComplete: 1_502_000,
    marginPct: 31.4,
  },
  recentEvents: [
    { ts: "2026-04-29T16:42:00Z", summary: "Constellation auto-detected the velocity drop on the Copilot deliverable." },
    { ts: "2026-04-28T13:10:00Z", summary: "Theo closed out the underwriting data model v1." },
    { ts: "2026-04-25T09:00:00Z", summary: "Weekly steering committee — minutes auto-summarized." },
    { ts: "2026-04-22T11:18:00Z", summary: "External counsel review elapsed beyond SLA — risk raised." },
  ],
};
