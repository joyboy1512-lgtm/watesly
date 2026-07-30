import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AUTOMATION_TEMPLATES } from "../lib/automationTemplates";
import {
  getTemplateHeaderInfo,
  HEADER_FORMAT_LABELS,
  HEADER_MEDIA_ACCEPT,
  MEDIA_ACCEPT,
  mediaEndpointFromContentType,
  type TemplateComponent
} from "../lib/templateMedia";
import { uploadFile } from "../lib/uploads";
import { toastStore } from "../stores/toast";
import type { Automation, AutomationEdge, AutomationNode } from "../types/automation";

type Organization = { id: string; name: string };
type Tag = { id: string; name: string };
type Team = { id: string; name: string };
type WhatsAppAccount = { id: string; display_phone_number: string; verified_name: string | null };
type Template = { id: string; name: string; status: string; components: TemplateComponent[] | null };
type AutomationRun = {
  id: string;
  status: string;
  error_message: string | null;
  current_node_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

const TRIGGER_OPTIONS = [
  { value: "message_received", label: "عند وصول رسالة" },
  { value: "conversation_created", label: "عند محادثة جديدة" },
  { value: "conversation_assigned", label: "عند تحويل محادثة" },
  { value: "tag_added", label: "عند إضافة وسم" },
  { value: "manual", label: "تشغيل يدوي (تجربة)" }
] as const;

const TRIGGER_LABELS = Object.fromEntries(TRIGGER_OPTIONS.map((item) => [item.value, item.label]));

const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  active: "نشطة",
  paused: "موقوفة",
  archived: "مؤرشفة"
};

const RUN_STATUS_LABELS: Record<string, string> = {
  queued: "بالطابور",
  running: "قيد التشغيل",
  waiting: "انتظار مجدول",
  succeeded: "نجح",
  failed: "فشل",
  stopped: "متوقف"
};

type AutomationStats = {
  total_runs: number;
  by_status: Record<string, number>;
  success_rate: number;
  avg_duration_seconds: number | null;
  last_run_at: string | null;
};

const nodePalette = [
  ["condition", "شرط", "IF"],
  ["send_text", "إرسال رسالة", "TXT"],
  ["send_quick_reply", "رد سريع", "QR"],
  ["send_media", "إرسال وسائط", "MED"],
  ["send_template", "إرسال قالب", "TPL"],
  ["send_catalog", "رد من الكatalog", "CAT"],
  ["ai_reply", "رد ذكي", "AI"],
  ["create_deal", "إنشاء صفقة CRM", "CRM"],
  ["add_tag", "إضافة وسم", "TAG"],
  ["assign_team", "تحويل لفريق", "TEAM"],
  ["set_status", "تغيير الحالة", "STS"],
  ["delay", "انتظار", "WAIT"],
  ["webhook", "Webhook", "HTTP"],
  ["stop", "إيقاف", "STOP"]
] as const;

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultNodeData(type: string, label: string): Record<string, unknown> {
  switch (type) {
    case "condition":
      return { label, field: "trigger.text", operator: "contains", value: "" };
    case "send_text":
      return { label, text: "" };
    case "send_quick_reply":
      return { label, quick_reply_id: "" };
    case "send_media":
      return { label, media_type: "image", media_url: "", caption: "", filename: "" };
    case "send_template":
      return { label, template_id: "" };
    case "add_tag":
      return { label, tag_id: "" };
    case "assign_team":
      return { label, team_id: "" };
    case "set_status":
      return { label, status: "open" };
    case "delay":
      return { label, seconds: 2 };
    case "webhook":
      return { label, url: "" };
    case "send_catalog":
      return { label, auto_send: true };
    case "ai_reply":
      return { label, mode: "catalog_first", auto_send: true };
    case "create_deal":
      return { label, title: "فرصة من WhatsApp", stage: "lead", amount: "0" };
    default:
      return { label };
  }
}

