import type { UploadedFile } from "./uploads";

export type TemplateHeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
export type TemplateButtonType = "URL" | "PHONE_NUMBER" | "QUICK_REPLY";

const EPHEMERAL_MEDIA_HOSTS = ["scontent.whatsapp.net", "fbcdn.net"];

function isEphemeralMetaMediaUrl(url: string | null | undefined) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return EPHEMERAL_MEDIA_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
  } catch {
    return false;
  }
}

export type TemplateButton = {
  type?: TemplateButtonType | string;
  text?: string;
  url?: string;
  phone_number?: string;
  id?: string;
  marketing_opt_out?: boolean;
  marketing_interested?: boolean;
};

export type TemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  media_url?: string;
  filename?: string;
  buttons?: TemplateButton[];
  example?: {
    header_url?: string[];
    header_handle?: string[];
    header_text?: string[];
    body_text?: string[][];
  };
};

export function contentTypeToHeaderFormat(contentType: string | null | undefined): Exclude<TemplateHeaderFormat, "TEXT"> | null {
  if (!contentType) return null;
  const lowered = contentType.toLowerCase();
  if (lowered.startsWith("image/")) return "IMAGE";
  if (lowered.startsWith("video/")) return "VIDEO";
  if (lowered === "application/pdf") return "DOCUMENT";
  return null;
}

export function mediaEndpointFromContentType(contentType: string | null | undefined): "image" | "video" | "audio" | "document" | null {
  if (!contentType) return null;
  const lowered = contentType.toLowerCase();
  if (lowered.startsWith("image/")) return "image";
  if (lowered.startsWith("video/")) return "video";
  if (lowered.startsWith("audio/")) return "audio";
  if (lowered === "application/pdf") return "document";
  return null;
}

