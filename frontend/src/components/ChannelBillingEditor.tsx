import { useState } from "react";
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
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(billingStartsAt));
  const [endsAt, setEndsAt] = useState(toDatetimeLocal(billingEndsAt));
  const [included, setIncluded] = useState(String(includedMac));
  const [price, setPrice] = useState(String(overMacPricePer100));
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsedIncluded = Number(included);
    const parsedPrice = Number(price);
    if (Number.isNaN(parsedIncluded) || parsedIncluded < 0 || Number.isNaN(parsedPrice) || parsedPrice < 0) {
      toastStore.getState().show("قيم غير صالحة", "error");
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
      toastStore.getState().show("تم الحفظ");
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

  if (disabled) return null;

  if (open) {
    return (
      <div className="channel-billing-popover">
        <label><span>بداية</span><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
        <label><span>نهاية</span><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
        <label><span>MAC</span><input type="number" min={0} value={included} onChange={(e) => setIncluded(e.target.value)} /></label>
        <label><span>Over</span><input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <div className="channel-billing-editor-actions">
          <button type="button" className="assignments-primary-btn" disabled={saving} onClick={() => void save()}>{saving ? "…" : "حفظ"}</button>
          <button type="button" className="secondary-button" onClick={() => setOpen(false)}>إلغاء</button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" className="secondary-button channel-billing-edit-btn" onClick={() => setOpen(true)}>
      تعديل
    </button>
  );
}
