import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import CatalogMetaProductWizard from "../components/CatalogMetaProductWizard";
import CatalogOfferWizard from "../components/CatalogOfferWizard";
import {
  buildMetaGroupPayload,
  buildOfferGroupPayload,
  emptyMetaGroupForm,
  emptyOfferGroupForm,
  isOfferMetaGroup,
  metaGroupFormFromResponse,
  metaGroupReady,
  metaGroupSyncMessages,
  offerGroupFormFromResponse,
  offerGroupReady,
  type MetaGroupResponse
} from "../lib/catalogHelpers";
import { toastStore } from "../stores/toast";
import { type WhatsAppAccountRow } from "../lib/whatsappHelpers";

type Organization = { id: string; name: string };

export default function CatalogGroupEditPage() {
  const { groupKey = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const decodedGroupId = decodeURIComponent(groupKey);
  const [metaForm, setMetaForm] = useState(emptyMetaGroupForm);
  const [offerForm, setOfferForm] = useState(emptyOfferGroupForm);
  const [editAsOffer, setEditAsOffer] = useState(false);
  const [saving, setSaving] = useState(false);

  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => (await api.get<Organization[]>("/organizations")).data
  });

  const categories = useQuery({
    queryKey: ["catalog-categories"],
    queryFn: async () => (await api.get<string[]>("/catalog/categories")).data
  });

  const variantGroups = useQuery({
    queryKey: ["catalog-variant-groups"],
    queryFn: async () => (await api.get<string[]>("/catalog/variant-groups")).data
  });

  const whatsappAccounts = useQuery({
    queryKey: ["whatsapp-accounts"],
    queryFn: async () => (await api.get<WhatsAppAccountRow[]>("/whatsapp/accounts")).data
  });

  const whatsappAccountCount = whatsappAccounts.data?.length ?? 1;

  const group = useQuery({
    queryKey: ["catalog-meta-group", decodedGroupId],
    queryFn: async () => (await api.get<MetaGroupResponse>(`/catalog/meta-group/${encodeURIComponent(decodedGroupId)}`)).data,
    enabled: Boolean(decodedGroupId)
  });

  useEffect(() => {
    if (!group.data) return;
    const asOffer = isOfferMetaGroup(group.data);
    setEditAsOffer(asOffer);
    if (asOffer) {
      setOfferForm(offerGroupFormFromResponse(group.data));
      return;
    }
    setMetaForm(metaGroupFormFromResponse(group.data));
  }, [group.data]);

  async function saveGroup() {
    const ready = editAsOffer
      ? offerGroupReady(offerForm, whatsappAccountCount)
      : metaGroupReady(metaForm, whatsappAccountCount);
    if (!ready) {
      toastStore.getState().show("أكمل الحقول المطلوبة — بما فيها قناة WhatsApp.", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = editAsOffer ? buildOfferGroupPayload(offerForm) : buildMetaGroupPayload(metaForm);
      const response = await api.put<MetaGroupResponse>(
        `/catalog/meta-group/${encodeURIComponent(decodedGroupId)}`,
        payload
      );
      await client.invalidateQueries({ queryKey: ["catalog"] });
      await client.invalidateQueries({ queryKey: ["catalog-variant-groups"] });
      await client.invalidateQueries({ queryKey: ["catalog-meta-group", decodedGroupId] });
      toastStore.getState().show(
        editAsOffer
          ? `تم تحديث ${response.data.variants.length} عرض فرعي.`
          : `تم تحديث ${response.data.variants.length} نسخة.`,
        "success"
      );
      for (const message of metaGroupSyncMessages(response.data)) {
        toastStore.getState().show(message, message.includes("رفض") || message.includes("تعذر") ? "error" : "success");
      }
      if (response.data.meta_item_group_id !== decodedGroupId) {
        navigate(`/catalog/group/${encodeURIComponent(response.data.meta_item_group_id)}/edit`, { replace: true });
        return;
      }
      navigate("/catalog", { replace: true });
    } catch (error: unknown) {
      const detail =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { detail?: string } } }).response?.data?.detail === "string"
          ? (error as { response: { data: { detail: string } } }).response.data.detail
          : null;
      toastStore.getState().show(detail ?? "تعذر تحديث المجموعة.", "error");
    } finally {
      setSaving(false);
    }
  }

  const formReady = editAsOffer
    ? offerGroupReady(offerForm, whatsappAccountCount)
    : metaGroupReady(metaForm, whatsappAccountCount);

  return (
    <main className="page catalog-page contacts-erp-page">
      <section className="contacts-erp-shell contacts-form-shell">
        <header className="contacts-form-topbar">
          <div className="contacts-erp-title-block">
            <Link to="/catalog" className="contacts-back-link">← المنتجات والخدمات</Link>
            <h1>{editAsOffer ? "تعديل عرض" : "تعديل مجموعة Meta"}</h1>
            {decodedGroupId && <p className="hint-text" dir="ltr">{decodedGroupId}</p>}
          </div>
          <div className="contacts-form-topbar-actions">
            <button
              type="button"
              className="contacts-erp-btn contacts-erp-btn-primary"
              disabled={!formReady || saving || group.isLoading}
              onClick={() => void saveGroup()}
            >
              {saving ? "جاري الحفظ…" : editAsOffer ? "حفظ العرض" : "حفظ التعديلات"}
            </button>
            <Link to="/catalog" className="contacts-erp-btn">إلغاء</Link>
          </div>
        </header>

        {group.isLoading && <div className="catalog-panel">جاري التحميل…</div>}
        {group.isError && (
          <div className="catalog-panel contacts-erp-empty">
            <strong>تعذر تحميل المجموعة</strong>
            <button type="button" className="contacts-erp-btn" onClick={() => void group.refetch()}>إعادة المحاولة</button>
          </div>
        )}

        {group.data && (
          <div className="catalog-create-shell catalog-create-shell-single">
            <div className="catalog-create-main">
              {editAsOffer ? (
                <CatalogOfferWizard
                  form={offerForm}
                  setForm={setOfferForm}
                  organizations={organizations.data ?? []}
                  whatsappAccounts={whatsappAccounts.data ?? []}
                  categories={categories.data ?? []}
                  variantGroups={variantGroups.data ?? []}
                  onSubmit={() => void saveGroup()}
                  saving={saving}
                />
              ) : (
                <CatalogMetaProductWizard
                  form={metaForm}
                  setForm={setMetaForm}
                  organizations={organizations.data ?? []}
                  whatsappAccounts={whatsappAccounts.data ?? []}
                  categories={categories.data ?? []}
                  variantGroups={variantGroups.data ?? []}
                  onSubmit={() => void saveGroup()}
                  saving={saving}
                />
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
