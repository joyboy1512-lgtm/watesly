import { useMemo, useState } from "react";
import { loadRecentEmojis, pushRecentEmoji } from "../lib/inboxComposerStorage";

type Props = {
  open: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
};

const EMOJI_CATALOG: Array<{ emoji: string; labels: string[] }> = [
  { emoji: "😀", labels: ["ابتسامة", "سعيد", "فرح"] },
  { emoji: "😁", labels: ["ضحك", "سعادة"] },
  { emoji: "😂", labels: ["ضحك", "قهقهة"] },
  { emoji: "🙂", labels: ["ابتسامة", "لطيف"] },
  { emoji: "😊", labels: ["خجل", "رضا"] },
  { emoji: "😍", labels: ["حب", "إعجاب"] },
  { emoji: "🤝", labels: ["اتفاق", "صافحة", "شراكة"] },
  { emoji: "👍", labels: ["موافق", "تمام", "حسنا"] },
  { emoji: "🙏", labels: ["شكرا", "رجاء", "دعاء"] },
  { emoji: "✅", labels: ["تم", "صح", "موافق"] },
  { emoji: "🔥", labels: ["قوي", "رائج", "ممتاز"] },
  { emoji: "🎉", labels: ["احتفال", "تهنئة"] },
  { emoji: "💼", labels: ["عمل", "صفقة", "مكتب"] },
  { emoji: "📦", labels: ["شحن", "طرد", "طلب"] },
  { emoji: "💰", labels: ["سعر", "مال", "دفع"] },
  { emoji: "⏰", labels: ["وقت", "موعد", "ساعة"] },
  { emoji: "❗", labels: ["تنبيه", "مهم"] },
  { emoji: "❓", labels: ["سؤال", "استفسار"] },
  { emoji: "❤️", labels: ["حب", "قلب"] },
  { emoji: "🌟", labels: ["نجمة", "مميز"] },
  { emoji: "👋", labels: ["مرحبا", "وداعا", "تحية"] },
  { emoji: "🧾", labels: ["فاتورة", "حساب"] },
  { emoji: "📍", labels: ["موقع", "عنوان"] }
];

export default function InboxEmojiPicker({ open, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState(() => loadRecentEmojis());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EMOJI_CATALOG;
    return EMOJI_CATALOG.filter(
      (item) => item.emoji.includes(q) || item.labels.some((label) => label.includes(q) || label.toLowerCase().includes(q))
    );
  }, [query]);

  if (!open) return null;

  function pick(emoji: string) {
    setRecent(pushRecentEmoji(emoji));
    onPick(emoji);
    onClose();
  }

  return (
    <div className="inbox-emoji-picker" role="listbox" aria-label="إيموجي">
      <input
        className="inbox-emoji-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="بحث عربي… مثل فرح، شكرا، شحن"
      />
      {recent.length > 0 && !query.trim() && (
        <div className="inbox-emoji-section">
          <span className="field-label-title">مستخدمة مؤخراً</span>
          <div className="inbox-emoji-grid">
            {recent.map((emoji) => (
              <button key={`recent-${emoji}`} type="button" className="inbox-emoji-btn" onClick={() => pick(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="inbox-emoji-section">
        <span className="field-label-title">{query.trim() ? "نتائج البحث" : "الكل"}</span>
        <div className="inbox-emoji-grid">
          {filtered.map((item) => (
            <button
              key={item.emoji + item.labels.join("-")}
              type="button"
              className="inbox-emoji-btn"
              title={item.labels.join(" · ")}
              onClick={() => pick(item.emoji)}
            >
              {item.emoji}
            </button>
          ))}
          {filtered.length === 0 && <p className="hint-text">لا توجد نتائج.</p>}
        </div>
      </div>
    </div>
  );
}
