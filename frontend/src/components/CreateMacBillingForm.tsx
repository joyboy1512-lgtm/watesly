import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { toastStore } from "../stores/toast";

type ChannelOption = {
  channel_id: string;
  channel_name: string;
  subscription_starts_at: string | null;
  subscription_ends_at: string | null;
  included_mac: number;
  over_mac_price_per_100: number;
};

type ProviderDefaults = {
  starts_at: string;
  ends_at: string;
  included_mac: number;
  over_mac_price_per_100: number;
  plan_included_mac: number;
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

type Props = {
  channels: ChannelOption[];
};

export default function CreateMacBillingForm({ channels }: Props) {
  const client = useQueryClient();
  const defaults = useQuery({
    queryKey: ["billing-provider-settings"],
    queryFn: async () => (await api.get<ProviderDefaults & { plan_included_mac: number }>("/billing/provider-settings")).data,
    retry: false
  });

  const [channelId, setChannelId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [includedMac, setIncludedMac] = useState("");
  const [overPrice, setOverPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = channels.find((item) => item.channel_id === channelId);

  useEffect(() => {
    if (channels.length > 0 && !channelId) {
      setChannelId(channels[0].channel_id);
    }
  }, [channels, channelId]);

  useEffect(() => {
    if (selected) {
      setStartsAt(toDatetimeLocal(selected.subscription_starts_at));
      setEndsAt(toDatetimeLocal(selected.subscription_ends_at));
      setIncludedMac(String(selected.included_mac));
      setOverPrice(String(selected.over_mac_price_per_100));
      return;
    }
    if (defaults.data) {
      setStartsAt(toDatetimeLocal(defaults.data.starts_at));
      setEndsAt(toDatetimeLocal(defaults.data.ends_at));
      setIncludedMac(String(defaults.data.included_mac));
      setOverPrice(String(defaults.data.over_mac_price_per_100));
    }
  }, [selected, defaults.data]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!channelId) {
      toastStore.getState().show("اختر القناة", "error");
      return;
    }
    const parsedIncluded = Number(includedMac);
    const parsedPrice = Number(overPrice);
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
      toastStore.getState().show(`تم تطبيق فوترة MAC على ${selected?.channel_name ?? "القناة"}`);
      void client.invalidateQueries({ queryKey: ["billing-mac-channels"] });
      void client.invalidateQueries({ queryKey: ["channels-usage-board"] });
      void client.invalidateQueries({ queryKey: ["billing-usage"] });
      void client.invalidateQueries({ queryKey: ["subscription"] });
    } catch (error) {
      toastStore.getState().show(formatApiError(error), "error");
    } finally {
      setSaving(false);
    }
  }

  if (defaults.isLoading) {
    return <p className="hint-text billing-create-mac-loading">جاري التحميل…</p>;
  }

  return (
    <form className="billing-create-mac-form" onSubmit={(e) => void submit(e)}>
      <label>
        <span>اسم القناة</span>
        <select value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
          {channels.length === 0 && <option value="">لا توجد قنوات</option>}
          {channels.map((item) => (
            <option key={item.channel_id} value={item.channel_id}>
              {item.channel_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>بداية الاشتراك</span>
        <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
      </label>
      <label>
        <span>نهاية الاشتراك</span>
        <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
      </label>
      <label>
        <span>MAC مشمول</span>
        <input type="number" min={0} value={includedMac} onChange={(e) => setIncludedMac(e.target.value)} required />
      </label>
      <label>
        <span>Over MAC $/100</span>
        <input type="number" min={0} step="0.01" value={overPrice} onChange={(e) => setOverPrice(e.target.value)} required />
      </label>
      <button type="submit" className="assignments-primary-btn billing-create-mac-btn" disabled={saving || channels.length === 0}>
        {saving ? "جاري الحفظ…" : "حفظ وتطبيق MAC"}
      </button>
    </form>
  );
}
