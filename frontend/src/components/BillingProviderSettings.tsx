import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { toastStore } from "../stores/toast";

type ProviderSettings = {
  starts_at: string;
  ends_at: string;
  included_mac_override: number | null;
  over_mac_price_per_100_override: number | null;
  plan_included_mac: number;
  over_mac_price_per_100: number;
};

type Props = {
  embedded?: boolean;
};

function toDatetimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export default function BillingProviderSettings({ embedded = false }: Props) {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["billing-provider-settings"],
    queryFn: async () => (await api.get<ProviderSettings>("/billing/provider-settings")).data,
    retry: false
  });

  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [includedOverride, setIncludedOverride] = useState("");
  const [priceOverride, setPriceOverride] = useState("");

  useEffect(() => {
    if (!settings.data) return;
    setStartsAt(toDatetimeLocal(settings.data.starts_at));
    setEndsAt(toDatetimeLocal(settings.data.ends_at));
    setIncludedOverride(settings.data.included_mac_override?.toString() ?? "");
    setPriceOverride(settings.data.over_mac_price_per_100_override?.toString() ?? "");
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch<ProviderSettings>("/billing/provider-settings", {
          starts_at: startsAt ? fromDatetimeLocal(startsAt) : undefined,
          ends_at: endsAt ? fromDatetimeLocal(endsAt) : undefined,
          included_mac_override: includedOverride.trim() ? Number(includedOverride) : null,
          over_mac_price_per_100_override: priceOverride.trim() ? Number(priceOverride) : null
        })
      ).data,
    onSuccess: () => {
      toastStore.getState().show("تم الحفظ");
      void client.invalidateQueries({ queryKey: ["billing-provider-settings"] });
      void client.invalidateQueries({ queryKey: ["subscription"] });
      void client.invalidateQueries({ queryKey: ["billing-usage"] });
      void client.invalidateQueries({ queryKey: ["billing-mac-channels"] });
      void client.invalidateQueries({ queryKey: ["channels-usage-board"] });
    },
    onError: (error) => toastStore.getState().show(formatApiError(error), "error")
  });

  if (settings.isError) return null;
  if (settings.isLoading || !settings.data) {
    return <p className="hint-text">جاري التحميل…</p>;
  }

  const s = settings.data;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  const form = (
    <form className="billing-provider-form billing-provider-form-compact" onSubmit={submit}>
      <label>
        <span>بداية الاشتراك</span>
        <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
      </label>
      <label>
        <span>نهاية الاشتراك</span>
        <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
      </label>
      <label>
        <span>MAC مشمول (افتراضي)</span>
        <input
          type="number"
          min={0}
          value={includedOverride}
          onChange={(e) => setIncludedOverride(e.target.value)}
          placeholder={String(s.plan_included_mac)}
        />
      </label>
      <label>
        <span>Over MAC $/100</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={priceOverride}
          onChange={(e) => setPriceOverride(e.target.value)}
          placeholder={String(s.over_mac_price_per_100)}
        />
      </label>
      <button type="submit" className="assignments-primary-btn" disabled={save.isPending}>
        {save.isPending ? "…" : "حفظ"}
      </button>
    </form>
  );

  if (embedded) return form;

  return (
    <section className="card billing-provider-settings-card">
      <div className="billing-chart-head">
        <h2>إعدادات الاشتراك الافتراضي</h2>
      </div>
      {form}
    </section>
  );
}
