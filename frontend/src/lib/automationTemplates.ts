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
    description: "رسالة ترحيب عند بدء محادثة جديدة.",
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
            label: "رسالة ترحيب",
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
    name: "رد بالمنتجات من الكتالوج",
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
          data: { label: "رد الكتالوج", auto_send: true }
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
  },
  {
    id: "offer-follow-up",
    name: "متابعة عرض لم يُحجز",
    description:
      "عند انتقال العميل لمرحلة proposal: انتظر 24 ساعة ثم أرسل قالب متابعة. عند won/lost/customer تتوقف المتابعات المفتوحة تلقائياً. اختر قالب واتساب المعتمد.",
    trigger_type: "lifecycle_changed",
    trigger_config: { lifecycle_stage: "proposal" },
    graph: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 160 }, data: { label: "مرحلة: أُرسل العرض" } },
        {
          id: "delay-1",
          type: "delay",
          position: { x: 300, y: 160 },
          data: { label: "انتظار 24 ساعة", seconds: 0, minutes: 1440 }
        },
        {
          id: "tpl-1",
          type: "send_template",
          position: { x: 520, y: 160 },
          data: { label: "قالب متابعة العرض", template_id: "" }
        }
      ],
      edges: [
        { id: "edge-1", source: "trigger-1", target: "delay-1", label: "next" },
        { id: "edge-2", source: "delay-1", target: "tpl-1", label: "next" }
      ]
    }
  },
  {
    id: "campaign-cta-route",
    name: "توجيه رد حملة (زر)",
    description:
      "عند ضغط زر في رسالة حملة: يرد نصاً موجزاً ثم يعيّن فريقاً/موظفاً. عدّل button_id ليطابق زر القالب، واختر الفريق في عقدة التعيين.",
    trigger_type: "button_clicked",
    trigger_config: { button_id: "send_details" },
    graph: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 160 }, data: { label: "ضغط زر الحملة" } },
        {
          id: "send-1",
          type: "send_text",
          position: { x: 300, y: 100 },
          data: {
            label: "رد أولي",
            text: "شكراً لاهتمامك بالعرض! سيكمل معك فريق المبيعات التفاصيل الآن."
          }
        },
        {
          id: "assign-1",
          type: "assign_team",
          position: { x: 520, y: 100 },
          data: { label: "تعيين فريق المبيعات", team_id: "" }
        }
      ],
      edges: [
        { id: "edge-1", source: "trigger-1", target: "send-1", label: "next" },
        { id: "edge-2", source: "send-1", target: "assign-1", label: "next" }
      ]
    }
  },
  {
    id: "campaign-cta-interested",
    name: "حملة — مهتم",
    description:
      "زر interested: رد ترحيبي + تعيين فريق المبيعات + مرحلة qualified. طابق button_id مع زر القالب.",
    trigger_type: "button_clicked",
    trigger_config: { button_id: "interested" },
    graph: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 160 }, data: { label: "زر: مهتم" } },
        {
          id: "send-1",
          type: "send_text",
          position: { x: 300, y: 100 },
          data: {
            label: "رد الاهتمام",
            text: "رائع! شكراً لاهتمامك. سيتواصل معك فريق المبيعات خلال دقائق لإكمال التفاصيل."
          }
        },
        {
          id: "life-1",
          type: "set_lifecycle",
          position: { x: 520, y: 60 },
          data: { label: "مرحلة مؤهّل", lifecycle_stage: "qualified" }
        },
        {
          id: "assign-1",
          type: "assign_team",
          position: { x: 520, y: 200 },
          data: { label: "تعيين المبيعات", team_id: "" }
        }
      ],
      edges: [
        { id: "edge-1", source: "trigger-1", target: "send-1", label: "next" },
        { id: "edge-2", source: "send-1", target: "life-1", label: "next" },
        { id: "edge-3", source: "life-1", target: "assign-1", label: "next" }
      ]
    }
  },
  {
    id: "campaign-cta-human",
    name: "حملة — أبي موظف",
    description:
      "زر talk_to_agent: رد قصير ثم تحويل لفريق بشري. عدّل button_id والفريق حسب قالبك.",
    trigger_type: "button_clicked",
    trigger_config: { button_id: "talk_to_agent" },
    graph: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 160 }, data: { label: "زر: أبي موظف" } },
        {
          id: "send-1",
          type: "send_text",
          position: { x: 300, y: 160 },
          data: {
            label: "رد التحويل",
            text: "حاضر، سأحوّلك الآن لأحد زملائنا للمتابعة معك مباشرة."
          }
        },
        {
          id: "assign-1",
          type: "assign_team",
          position: { x: 520, y: 160 },
          data: { label: "تحويل لموظف", team_id: "" }
        }
      ],
      edges: [
        { id: "edge-1", source: "trigger-1", target: "send-1", label: "next" },
        { id: "edge-2", source: "send-1", target: "assign-1", label: "next" }
      ]
    }
  },
  {
    id: "campaign-cta-stop",
    name: "حملة — إيقاف / لا أريد",
    description:
      "زر stop: تأكيد الإيقاف + نقل Lifecycle إلى lost. طابق button_id مع زر الإلغاء في القالب.",
    trigger_type: "button_clicked",
    trigger_config: { button_id: "stop" },
    graph: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 160 }, data: { label: "زر: إيقاف" } },
        {
          id: "send-1",
          type: "send_text",
          position: { x: 300, y: 100 },
          data: {
            label: "تأكيد الإيقاف",
            text: "تم، لن نرسل عروضاً ترويجية إضافية. يمكنك مراسلتنا في أي وقت عند الحاجة."
          }
        },
        {
          id: "life-1",
          type: "set_lifecycle",
          position: { x: 520, y: 100 },
          data: { label: "مرحلة lost", lifecycle_stage: "lost" }
        }
      ],
      edges: [
        { id: "edge-1", source: "trigger-1", target: "send-1", label: "next" },
        { id: "edge-2", source: "send-1", target: "life-1", label: "next" }
      ]
    }
  },
  {
    id: "csat-after-close",
    name: "تقييم بعد إغلاق المحادثة",
    description:
      "عند إغلاق المحادثة يُرسل سؤال تقييم (1–5). رد العميل الرقمي يُحفظ تلقائياً عبر مسار CSAT الحالي.",
    trigger_type: "conversation_closed",
    trigger_config: {},
    graph: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 80, y: 160 }, data: { label: "إغلاق محادثة" } },
        {
          id: "send-1",
          type: "send_text",
          position: { x: 300, y: 160 },
          data: {
            label: "سؤال التقييم",
            text: "من 1 إلى 5، كيف تقيّم مساعدتنا اليوم؟ أرسل الرقم فقط."
          }
        }
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "send-1", label: "next" }]
    }
  }
];