export function getTemplateHeaderInfo(components: TemplateComponent[] | null | undefined) {
  for (const component of components ?? []) {
    if (component.type?.toUpperCase() !== "HEADER") continue;
    const format = (component.format ?? "").toUpperCase() as TemplateHeaderFormat;
    if (!["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) continue;
    let mediaUrl = component.media_url || null;
    if ((!mediaUrl || isEphemeralMetaMediaUrl(mediaUrl)) && component.example) {
      const candidates = [
        ...(component.example.header_url ?? []),
        ...(component.example.header_handle ?? [])
      ];
      mediaUrl = candidates.find((item) => item && !isEphemeralMetaMediaUrl(item)) ?? null;
    }
    if (mediaUrl && !isEphemeralMetaMediaUrl(mediaUrl)) {
      return { format: format as Exclude<TemplateHeaderFormat, "TEXT">, mediaUrl, filename: component.filename ?? null };
    }
  }
  return null;
}

/** Normalize a shop/CTA URL for Meta URL buttons. Returns null when empty or invalid. */
export function normalizeShopUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractBodyVariableCount(bodyText: string | null | undefined): number {
  const matches = Array.from((bodyText ?? "").matchAll(/\{\{(\d+)\}\}/g));
  if (!matches.length) return 0;
  return Math.max(...matches.map((item) => Number(item[1])));
}

export type BuildTemplateOptions = {
  includeMarketingOptOut?: boolean;
  category?: string | null;
  shopUrl?: string | null;
  shopButtonText?: string | null;
  headerText?: string | null;
  footerText?: string | null;
  customButtons?: TemplateButton[] | null;
  bodySamples?: string[] | null;
};

export function buildStoredComponents(
  bodyText: string | null,
  uploaded: UploadedFile | null,
  headerFormat: TemplateHeaderFormat | null,
  options?: BuildTemplateOptions
): TemplateComponent[] {
  const components: TemplateComponent[] = [];
  const headerText = (options?.headerText ?? "").trim();
  if (headerFormat === "TEXT" && headerText) {
    components.push({ type: "HEADER", format: "TEXT", text: headerText.slice(0, 60) });
  } else if (uploaded && headerFormat && headerFormat !== "TEXT") {
    components.push({
      type: "HEADER",
      format: headerFormat,
      media_url: uploaded.public_url,
      filename: uploaded.filename
    });
  }

  if (bodyText?.trim()) {
    const bodyComponent: TemplateComponent = { type: "BODY", text: bodyText.trim() };
    const variableCount = extractBodyVariableCount(bodyText);
    if (variableCount > 0) {
      const samples = [...(options?.bodySamples ?? [])];
      while (samples.length < variableCount) {
        samples.push(`مثال${samples.length + 1}`);
      }
      bodyComponent.example = { body_text: [samples.slice(0, variableCount)] };
    }
    components.push(bodyComponent);
  }

  const buttons: TemplateButton[] = [];
  for (const button of options?.customButtons ?? []) {
    if (buttons.length >= 3) break;
    const type = String(button.type || "QUICK_REPLY").toUpperCase();
    const text = String(button.text || "").trim().slice(0, 25);
    if (!text) continue;
    if (type === "URL") {
      const url = normalizeShopUrl(button.url);
      if (!url) continue;
      buttons.push({ type: "URL", text, url });
      continue;
    }
    if (type === "PHONE_NUMBER") {
      const phone = String(button.phone_number || "").replace(/[^\d+]/g, "").trim();
      if (!phone) continue;
      buttons.push({ type: "PHONE_NUMBER", text, phone_number: phone });
      continue;
    }
    buttons.push({
      type: "QUICK_REPLY",
      text,
      id: button.id,
      marketing_opt_out: button.marketing_opt_out,
      marketing_interested: button.marketing_interested
    });
  }

  const shopUrl = normalizeShopUrl(options?.shopUrl);
  if (shopUrl && buttons.length < 3 && !buttons.some((item) => item.type === "URL")) {
    const shopText = (options?.shopButtonText ?? "").trim().slice(0, 25) || "تسوق الآن";
    buttons.push({ type: "URL", text: shopText, url: shopUrl });
  }

  const includeMarketing =
    Boolean(options?.includeMarketingOptOut) && (options?.category ?? "marketing") === "marketing";
  if (includeMarketing) {
    if (buttons.length < 3 && !buttons.some((item) => item.marketing_interested)) {
      buttons.push({
        type: "QUICK_REPLY",
        text: "مهتم",
        id: "watesly_interested",
        marketing_interested: true
      });
    }
    if (buttons.length < 3 && !buttons.some((item) => item.marketing_opt_out)) {
      buttons.push({
        type: "QUICK_REPLY",
        text: "عدم الإزعاج",
        id: "watesly_marketing_opt_out",
        marketing_opt_out: true
      });
    }
  }

  if (buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons: buttons.slice(0, 3) });
  }

  const footerText = (options?.footerText ?? "").trim();
  if (footerText) {
    components.push({ type: "FOOTER", text: footerText.slice(0, 60) });
  } else if (includeMarketing) {
    components.push({ type: "FOOTER", text: "أرسل «إيقاف» لإلغاء الاشتراك" });
  }
  return components;
}

export function buildSendComponents(
  components: TemplateComponent[] | null | undefined,
  override?: { mediaUrl?: string; filename?: string }
) {
  const header = getTemplateHeaderInfo(components);
  const mediaUrl = override?.mediaUrl || header?.mediaUrl;
  const format = header?.format ?? "IMAGE";
  const filename = override?.filename || header?.filename || "file.pdf";
  if (!mediaUrl) return [];

  if (format === "DOCUMENT") {
    return [{
      type: "header",
      parameters: [{ type: "document", document: { link: mediaUrl, filename } }]
    }];
  }
  if (format === "VIDEO") {
    return [{
      type: "header",
      parameters: [{ type: "video", video: { link: mediaUrl } }]
    }];
  }
  return [{
    type: "header",
    parameters: [{ type: "image", image: { link: mediaUrl } }]
  }];
}

export const MEDIA_ACCEPT =
  "image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/ogg,application/pdf";

export const HEADER_MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,application/pdf";

export const HEADER_FORMAT_LABELS: Record<TemplateHeaderFormat, string> = {
  TEXT: "نص",
  IMAGE: "صورة",
  VIDEO: "فيديو",
  DOCUMENT: "PDF / مستند"
};
