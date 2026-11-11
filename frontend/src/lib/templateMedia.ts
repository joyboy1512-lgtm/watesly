import type { UploadedFile } from "./uploads";

export type TemplateHeaderFormat = "IMAGE" | "VIDEO" | "DOCUMENT";

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

export type TemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  media_url?: string;
  filename?: string;
  buttons?: Array<{ type?: string; text?: string; url?: string; phone_number?: string; id?: string; marketing_opt_out?: boolean; marketing_interested?: boolean }>;
  example?: { header_url?: string[]; header_handle?: string[] };
};

export function contentTypeToHeaderFormat(contentType: string | null | undefined): TemplateHeaderFormat | null {
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
      return { format, mediaUrl, filename: component.filename ?? null };
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

export function buildStoredComponents(
  bodyText: string | null,
  uploaded: UploadedFile | null,
  headerFormat: TemplateHeaderFormat | null,
  options?: {
    includeMarketingOptOut?: boolean;
    category?: string | null;
    shopUrl?: string | null;
    shopButtonText?: string | null;
  }
): TemplateComponent[] {
  const components: TemplateComponent[] = [];
  if (uploaded && headerFormat) {
    components.push({
      type: "HEADER",
      format: headerFormat,
      media_url: uploaded.public_url,
      filename: uploaded.filename
    });
  }
  if (bodyText?.trim()) {
    components.push({ type: "BODY", text: bodyText.trim() });
  }

  const buttons: NonNullable<TemplateComponent["buttons"]> = [];
  const shopUrl = normalizeShopUrl(options?.shopUrl);
  if (shopUrl) {
    const shopText = (options?.shopButtonText ?? "").trim().slice(0, 25) || "تسوق الآن";
    buttons.push({ type: "URL", text: shopText, url: shopUrl });
  }

  const includeMarketing =
    Boolean(options?.includeMarketingOptOut) && (options?.category ?? "marketing") === "marketing";
  if (includeMarketing) {
    // Meta allows at most 3 buttons; keep the URL CTA and fill remaining slots with marketing replies.
    if (buttons.length < 3) {
      buttons.push({
        type: "QUICK_REPLY",
        text: "مهتم",
        id: "watesly_interested",
        marketing_interested: true
      });
    }
    if (buttons.length < 3) {
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
  if (includeMarketing) {
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
  IMAGE: "صورة",
  VIDEO: "فيديو",
  DOCUMENT: "PDF / مستند"
};
