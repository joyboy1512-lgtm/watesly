import { Fragment } from "react";

function renderWhatsAppBold(text: string) {
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("*") && part.endsWith("*")) {
      return <strong key={`${part}-${index}`}>{part.slice(1, -1)}</strong>;
    }
    return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
  });
}

type Props = {
  text: string;
  compact?: boolean;
};

export default function WhatsAppTextPreview({ text, compact }: Props) {
  const lines = text.split("\n");
  return (
    <div className={`whatsapp-text-preview ${compact ? "compact" : ""}`}>
      {lines.map((line, index) => (
        <p key={`${line}-${index}`}>{line ? renderWhatsAppBold(line) : "\u00A0"}</p>
      ))}
    </div>
  );
}
