import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { toastStore } from "../stores/toast";

type ProviderSettings = {
  starts_at: string;
  ends_at: string;
  billing_cycle: string;
  billing_period_start: string;
  billing_period_end: string;
  included_mac: number;
  included_mac_override: number | null;
  over_mac_price_per_100: number;
  over_mac_price_per_100_override: number | null;
  plan_name: string;
  plan_included_mac: number;
  plan_over_mac_price_per_100: number;
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

function formatPeriodDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

export default function BillingProviderSettings() {
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
      toastStore.getState().show("تم حفظ إعدادات الفوترة");
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
    return (
      <section className="card billing-provider-settings-card">
        <p className="hint-text">جاري تحميل إعدادات مزود الخدمة…</p>
      </section>
    );
  }

  const s = settings.data;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <section className="card billing-provider-settings-card">
      <div className="billing-chart-head">
        <div>
          <h2>إعدادات الفوترة — مزود الخدمة</h2>
          <small>صلاحية billing.manage · تحديد الاشتراك، دورة MAC، والتسعير الافتراضي</small>
        </div>
      </div>

      <div className="billing-provider-readonly">
        <div><span>الخطة</span><strong>{s.plan_name}</strong></div>
        <div><span>دورة MAC الحالية</span><strong>{formatPeriodDate(s.billing_period_start)} – {formatPeriodDate(s.billing_period_end)}</strong></div>
        <div><span>MAC من الباقة</span><strong>{s.plan_included_mac.toLocaleString("ar")}</strong></div>
        <div><span>Over MAC من الباقة</span><strong>${s.plan_over_mac_price_per_100}/100</strong></div>
      </div>

      <form className="billing-provider-form" onSubmit={submit}>
        <label>
          <span>بداية الاشتراك</span>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        </label>
        <label>
          <span>نهاية / تجديد الاشتراك</span>
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
        </label>
        <label>
          <span>MAC مشمول (تجاوز للباقة)</span>
          <input
            type="number"
            min={0}
            value={includedOverride}
            onChange={(e) => setIncludedOverride(e.target.value)}
            placeholder={String(s.plan_included_mac)}
          />
        </label>
        <label>
          <span>Over MAC $/100 (تجاوز للباقة)</span>
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
          {save.isPending ? "جاري الحفظ…" : "حفظ إعدادات المزود"}
        </button>
      </form>
    </section>
  );
}
