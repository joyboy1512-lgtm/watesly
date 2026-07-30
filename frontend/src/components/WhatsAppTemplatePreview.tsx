import { fillTemplateVariables, parseTemplatePreview } from "../lib/templatePreview";
import type { TemplateComponent } from "../lib/templateMedia";

export type WhatsAppTemplatePreviewProps = {
  bodyText?: string | null;
  components?: TemplateComponent[] | null;
  mediaOverride?: { mediaUrl?: string; filename?: string };
  businessName?: string;
  templateName?: string;
  variableSamples?: string[];
  compact?: boolean;
  className?: string;
};

export default function WhatsAppTemplatePreview({
  bodyText,
  components,
  mediaOverride,
  businessName = "نشاطك التجاري",
  templateName,
  variableSamples,
  compact = false,
  className = ""
}: WhatsAppTemplatePreviewProps) {
  const parsed = parseTemplatePreview(bodyText, components, mediaOverride);
  const samples = variableSamples ?? undefined;
  const headerText = parsed.headerText ? fillTemplateVariables(parsed.headerText, samples) : null;
  const body = parsed.body ? fillTemplateVariables(parsed.body, samples) : "—";
  const footer = parsed.footer ? fillTemplateVariables(parsed.footer, samples) : null;
  const hasContent =
    headerText ||
    parsed.headerMedia ||
    parsed.body.trim() ||
    parsed.footer ||
    parsed.buttons.length;

  return (
    <div className={`wa-template-preview ${compact ? "compact" : ""} ${className}`.trim()}>
      <div className="wa-template-preview-label">
        <span>معاينة — كما يراها العميل</span>
        {templateName && <small dir="ltr">{templateName}</small>}
      </div>
      <div className="wa-phone-frame">
        <div className="wa-phone-header">
          <span className="wa-phone-back">‹</span>
          <div className="wa-phone-contact">
            <span className="wa-phone-avatar" aria-hidden="true">
              {businessName.charAt(0)}
            </span>
            <strong>{businessName}</strong>
          </div>
        </div>
        <div className="wa-phone-chat">
          {!hasContent && (
            <p className="wa-preview-empty">أدخل نص القالب أو ارفع وسائط لرؤية المعاينة.</p>
          )}
          {hasContent && (
            <div className="wa-template-bubble">
              {parsed.headerMedia?.format === "IMAGE" && (
                <img
                  className="wa-template-media"
                  src={parsed.headerMedia.mediaUrl}
                  alt=""
                />
              )}
              {parsed.headerMedia?.format === "VIDEO" && (
                <div className="wa-template-media wa-template-video">
                  <video src={parsed.headerMedia.mediaUrl} controls preload="metadata" />
                </div>
              )}
              {parsed.headerMedia?.format === "DOCUMENT" && (
                <div className="wa-template-document">
                  <span aria-hidden="true">📄</span>
                  <span>{parsed.headerMedia.filename || "مستند.pdf"}</span>
                </div>
              )}
              {headerText && <div className="wa-template-header-text">{headerText}</div>}
              <div className="wa-template-body">{body}</div>
              {footer && <div className="wa-template-footer">{footer}</div>}
              <time className="wa-template-time">
                {new Date().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}
              </time>
              {parsed.buttons.length > 0 && (
                <div className="wa-template-buttons">
                  {parsed.buttons.map((button, index) => (
                    <button key={`${button.text}-${index}`} type="button" className="wa-template-button" disabled>
                      {button.type === "URL" && "🔗 "}
                      {button.type === "PHONE_NUMBER" && "📞 "}
                      {button.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="hint-text wa-preview-note">
        المتغيرات {"{{1}}"}، {"{{2}}"} تُستبدل بقيم تجريبية في المعاينة فقط.
      </p>
    </div>
  );
}
