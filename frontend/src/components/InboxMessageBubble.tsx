import type { Message } from "../types/api";
import { formatMessageStatus } from "../lib/inboxHelpers";
import WhatsAppTemplatePreview from "./WhatsAppTemplatePreview";
import type { TemplateComponent } from "../lib/templateMedia";

export type WhisperBubble = {
  id: string;
  kind: "whisper";
  text_body: string;
  author_name?: string | null;
  created_at: string;
};

type Props = {
  message: Message | WhisperBubble;
  formatTime: (value: string | null) => string;
  highlight?: string;
};

const mediaLabels: Record<string, string> = {
  image: "صورة",
  video: "فيديو",
  audio: "رسالة صوتية",
  document: "مستند",
  sticker: "ملصق"
};

function highlightText(text: string, term: string) {
  if (!term.trim()) return text;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, index) =>
    part.toLowerCase() === term.toLowerCase() ? (
      <mark key={`${part}-${index}`} className="message-highlight">{part}</mark>
    ) : (
      part
    )
  );
}

export default function InboxMessageBubble({ message, formatTime, highlight = "" }: Props) {
  if ("kind" in message && message.kind === "whisper") {
    return (
      <div className="message message-whisper" role="note" aria-label="همس داخلي">
        <span className="message-whisper-badge">همس داخلي · لا يراه العميل</span>
        <div className="message-text">{highlightText(message.text_body, highlight)}</div>
        <small>
          {message.author_name ? `${message.author_name} · ` : ""}
          {formatTime(message.created_at)}
        </small>
      </div>
    );
  }

  const chatMessage = message as Message;
  const status = formatMessageStatus(chatMessage.status, chatMessage.direction);
  const caption = chatMessage.media_caption || chatMessage.text_body;
  const isMedia = chatMessage.type !== "text" && chatMessage.type !== "template" && chatMessage.type !== "interactive";
  const isTemplate = chatMessage.type === "template";

  function renderBody() {
    if (isTemplate) {
      return (
        <WhatsAppTemplatePreview
          variant="inline"
          bodyText={chatMessage.text_body}
          components={(chatMessage.template_components as TemplateComponent[] | null) ?? null}
          templateName={chatMessage.template_name ?? undefined}
          mediaOverride={
            chatMessage.media_url
              ? { mediaUrl: chatMessage.media_url, filename: chatMessage.media_filename ?? undefined }
              : undefined
          }
        />
      );
    }
    if (chatMessage.type === "image" && chatMessage.media_url) {
      return (
        <div className="message-media">
          <a href={chatMessage.media_url} target="_blank" rel="noreferrer">
            <img src={chatMessage.media_url} alt={caption || "صورة"} loading="lazy" />
          </a>
          {caption && <p>{highlightText(caption, highlight)}</p>}
        </div>
      );
    }
    if (chatMessage.type === "video" && chatMessage.media_url) {
      return (
        <div className="message-media">
          <video src={chatMessage.media_url} controls preload="metadata" />
          {caption && <p>{highlightText(caption, highlight)}</p>}
        </div>
      );
    }
    if (chatMessage.type === "audio" && chatMessage.media_url) {
      return (
        <div className="message-media">
          <audio src={chatMessage.media_url} controls preload="metadata" />
        </div>
      );
    }
    if (chatMessage.type === "document" && chatMessage.media_url) {
      return (
        <div className="message-media message-media-document">
          <a href={chatMessage.media_url} target="_blank" rel="noreferrer">
            📄 {chatMessage.media_filename || "تحميل المستند"}
          </a>
          {caption && <p>{highlightText(caption, highlight)}</p>}
        </div>
      );
    }
    if (isMedia) {
      return (
        <div className="message-media message-media-placeholder">
          <span>{mediaLabels[chatMessage.type] || chatMessage.type}</span>
          {chatMessage.media_filename && <small>{chatMessage.media_filename}</small>}
          {caption && <p>{highlightText(caption, highlight)}</p>}
        </div>
      );
    }
    return <div className="message-text">{highlightText(chatMessage.text_body || `[${chatMessage.type}]`, highlight)}</div>;
  }

  return (
    <div
      className={`message ${chatMessage.direction === "outbound" ? "outgoing" : "incoming"}${isTemplate ? " message-template" : ""}`}
    >
      {renderBody()}
      <small>
        {formatTime(chatMessage.created_at)}
        {status && (
          <span className={`message-status message-status-${status.className}`}>{status.label}</span>
        )}
      </small>
    </div>
  );
}
