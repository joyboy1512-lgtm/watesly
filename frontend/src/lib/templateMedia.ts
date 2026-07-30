import type { UploadedFile } from "./uploads";

export type TemplateHeaderFormat = "IMAGE" | "VIDEO" | "DOCUMENT";

export type TemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  media_url?: string;
  filename?: string;
  buttons?: Array<{ type?: string; text?: string; url?: string; phone_number?: string }>;
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
    const mediaUrl =
      component.media_url ||
      component.example?.header_url?.[0] ||
      component.example?.header_handle?.[0];
    if (mediaUrl) {
      return { format, mediaUrl, filename: component.filename ?? null };
    }
  }
  return null;
}

export function buildStoredComponents(
  bodyText: string | null,
  uploaded: UploadedFile | null,
  headerFormat: TemplateHeaderFormat | null
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
