type Props = {
  open: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
};

const EMOJIS = [
  "😀", "😁", "😂", "🙂", "😊", "😍", "🤝", "👍", "🙏", "✅",
  "🔥", "🎉", "💼", "📦", "💰", "⏰", "❗", "❓", "❤️", "🌟"
];

export default function InboxEmojiPicker({ open, onPick, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="inbox-emoji-picker" role="listbox" aria-label="إيموجي">
      <div className="inbox-emoji-grid">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="inbox-emoji-btn"
            onClick={() => {
              onPick(emoji);
              onClose();
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
