import {
  getTemplateHeaderInfo,
  type TemplateComponent,
  type TemplateHeaderFormat
} from "./templateMedia";

export type TemplateButtonPreview = {
  type: string;
  text: string;
  url?: string;
  phone?: string;
};

export type ParsedTemplatePreview = {
  headerText: string | null;
  headerMedia: {
    format: TemplateHeaderFormat;
    mediaUrl: string;
    filename: string | null;
  } | null;
  body: string;
  footer: string | null;
  buttons: TemplateButtonPreview[];
};

const DEFAULT_VARIABLE_SAMPLES = ["أحمد", "العرض", "12345", "شركتنا"];

export function fillTemplateVariables(text: string, samples: string[] = DEFAULT_VARIABLE_SAMPLES): string {
  let result = text;
  samples.forEach((sample, index) => {
    const pattern = new RegExp(`\\{\\{${index + 1}\\}\\}`, "g");
    result = result.replace(pattern, sample);
  });
  return result;
}

export function parseTemplatePreview(
  bodyText: string | null | undefined,
  components: TemplateComponent[] | null | undefined,
  mediaOverride?: { mediaUrl?: string; filename?: string }
): ParsedTemplatePreview {
  let headerText: string | null = null;
  let body = bodyText?.trim() ?? "";
  let footer: string | null = null;
  const buttons: TemplateButtonPreview[] = [];

  for (const component of components ?? []) {
    const type = component.type?.toUpperCase() ?? "";
    const format = component.format?.toUpperCase() ?? "";

    if (type === "HEADER" && format === "TEXT" && component.text) {
      headerText = component.text;
    }
    if (type === "BODY" && component.text) {
      body = component.text;
    }
    if (type === "FOOTER" && component.text) {
      footer = component.text;
    }
    if (type === "BUTTONS" && Array.isArray(component.buttons)) {
      for (const button of component.buttons) {
        buttons.push({
          type: button.type ?? "QUICK_REPLY",
          text: button.text ?? "زر",
          url: button.url,
          phone: button.phone_number
        });
      }
    }
  }

  const headerMediaInfo = getTemplateHeaderInfo(components);
  const mediaUrl = mediaOverride?.mediaUrl || headerMediaInfo?.mediaUrl;
  const headerMedia =
    mediaUrl && headerMediaInfo
      ? {
          format: headerMediaInfo.format,
          mediaUrl,
          filename: mediaOverride?.filename || headerMediaInfo.filename
        }
      : mediaUrl
        ? {
            format: (headerMediaInfo?.format ?? "IMAGE") as TemplateHeaderFormat,
            mediaUrl,
            filename: mediaOverride?.filename ?? null
          }
        : null;

  return { headerText, headerMedia, body, footer, buttons };
}
