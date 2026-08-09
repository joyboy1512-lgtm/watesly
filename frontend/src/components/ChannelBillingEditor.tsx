import { FormEvent, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { toastStore } from "../stores/toast";

type Props = {
  channelId: string;
  billingStartsAt: string | null | undefined;
  billingEndsAt: string | null | undefined;
  includedMac: number;
  overMacPricePer100: number;
  disabled?: boolean;
};

function toDatetimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default function ChannelBillingEditor({
  channelId,
  billingStartsAt,
  billingEndsAt,
  includedMac,
  overMacPricePer100,
  disabled
}: Props) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [included, setIncluded] = useState(String(includedMac));
  const [price, setPrice] = useState(String(overMacPricePer100));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStartsAt(toDatetimeLocal(billingStartsAt));
    setEndsAt(toDatetimeLocal(billingEndsAt));
    setIncluded(String(includedMac));
    setPrice(String(overMacPricePer100));
  }, [billingStartsAt, billingEndsAt, includedMac, overMacPricePer100]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsedIncluded = Number(included);
    const parsedPrice = Number(price);
    if (Number.isNaN(parsedIncluded) || parsedIncluded < 0) {
      toastStore.getState().show("أدخل حصة MAC صالحة", "error");
      return;
    }
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      toastStore.getState().show("أدخل سعراً صالحاً", "error");
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/channels/${channelId}/billing`, {
        billing_starts_at: startsAt ? fromDatetimeLocal(startsAt) : null,
        billing_ends_at: endsAt ? fromDatetimeLocal(endsAt) : null,
        included_mac: parsedIncluded,
        over_mac_price_per_100: parsedPrice
      });
      toastStore.getState().show("تم حفظ إعدادات فوترة القnaة");
      setOpen(false);
      void client.invalidateQueries({ queryKey: ["channels-usage-board"] });
      void client.invalidateQueries({ queryKey: ["billing-mac-channels"] });
      void client.invalidateQueries({ queryKey: ["billing-usage"] });
      void client.invalidateQueries({ queryKey: ["subscription"] });
    } catch (error) {
      toastStore.getState().show(formatApiError(error), "error");
    } finally {
      setSaving(false);
    }
  }

  if (open && !disabled) {
    return (
      <form className="channel-billing-editor" onSubmit={(e) => void save(e)}>
        <label>
          <span>بداية</span>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label>
          <span>نهاية</span>
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
        <label>
          <span>MAC مشمول</span>
          <input type="number" min={0} value={included} onChange={(e) => setIncluded(e.target.value)} />
        </label>
        <label>
          <span>Over $/100</span>
          <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <div className="channel-billing-editor-actions">
          <button type="submit" className="assignments-primary-btn" disabled={saving}>
            {saving ? "…" : "حفظ"}
          </button>
          <button type="button" className="secondary-button" onClick={() => setOpen(false)}>
            إلغاء
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="channel-billing-summary">
      <div className="admin-cell-stack">
        <strong>{includedMac.toLocaleString("ar")} MAC</strong>
        <small>${overMacPricePer100.toFixed(2)}/100 Over</small>
        <small>{formatShortDate(billingStartsAt)} – {formatShortDate(billingEndsAt)}</small>
      </div>
      {!disabled && (
        <button type="button" className="assignments-primary-btn channel-billing-edit-btn" onClick={() => setOpen(true)}>
          تعديل الفوترة
        </button>
      )}
    </div>
  );
}
