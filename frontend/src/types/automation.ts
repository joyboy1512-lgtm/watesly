export type AutomationNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

export type AutomationEdge = {
  id: string;
  source: string;
  target: string;
  source_handle?: string | null;
  target_handle?: string | null;
  label?: string | null;
};

export type Automation = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused" | "archived";
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  graph: {
    nodes: AutomationNode[];
    edges: AutomationEdge[];
  };
  version: number;
  created_at: string;
  updated_at: string;
};
