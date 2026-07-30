import type { Message } from "../types/api";
import { formatMessageStatus } from "../lib/inboxHelpers";

type Props = {
  message: Message;
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
  const status = formatMessageStatus(message.status, message.direction);
  const caption = message.media_caption || message.text_body;
  const isMedia = message.type !== "text" && message.type !== "template" && message.type !== "interactive";

  function renderBody() {
    if (message.type === "image" && message.media_url) {
      return (
        <div className="message-media">
          <a href={message.media_url} target="_blank" rel="noreferrer">
            <img src={message.media_url} alt={caption || "صورة"} loading="lazy" />
          </a>
          {caption && <p>{highlightText(caption, highlight)}</p>}
        </div>
      );
    }
    if (message.type === "video" && message.media_url) {
      return (
        <div className="message-media">
          <video src={message.media_url} controls preload="metadata" />
          {caption && <p>{highlightText(caption, highlight)}</p>}
        </div>
      );
    }
    if (message.type === "audio" && message.media_url) {
      return (
        <div className="message-media">
          <audio src={message.media_url} controls preload="metadata" />
        </div>
      );
    }
    if (message.type === "document" && message.media_url) {
      return (
        <div className="message-media message-media-document">
          <a href={message.media_url} target="_blank" rel="noreferrer">
            📄 {message.media_filename || "تحميل المستند"}
          </a>
          {caption && <p>{highlightText(caption, highlight)}</p>}
        </div>
      );
    }
    if (isMedia) {
      return (
        <div className="message-media message-media-placeholder">
          <span>{mediaLabels[message.type] || message.type}</span>
          {message.media_filename && <small>{message.media_filename}</small>}
          {caption && <p>{highlightText(caption, highlight)}</p>}
        </div>
      );
    }
    return <div>{highlightText(message.text_body || `[${message.type}]`, highlight)}</div>;
  }

  return (
    <div className={`message ${message.direction === "outbound" ? "outgoing" : "incoming"}`}>
      {renderBody()}
      <small>
        {formatTime(message.created_at)}
        {status && (
          <span className={`message-status message-status-${status.className}`}>{status.label}</span>
        )}
      </small>
    </div>
  );
}