export default function AutomationsPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("message_received");
  const [triggerKeywords, setTriggerKeywords] = useState("");
  const [triggerTagId, setTriggerTagId] = useState("");
  const [nodes, setNodes] = useState<AutomationNode[]>([]);
  const [edges, setEdges] = useState<AutomationEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState("أريد معرفة السعر");
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });
  const automations = useQuery({
    queryKey: ["automations"],
    queryFn: async () => (await api.get<Automation[]>("/automations")).data
  });
  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: async () => (await api.get<Tag[]>("/inbox-tools/tags")).data
  });
  const teams = useQuery({
    queryKey: ["assignment-teams"],
    queryFn: async () => (await api.get<Team[]>("/assignments/teams")).data
  });
  const accounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccount[]>("/whatsapp/accounts")).data
  });
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api.get<Template[]>("/templates")).data
  });
  const quickReplies = useQuery({
    queryKey: ["quick-replies"],
    queryFn: async () => (await api.get<Array<{ id: string; title: string; shortcut: string }>>("/inbox-tools/quick-replies")).data
  });
  const runs = useQuery({
    queryKey: ["automation-runs", selectedId],
    queryFn: async () => (await api.get<AutomationRun[]>(`/automations/${selectedId}/runs`)).data,
    enabled: Boolean(selectedId),
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      return rows.some((item) => item.status === "queued" || item.status === "running" || item.status === "waiting") ? 3000 : false;
    }
  });
  const stats = useQuery({
    queryKey: ["automation-stats", selectedId],
    queryFn: async () => (await api.get<AutomationStats>(`/automations/${selectedId}/stats`)).data,
    enabled: Boolean(selectedId)
  });

  const selectedAutomation = useMemo(
    () => (automations.data ?? []).find((item) => item.id === selectedId) ?? null,
    [automations.data, selectedId]
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const approvedTemplates = (templates.data ?? []).filter((item) => item.status === "approved");
  const selectedAutomationTemplate = useMemo(() => {
    if (selectedNode?.type !== "send_template") return null;
    const templateId = String(selectedNode.data.template_id ?? "");
    return approvedTemplates.find((item) => item.id === templateId) ?? null;
  }, [approvedTemplates, selectedNode]);
  const selectedTemplateHeader = useMemo(
    () => getTemplateHeaderInfo(selectedAutomationTemplate?.components),
    [selectedAutomationTemplate]
  );

  async function handleNodeMediaUpload(event: ChangeEvent<HTMLInputElement>, forTemplateHeader = false) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingMedia(true);
    try {
      const uploaded = await uploadFile(file);
      if (forTemplateHeader) {
        updateSelectedNode({ media_url: uploaded.public_url, filename: uploaded.filename });
      } else {
        const mediaType = mediaEndpointFromContentType(uploaded.content_type) ?? "image";
        updateSelectedNode({
          media_url: uploaded.public_url,
          media_type: mediaType,
          filename: uploaded.filename
        });
      }
      toastStore.getState().show("تم رفع الملف.", "success");
    } catch {
      toastStore.getState().show("تعذر رفع الملف.", "error");
      event.target.value = "";
    } finally {
      setUploadingMedia(false);
    }
  }

  function buildTriggerConfig() {
    const config: Record<string, unknown> = {};
    if (triggerKeywords.trim()) {
      config.keywords = triggerKeywords.split(",").map((item) => item.trim()).filter(Boolean);
    }
    if (triggerType === "tag_added" && triggerTagId) {
      config.tag_id = triggerTagId;
    }
    return config;
  }

  function syncTriggerNode(type: string) {
    setNodes((current) =>
      current.map((node) =>
        node.type === "trigger"
          ? { ...node, data: { ...node.data, label: TRIGGER_LABELS[type] ?? type } }
          : node
      )
    );
  }

  function loadAutomation(item: Automation) {
    setSelectedId(item.id);
    setOrganizationId(item.organization_id);
    setName(item.name);
    setTriggerType(item.trigger_type);
    const keywords = Array.isArray(item.trigger_config?.keywords)
      ? (item.trigger_config.keywords as string[]).join(", ")
      : "";
    setTriggerKeywords(keywords);
    setTriggerTagId(String(item.trigger_config?.tag_id ?? ""));
    setNodes(item.graph.nodes ?? []);
    setEdges(item.graph.edges ?? []);
    setSelectedNodeId(null);
  }

  function newAutomation(templateId?: string) {
    const template = AUTOMATION_TEMPLATES.find((item) => item.id === templateId);
    setSelectedId(null);
    setName(template?.name ?? "أتمتة جديدة");
    setTriggerType(template?.trigger_type ?? "message_received");
    const keywords = Array.isArray(template?.trigger_config?.keywords)
      ? (template.trigger_config.keywords as string[]).join(", ")
      : "";
    setTriggerKeywords(keywords);
    setTriggerTagId(String(template?.trigger_config?.tag_id ?? ""));
    setNodes(
      template?.graph.nodes ?? [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 80, y: 140 },
          data: { label: TRIGGER_LABELS.message_received }
        }
      ]
    );
    setEdges(template?.graph.edges ?? []);
    setSelectedNodeId(template?.graph.nodes?.[0]?.id ?? "trigger-1");
  }

  function addNode(type: string, label: string, conditionBranch?: "true" | "false") {
    const sourceNode = selectedNode ?? nodes[nodes.length - 1];
    const id = makeId(type);
    const node: AutomationNode = {
      id,
      type,
      position: {
        x: sourceNode ? sourceNode.position.x + 220 : 80,
        y: sourceNode ? sourceNode.position.y + (conditionBranch === "false" ? 120 : 0) : 140
      },
      data: defaultNodeData(type, label)
    };
    setNodes((current) => [...current, node]);
    if (sourceNode) {
      const edgeLabel =
        sourceNode.type === "condition" ? (conditionBranch ?? "true") : "next";
      setEdges((current) => [
        ...current.filter(
          (edge) =>
            !(sourceNode.type === "condition" && edge.source === sourceNode.id && (edge.label ?? edge.source_handle) === edgeLabel)
        ),
        {
          id: makeId("edge"),
          source: sourceNode.id,
          target: id,
          label: edgeLabel,
          source_handle: sourceNode.type === "condition" ? edgeLabel : undefined
        }
      ]);
    }
    setSelectedNodeId(id);
  }

  function updateSelectedNode(data: Record<string, unknown>) {
    if (!selectedNodeId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId ? { ...node, data: { ...node.data, ...data } } : node
      )
    );
  }

  async function save(event?: FormEvent): Promise<string | null> {
    event?.preventDefault();
    if (!organizationId || !name.trim()) {
      toastStore.getState().show("اختر الفرع واسم الأتمتة.", "error");
      return null;
    }
    const graph = { nodes, edges };
    const trigger_config = buildTriggerConfig();
    try {
      if (selectedId) {
        await api.patch(`/automations/${selectedId}`, {
          name,
          trigger_type: triggerType,
          trigger_config,
          graph
        });
        await client.invalidateQueries({ queryKey: ["automations"] });
        toastStore.getState().show("تم حفظ الأتمتة.", "success");
        return selectedId;
      }
      const response = await api.post<Automation>("/automations", {
          organization_id: organizationId,
          name,
          description: null,
          trigger_type: triggerType,
          trigger_config,
          graph
        });
      setSelectedId(response.data.id);
      await client.invalidateQueries({ queryKey: ["automations"] });
      toastStore.getState().show("تم حفظ الأتمتة.", "success");
      return response.data.id;
    } catch {
      toastStore.getState().show("تعذر حفظ الأتمتة.", "error");
      return null;
    }
  }

  async function publish() {
    try {
      const automationId = selectedId ?? (await save());
      if (!automationId) return;
      await api.post(`/automations/${automationId}/publish`);
      await client.invalidateQueries({ queryKey: ["automations"] });
      toastStore.getState().show("تم نشر الأتمتة — ستعمل على الأحداث الجديدة.", "success");
    } catch {
      toastStore.getState().show("تعذر النشر. تحقق من ربط العُقد ووجود محفّز واحد.", "error");
    }
  }

  async function pauseAutomation() {
    if (!selectedId) return;
    await api.post(`/automations/${selectedId}/pause`);
    await client.invalidateQueries({ queryKey: ["automations"] });
    toastStore.getState().show("تم إيقاف الأتمتة مؤقتاً.", "success");
  }

  async function testRun() {
    if (!selectedId || !organizationId) return;
    const account = accounts.data?.[0];
    try {
      await api.post(`/automations/${selectedId}/test`, {
        trigger_payload: {
          organization_id: organizationId,
          channel_id: organizationId,
          conversation_id: "00000000-0000-0000-0000-000000000001",
          contact_id: "00000000-0000-0000-0000-000000000002",
          whatsapp_account_id: account?.id ?? organizationId,
          from: "96550000000",
          text: testMessage
        }
      });
      await client.invalidateQueries({ queryKey: ["automation-runs", selectedId] });
      await client.invalidateQueries({ queryKey: ["automation-stats", selectedId] });
      toastStore.getState().show("بدأت تجربة الأتمتة — راجع سجل التشغيل.", "success");
    } catch {
      toastStore.getState().show("تعذر تشغيل التجربة.", "error");
    }
  }

  return (
    <main className="automation-page">
      <aside className="automation-list-panel">
        <div className="automation-list-header">
          <div>
            <span className="eyebrow">{t("eyebrow.automation")}</span>
            <h2>{t("pages.automations")}</h2>
          </div>
          <button type="button" className="icon-button" onClick={() => newAutomation()}>+</button>
        </div>

        <div className="automation-templates-block">
          <h3>قوالب جاهزة</h3>
          {AUTOMATION_TEMPLATES.map((item) => (
            <button key={item.id} type="button" className="automation-template-btn" onClick={() => newAutomation(item.id)}>
              <strong>{item.name}</strong>
              <small>{item.description}</small>
            </button>
          ))}
        </div>

        <div className="automation-list-scroll">
          {(automations.data ?? []).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`automation-list-item ${selectedId === item.id ? "active" : ""}`}
              onClick={() => loadAutomation(item)}
            >
              <strong>{item.name}</strong>
              <span>{TRIGGER_LABELS[item.trigger_type] ?? item.trigger_type}</span>
              <small>{STATUS_LABELS[item.status] ?? item.status} · v{item.version}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="automation-builder">
        <header className="automation-toolbar">
          <div className="automation-name-block">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="اسم الأتمتة" />
            <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
              <option value="">اختر الفرع</option>
              {(organizations.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <select
              value={triggerType}
              onChange={(event) => {
                setTriggerType(event.target.value);
                syncTriggerNode(event.target.value);
              }}
            >
              {TRIGGER_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="automation-toolbar-actions">
            <button type="button" className="secondary-action compact" onClick={() => void save()}>حفظ</button>
            <button type="button" className="secondary-action compact" onClick={() => void testRun()} disabled={!selectedId}>تجربة</button>
            <button type="button" className="secondary-action compact" onClick={() => void pauseAutomation()} disabled={!selectedId}>إيقاف</button>
            <button type="button" className="primary-action compact green" onClick={() => void publish()}>نشر</button>
          </div>
        </header>

        <div className="automation-trigger-config card">
          <label className="field-label">
            <span>كلمات مفتاحية (اختياري — مفصولة بفاصلة)</span>
            <input
              value={triggerKeywords}
              onChange={(event) => setTriggerKeywords(event.target.value)}
              placeholder="سعر, طلب, price"
            />
          </label>
          {triggerType === "tag_added" && (
            <label className="field-label">
              <span>عند إضافة الوسم</span>
              <select value={triggerTagId} onChange={(event) => setTriggerTagId(event.target.value)}>
                <option value="">أي وسم</option>
                {(tags.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="field-label">
            <span>رسالة التجربة</span>
            <input value={testMessage} onChange={(event) => setTestMessage(event.target.value)} />
          </label>
        </div>

        <div className="automation-workspace">
          <aside className="node-palette">
            <h3>العُقد</h3>
            {nodePalette.map(([type, label, badge]) => (
              <button key={type} type="button" onClick={() => addNode(type, label)}>
                <span>{badge}</span>
                <strong>{label}</strong>
              </button>
            ))}
            {selectedNode?.type === "condition" && (
              <div className="condition-branch-actions">
                <p className="hint-text">فروع الشرط:</p>
                <button type="button" className="secondary-button" onClick={() => addNode("send_text", "رد (نعم)", "true")}>+ نعم</button>
                <button type="button" className="secondary-button" onClick={() => addNode("stop", "تخطي (لا)", "false")}>+ لا</button>
              </div>
            )}
          </aside>

          <div className="automation-canvas">
            <div className="automation-grid">
              {nodes.map((node, index) => (
                <div
                  key={node.id}
                  className={`flow-node type-${node.type} ${selectedNodeId === node.id ? "selected" : ""}`}
                  style={{ left: node.position.x, top: node.position.y }}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <small>{node.type}</small>
                  <strong>{String(node.data.label ?? node.type)}</strong>
                  {index < nodes.length - 1 && <span className="node-connector">→</span>}
                </div>
              ))}
            </div>
          </div>

          <aside className="node-inspector">
            <h3>إعدادات العقدة</h3>
            {!selectedNode && <p className="hint-text">اختر عقدة لتعديل إعداداتها.</p>}
            {selectedNode && (
              <div className="stack-form">
                <label className="field-label">
                  <span>العنوان</span>
                  <input
                    value={String(selectedNode.data.label ?? "")}
                    onChange={(event) => updateSelectedNode({ label: event.target.value })}
                  />
                </label>

                {selectedNode.type === "condition" && (
                  <>
                    <label className="field-label">
                      <span>الحقل</span>
                      <select
                        value={String(selectedNode.data.field ?? "trigger.text")}
                        onChange={(event) => updateSelectedNode({ field: event.target.value })}
                      >
                        <option value="trigger.text">نص الرسالة</option>
                        <option value="trigger.from">رقم المرسل</option>
                        <option value="trigger.message_type">نوع الرسالة</option>
                      </select>
                    </label>
                    <label className="field-label">
                      <span>المقارنة</span>
                      <select
                        value={String(selectedNode.data.operator ?? "contains")}
                        onChange={(event) => updateSelectedNode({ operator: event.target.value })}
                      >
                        <option value="contains">يحتوي</option>
                        <option value="equals">يساوي</option>
                        <option value="not_equals">لا يساوي</option>
                        <option value="starts_with">يبدأ بـ</option>
                        <option value="exists">موجود</option>
                      </select>
                    </label>
                    <label className="field-label">
                      <span>القيمة</span>
                      <input
                        value={String(selectedNode.data.value ?? "")}
                        onChange={(event) => updateSelectedNode({ value: event.target.value })}
                      />
                    </label>
                  </>
                )}

                {selectedNode.type === "send_text" && (
                  <label className="field-label">
                    <span>نص الرسالة</span>
                    <textarea
                      value={String(selectedNode.data.text ?? "")}
                      onChange={(event) => updateSelectedNode({ text: event.target.value })}
                      placeholder="مرحباً، هذه رسالة آلية..."
                    />
                  </label>
                )}

                {selectedNode.type === "send_quick_reply" && (
                  <label className="field-label">
                    <span>الرد السريع</span>
                    <select
                      value={String(selectedNode.data.quick_reply_id ?? "")}
                      onChange={(event) => updateSelectedNode({ quick_reply_id: event.target.value })}
                    >
                      <option value="">اختر الرد السريع</option>
                      {(quickReplies.data ?? []).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title} ({item.shortcut})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {selectedNode.type === "send_media" && (
                  <>
                    <label className="field-label">
                      <span>نوع الوسائط</span>
                      <select
                        value={String(selectedNode.data.media_type ?? "image")}
                        onChange={(event) => updateSelectedNode({ media_type: event.target.value })}
                      >
                        <option value="image">صورة</option>
                        <option value="video">فيديو</option>
                        <option value="audio">صوت</option>
                        <option value="document">PDF / مستند</option>
                      </select>
                    </label>
                    <label className="field-label">
                      <span>رفع ملف</span>
                      <input
                        type="file"
                        accept={MEDIA_ACCEPT}
                        disabled={uploadingMedia}
                        onChange={(e) => void handleNodeMediaUpload(e)}
                      />
                      {String(selectedNode.data.media_url ?? "").trim() !== "" && (
                        <p className="hint-text">✓ {String(selectedNode.data.filename ?? "ملف مرفوع")}</p>
                      )}
                    </label>
                    <label className="field-label">
                      <span>رابط الملف (بديل)</span>
                      <input
                        value={String(selectedNode.data.media_url ?? "")}
                        onChange={(event) => updateSelectedNode({ media_url: event.target.value })}
                        placeholder="https://..."
                        dir="ltr"
                      />
                    </label>
                    <label className="field-label">
                      <span>تعليق (اختياري)</span>
                      <textarea
                        value={String(selectedNode.data.caption ?? "")}
                        onChange={(event) => updateSelectedNode({ caption: event.target.value })}
                      />
                    </label>
                    {String(selectedNode.data.media_type ?? "") === "document" && (
                      <label className="field-label">
                        <span>اسم الملف</span>
                        <input
                          value={String(selectedNode.data.filename ?? "")}
                          onChange={(event) => updateSelectedNode({ filename: event.target.value })}
                          placeholder="catalog.pdf"
                          dir="ltr"
                        />
                      </label>
                    )}
                  </>
                )}

                {selectedNode.type === "send_template" && (
                  <>
                    <label className="field-label">
                      <span>القالب المعتمد</span>
                      <select
                        value={String(selectedNode.data.template_id ?? "")}
                        onChange={(event) =>
                          updateSelectedNode({ template_id: event.target.value, media_url: "", filename: "" })
                        }
                      >
                        <option value="">اختر القالب</option>
                        {approvedTemplates.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    </label>
                    {selectedTemplateHeader && (
                      <>
                        <p className="hint-text">
                          القالب يتضمن رأس {HEADER_FORMAT_LABELS[selectedTemplateHeader.format]}
                          {!selectedTemplateHeader.mediaUrl ? " — ارفع الملف." : " — يمكن استبدال الملف."}
                        </p>
                        <label className="field-label">
                          <span>ملف رأس القالب</span>
                          <input
                            type="file"
                            accept={HEADER_MEDIA_ACCEPT}
                            disabled={uploadingMedia}
                            onChange={(e) => void handleNodeMediaUpload(e, true)}
                          />
                        </label>
                      </>
                    )}
                  </>
                )}

                {selectedNode.type === "add_tag" && (
                  <label className="field-label">
                    <span>الوسم</span>
                    <select
                      value={String(selectedNode.data.tag_id ?? "")}
                      onChange={(event) => updateSelectedNode({ tag_id: event.target.value })}
                    >
                      <option value="">اختر الوسم</option>
                      {(tags.data ?? []).map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                )}

                {selectedNode.type === "assign_team" && (
                  <label className="field-label">
                    <span>الفريق</span>
                    <select
                      value={String(selectedNode.data.team_id ?? "")}
                      onChange={(event) => updateSelectedNode({ team_id: event.target.value })}
                    >
                      <option value="">اختر الفريق</option>
                      {(teams.data ?? []).map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                )}

                {selectedNode.type === "set_status" && (
                  <label className="field-label">
                    <span>الحالة</span>
                    <select
                      value={String(selectedNode.data.status ?? "open")}
                      onChange={(event) => updateSelectedNode({ status: event.target.value })}
                    >
                      <option value="open">مفتوحة</option>
                      <option value="pending">معلّقة</option>
                      <option value="closed">مغلقة</option>
                    </select>
                  </label>
                )}

                {selectedNode.type === "delay" && (
                  <>
                    <label className="field-label">
                      <span>عدد الثواني (حتى 30 فوري)</span>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={Number(selectedNode.data.seconds ?? 0)}
                        onChange={(event) => updateSelectedNode({ seconds: Number(event.target.value) })}
                      />
                    </label>
                    <label className="field-label">
                      <span>عدد الدقائق (يُجدول تلقائياً)</span>
                      <input
                        type="number"
                        min="0"
                        max="1440"
                        value={Number(selectedNode.data.minutes ?? 0)}
                        onChange={(event) => updateSelectedNode({ minutes: Number(event.target.value) })}
                      />
                    </label>
                  </>
                )}

                {selectedNode.type === "send_catalog" && (
                  <>
                    <label className="field-label checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedNode.data.auto_send !== false}
                        onChange={(event) => updateSelectedNode({ auto_send: event.target.checked })}
                      />
                      <span>إرسال الرد تلقائياً على WhatsApp</span>
                    </label>
                    <p className="hint-text">يستخدم نص رسالة العميل للبحث في الكatalog.</p>
                  </>
                )}

                {selectedNode.type === "ai_reply" && (
                  <>
                    <label className="field-label">
                      <span>نوع الرد</span>
                      <select
                        value={String(selectedNode.data.mode ?? "kb_first")}
                        onChange={(event) => updateSelectedNode({ mode: event.target.value })}
                      >
                        <option value="kb_first">قاعدة المعرفة أولاً</option>
                        <option value="catalog_first">كتalog أولاً</option>
                        <option value="combined">مدمج (KB + منتجات)</option>
                        <option value="local">رد محلي فقط</option>
                      </select>
                    </label>
                    <label className="field-label checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedNode.data.auto_send !== false}
                        onChange={(event) => updateSelectedNode({ auto_send: event.target.checked })}
                      />
                      <span>إرسال الرد تلقائياً</span>
                    </label>
                  </>
                )}

                {selectedNode.type === "create_deal" && (
                  <>
                    <label className="field-label">
                      <span>عنوان الصفقة</span>
                      <input
                        value={String(selectedNode.data.title ?? "")}
                        onChange={(event) => updateSelectedNode({ title: event.target.value })}
                      />
                    </label>
                    <label className="field-label">
                      <span>المرحلة</span>
                      <select
                        value={String(selectedNode.data.stage ?? "lead")}
                        onChange={(event) => updateSelectedNode({ stage: event.target.value })}
                      >
                        <option value="lead">Lead</option>
                        <option value="qualified">Qualified</option>
                        <option value="proposal">Proposal</option>
                        <option value="won">Won</option>
                      </select>
                    </label>
                    <label className="field-label">
                      <span>المبلغ</span>
                      <input
                        type="number"
                        min="0"
                        value={String(selectedNode.data.amount ?? "0")}
                        onChange={(event) => updateSelectedNode({ amount: event.target.value })}
                      />
                    </label>
                  </>
                )}

                {selectedNode.type === "webhook" && (
                  <label className="field-label">
                    <span>رابط HTTPS</span>
                    <input
                      value={String(selectedNode.data.url ?? "")}
                      onChange={(event) => updateSelectedNode({ url: event.target.value })}
                      placeholder="https://example.com/hook"
                      dir="ltr"
                    />
                  </label>
                )}
              </div>
            )}
          </aside>
        </div>

        {selectedId && (
          <section className="automation-runs-panel card">
            <h3 className="section-title-sm">إحصائيات التشغيل</h3>
            {stats.data && (
              <div className="stats-grid automation-stats-grid">
                <article className="metric-card"><span>إجمالي</span><strong>{stats.data.total_runs}</strong></article>
                <article className="metric-card"><span>نجاح</span><strong>{stats.data.success_rate}%</strong></article>
                <article className="metric-card"><span>متوسط (ث)</span><strong>{stats.data.avg_duration_seconds ?? "—"}</strong></article>
                <article className="metric-card"><span>فشل</span><strong>{stats.data.by_status.failed ?? 0}</strong></article>
              </div>
            )}
            <h3 className="section-title-sm">سجل التشغيل</h3>
            {!runs.data?.length && <p className="hint-text">لا توجد عمليات تشغيل بعد.</p>}
            {!!runs.data?.length && (
              <div className="table-card">
                <table>
                  <thead>
                    <tr><th>الحالة</th><th>بدأ</th><th>انتهى</th><th>الخطأ</th></tr>
                  </thead>
                  <tbody>
                    {runs.data.map((item) => (
                      <tr key={item.id}>
                        <td>{RUN_STATUS_LABELS[item.status] ?? item.status}</td>
                        <td>{item.started_at ? new Date(item.started_at).toLocaleString("ar") : "—"}</td>
                        <td>{item.finished_at ? new Date(item.finished_at).toLocaleString("ar") : "—"}</td>
                        <td>{item.error_message || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
