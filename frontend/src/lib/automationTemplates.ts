import type { AutomationEdge, AutomationNode } from "../types/automation";

export type AutomationTemplate = {
  id: string;
  name: string;
  description: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  graph: {
    nodes: AutomationNode[];
    edges: AutomationEdge[];
  };
};

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "welcome",
    name: "ترحيب تلقائي",
    description: "رسالة ترحib عند بدء محادثة جديدة.",
    trigger_type: "conversation_created",
    trigger_config: {},
    graph: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 140 }, data: { label: "محادثة جديدة" } },
        {
          id: "send-1",
          type: "send_text",
          position: { x: 300, y: 140 },
          data: {
            label: "رسالة ترحib",
            text: "مرحباً بك! شكراً لتواصلك معنا. كيف يمكننا مساعدتك؟"
          }
        }
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "send-1", label: "next" }]
    }
  },
  {
    id: "keyword-sales",
    name: "توجيه طلبات السعر",
    description: "إذا ذكر العميل «سعر» أو «طلب» يُرسل رداً ويُضاف وسم.",
    trigger_type: "message_received",
    trigger_config: { keywords: ["سعر", "طلب", "price"] },
    graph: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 140 }, data: { label: "رسالة واردة" } },
        {
          id: "cond-1",
          type: "condition",
          position: { x: 300, y: 140 },
          data: { label: "هل يسأل عن السعر؟", field: "trigger.text", operator: "contains", value: "سعر" }
        },
        {
          id: "send-1",
          type: "send_text",
          position: { x: 520, y: 80 },
          data: {
            label: "رد المبيعات",
            text: "شكراً لاهتمامك! سيتواصل معك فريق المبيعات قريباً."
          }
        },
        { id: "stop-1", type: "stop", position: { x: 520, y: 220 }, data: { label: "لا شيء" } }
      ],
      edges: [
        { id: "edge-1", source: "trigger-1", target: "cond-1", label: "next" },
        { id: "edge-2", source: "cond-1", target: "send-1", label: "true", source_handle: "true" },
        { id: "edge-3", source: "cond-1", target: "stop-1", label: "false", source_handle: "false" }
      ]
    }
  },
  {
    id: "after-hours",
    name: "خارج أوقات العمل",
    description: "رد تلقائي يُفيد العميل أن الفريق خارج أوقات الدوام.",
    trigger_type: "message_received",
    trigger_config: {},
    graph: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 140 }, data: { label: "رسالة واردة" } },
        {
          id: "send-1",
          type: "send_text",
          position: { x: 300, y: 140 },
          data: {
            label: "خارج الدوام",
            text: "شكراً لرسالتك. نحن خارج أوقات العمل حالياً (9ص–5م). سنرد عليك في أقرب وقت."
          }
        }
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "send-1", label: "next" }]
    }
  },
  {
    id: "catalog-reply",
    name: "رد بالمنتجات من الكatalog",
    description: "يرسل قائمة منتجات/أسعار تلقائياً عند سؤال العميل.",
    trigger_type: "message_received",
    trigger_config: { keywords: ["سعر", "منتج", "قائمة", "price", "menu"] },
    graph: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 140 }, data: { label: "رسالة واردة" } },
        {
          id: "catalog-1",
          type: "send_catalog",
          position: { x: 300, y: 140 },
          data: { label: "رد الكatalog", auto_send: true }
        }
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "catalog-1", label: "next" }]
    }
  },
  {
    id: "purchase-deal",
    name: "إنشاء صفقة عند نية الشراء",
    description: "عند كلمات شراء/طلب ينشئ صفقة CRM تلقائياً.",
    trigger_type: "message_received",
    trigger_config: { keywords: ["شراء", "طلب", "buy", "order"] },
    graph: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 140 }, data: { label: "رسالة واردة" } },
        {
          id: "deal-1",
          type: "create_deal",
          position: { x: 300, y: 140 },
          data: { label: "صفقة جديدة", title: "طلب من WhatsApp", stage: "lead", amount: "0" }
        },
        {
          id: "reply-1",
          type: "ai_reply",
          position: { x: 520, y: 140 },
          data: { label: "رد ذكي", mode: "catalog_first", auto_send: true }
        }
      ],
      edges: [
        { id: "edge-1", source: "trigger-1", target: "deal-1", label: "next" },
        { id: "edge-2", source: "deal-1", target: "reply-1", label: "next" }
      ]
    }
  },
  {
    id: "follow-up-template",
    name: "متابعة بقالب (خارج النافذة)",
    description: "يرسل قالب WhatsApp معتمد — مناسب عند انتهاء نافذة 24 ساعة.",
    trigger_type: "manual",
    trigger_config: {},
    graph: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 140 }, data: { label: "تشغيل يدوي" } },
        {
          id: "tpl-1",
          type: "send_template",
          position: { x: 300, y: 140 },
          data: { label: "قالب متابعة", template_id: "" }
        }
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "tpl-1", label: "next" }]
    }
  }
];
