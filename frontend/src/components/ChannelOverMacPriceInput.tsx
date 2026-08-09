import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { toastStore } from "../stores/toast";

type Props = {
  channelId: string;
  value: number;
  disabled?: boolean;
};

export default function ChannelOverMacPriceInput({ channelId, value, disabled }: Props) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsed = Number(draft);
    if (Number.isNaN(parsed) || parsed < 0) {
      toastStore.getState().show("أدخل سعراً صالحاً", "error");
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/channels/${channelId}/billing`, {
        over_mac_price_per_100: parsed
      });
      toastStore.getState().show("تم حفظ سعر القناة");
      void client.invalidateQueries({ queryKey: ["channels-usage-board"] });
      void client.invalidateQueries({ queryKey: ["billing-mac-channels"] });
      void client.invalidateQueries({ queryKey: ["billing-usage"] });
    } catch (error) {
      toastStore.getState().show(formatApiError(error), "error");
    } finally {
      setSaving(false);
    }
  }

  if (disabled) {
    return <span>${value.toFixed(2)}/100</span>;
  }

  return (
    <div className="channel-price-input">
      <input
        type="number"
        min={0}
        step="0.01"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="سعر Over MAC للقناة"
      />
      <button type="button" className="secondary-button" disabled={saving} onClick={() => void save()}>
        {saving ? "…" : "حفظ"}
      </button>
    </div>
  );
}
