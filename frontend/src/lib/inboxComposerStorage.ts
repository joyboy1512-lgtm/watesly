const EMOJI_KEY = "watesly:inbox-emoji-recent";
const BUTTON_TEMPLATES_KEY = "watesly:inbox-button-templates";
const LIST_TEMPLATES_KEY = "watesly:inbox-list-templates";
const FLOW_PRESETS_KEY = "watesly:inbox-flow-presets";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

export function loadRecentEmojis(limit = 12): string[] {
  return readJson<string[]>(EMOJI_KEY, []).slice(0, limit);
}

export function pushRecentEmoji(emoji: string, limit = 12): string[] {
  const next = [emoji, ...loadRecentEmojis(limit).filter((item) => item !== emoji)].slice(0, limit);
  writeJson(EMOJI_KEY, next);
  return next;
}

export type ButtonTemplate = {
  id: string;
  name: string;
  body: string;
  titles: string;
};

export function loadButtonTemplates(): ButtonTemplate[] {
  return readJson<ButtonTemplate[]>(BUTTON_TEMPLATES_KEY, []);
}

export function saveButtonTemplate(template: Omit<ButtonTemplate, "id"> & { id?: string }): ButtonTemplate[] {
  const current = loadButtonTemplates();
  const id = template.id || `btn_${Date.now()}`;
  const next = [{ id, name: template.name, body: template.body, titles: template.titles }, ...current.filter((item) => item.id !== id)].slice(0, 20);
  writeJson(BUTTON_TEMPLATES_KEY, next);
  return next;
}

export function deleteButtonTemplate(id: string): ButtonTemplate[] {
  const next = loadButtonTemplates().filter((item) => item.id !== id);
  writeJson(BUTTON_TEMPLATES_KEY, next);
  return next;
}

export type ListSectionDraft = {
  title: string;
  rowsText: string;
};

export type ListTemplate = {
  id: string;
  name: string;
  body: string;
  buttonText: string;
  sections: ListSectionDraft[];
};

export function loadListTemplates(): ListTemplate[] {
  return readJson<ListTemplate[]>(LIST_TEMPLATES_KEY, []);
}

export function saveListTemplate(template: Omit<ListTemplate, "id"> & { id?: string }): ListTemplate[] {
  const current = loadListTemplates();
  const id = template.id || `list_${Date.now()}`;
  const next = [
    {
      id,
      name: template.name,
      body: template.body,
      buttonText: template.buttonText,
      sections: template.sections
    },
    ...current.filter((item) => item.id !== id)
  ].slice(0, 20);
  writeJson(LIST_TEMPLATES_KEY, next);
  return next;
}

export function deleteListTemplate(id: string): ListTemplate[] {
  const next = loadListTemplates().filter((item) => item.id !== id);
  writeJson(LIST_TEMPLATES_KEY, next);
  return next;
}

export type FlowPreset = {
  id: string;
  name: string;
  flowId: string;
  flowCta: string;
  bodyText: string;
  headerText: string;
  footerText: string;
};

export function loadFlowPresets(): FlowPreset[] {
  return readJson<FlowPreset[]>(FLOW_PRESETS_KEY, []);
}

export function saveFlowPreset(preset: Omit<FlowPreset, "id"> & { id?: string }): FlowPreset[] {
  const current = loadFlowPresets();
  const id = preset.id || `flow_${Date.now()}`;
  const next = [
    {
      id,
      name: preset.name,
      flowId: preset.flowId,
      flowCta: preset.flowCta,
      bodyText: preset.bodyText,
      headerText: preset.headerText,
      footerText: preset.footerText
    },
    ...current.filter((item) => item.id !== id)
  ].slice(0, 20);
  writeJson(FLOW_PRESETS_KEY, next);
  return next;
}

export function deleteFlowPreset(id: string): FlowPreset[] {
  const next = loadFlowPresets().filter((item) => item.id !== id);
  writeJson(FLOW_PRESETS_KEY, next);
  return next;
}

export const FLOW_SCENARIO_DEFAULTS: Array<Omit<FlowPreset, "id" | "flowId"> & { flowId?: string }> = [
  {
    name: "حجز موعد",
    flowCta: "احجز الآن",
    bodyText: "اختر الموعد المناسب من النموذج التالي.",
    headerText: "حجز موعد",
    footerText: "فريق الدعم"
  },
  {
    name: "عنوان الشحن",
    flowCta: "أدخل العنوان",
    bodyText: "فضلاً أكمل بيانات عنوان التوصيل.",
    headerText: "عنوان الشحن",
    footerText: "شكراً لك"
  },
  {
    name: "تقييم الخدمة",
    flowCta: "قيّم الآن",
    bodyText: "نود معرفة رأيك لتحسين الخدمة.",
    headerText: "تقييم",
    footerText: "رأيك يهمنا"
  }
];
