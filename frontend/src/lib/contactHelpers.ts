import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";

export type Organization = { id: string; name: string };
export type Channel = { id: string; name: string; type: string; organization_id: string };
export type Tag = { id: string; name: string };
export type ContactGender = "male" | "female" | "unknown";
export type Contact = {
  id: string;
  organization_id: string;
  channel_id: string;
  external_address: string;
  display_name: string | null;
  email: string | null;
  language: string | null;
  country_code: string | null;
  gender: ContactGender;
  marketing_opt_in?: boolean;
  created_at: string;
  updated_at?: string;
};

export type ContactStats = {
  total: number;
  new_this_week: number;
  without_name: number;
  inactive_30d: number;
};

export type ContactActivity = {
  last_message_text: string | null;
  last_message_at: string | null;
  last_message_direction: string | null;
  conversations: Array<{
    id: string;
    status: string;
    last_message_at: string | null;
    is_blocked: boolean;
  }>;
  notes: Array<{
    id: string;
    conversation_id: string;
    body: string;
    created_at: string | null;
  }>;
  primary_conversation_id: string | null;
  is_blocked: boolean;
};

export type ContactCustomFieldValue = {
  id: string;
  definition_id: string;
  entity_id: string;
  value_text: string;
};

export type SegmentWithCount = { id: string; name: string; count?: number };

export const CONTACTS_PAGE_SIZE = 25;
/** Must match backend GET /contacts limit validation (le=500). */
export const CONTACTS_LIST_LIMIT = 500;

export function mergeContactIntoList(contacts: Contact[], contact: Contact): Contact[] {
  const index = contacts.findIndex((item) => item.id === contact.id);
  if (index >= 0) {
    const next = contacts.slice();
    next[index] = contact;
    return next;
  }
  return [contact, ...contacts];
}

/** Prepend/merge a contact into all contacts list caches, then refetch from server. */
export async function refreshContactsAfterMutation(client: QueryClient, contact?: Contact) {
  if (contact) {
    client.setQueriesData<Contact[]>({ queryKey: ["contacts"] }, (current) =>
      mergeContactIntoList(current ?? [], contact)
    );
  }
  await client.refetchQueries({ queryKey: ["contacts"] });
}

export async function downloadContactsExport(contactIds?: string[]) {
  const params: Record<string, string> = { format: "xlsx" };
  if (contactIds?.length) params.ids = contactIds.join(",");
  const response = await api.get("/contacts/export", { params, responseType: "arraybuffer" });
  const filename = contactIds?.length ? "contacts-selected.xlsx" : "contacts.xlsx";
  triggerXlsxDownload(response.data as ArrayBuffer, filename);
}

function triggerXlsxDownload(content: ArrayBuffer, filename: string) {
  const blob = new Blob([content], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function tagChipColor(name: string) {
  const palette = [
    { bg: "#fff4e5", text: "#b54708", border: "#fedf89" },
    { bg: "#ecfdf3", text: "#067647", border: "#abefc6" },
    { bg: "#eff8ff", text: "#175cd3", border: "#b2ddff" },
    { bg: "#fdf2fa", text: "#c11574", border: "#fcceee" },
    { bg: "#f4f3ff", text: "#5925dc", border: "#d9d6fe" }
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash + name.charCodeAt(i) * (i + 1)) % palette.length;
  return palette[hash];
}

export function formatContactDate(value: string) {
  return new Intl.DateTimeFormat("ar", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

const OPTIONAL_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isOptionalEmailValid(value: string) {
  const trimmed = value.trim();
  return !trimmed || OPTIONAL_EMAIL_PATTERN.test(trimmed);
}

export function isCountryCodeValid(value: string) {
  const trimmed = value.trim();
  return !trimmed || trimmed.length === 2;
}

export function buildContactCreatePayload(input: {
  organizationId: string;
  channelId: string;
  phone: string;
  name: string;
  email: string;
  language: string;
  countryCode: string;
}) {
  const trimmedEmail = input.email.trim();
  const trimmedCountry = input.countryCode.trim();
  return {
    organization_id: input.organizationId,
    channel_id: input.channelId,
    external_address: input.phone.trim(),
    display_name: input.name.trim(),
    email: trimmedEmail || null,
    language: input.language.trim() || null,
    country_code: trimmedCountry ? trimmedCountry.toUpperCase() : null
  };
}

export function contactDisplayLabel(
  contact: Pick<Contact, "display_name" | "external_address">
): string {
  const name = contact.display_name?.trim();
  if (name) return name;
  return contact.external_address.trim();
}

export function contactInitials(name: string | null, phone: string) {
  const source = (name || phone).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

const MALE_PREVIEW = new Set([
  "mohammed", "mohammad", "muhammad", "mohamed", "ahmed", "ahmad", "ali", "omar", "khalid", "saud",
  "faisal", "fahad", "turki", "yousef", "abdullah", "john", "james", "michael", "david",
  "محمد", "احمد", "أحمد", "علي", "عمر", "خالد", "سعود", "فيصل", "فهد", "يوسف", "عبدالله"
]);
const FEMALE_PREVIEW = new Set([
  "fatima", "maryam", "mariam", "sara", "sarah", "noura", "nora", "layla", "reem", "rana",
  "mona", "nada", "salma", "yasmin", "yasmine", "zainab", "mary", "jennifer", "emma",
  "فاطمة", "مريم", "سارة", "نورة", "ليلى", "ريم", "منى", "نور", "سلمى", "ياسمين", "زينب"
]);

function previewFirstName(name: string) {
  const part = name.trim().split(/\s+/).find(Boolean);
  if (!part) return "";
  let token = part.toLowerCase().replace(/^ال/, "");
  token = token.replace(/[^\w\u0600-\u06FF]/g, "");
  return token;
}

export function inferGenderPreview(name: string): ContactGender {
  const first = previewFirstName(name);
  if (!first) return "unknown";
  if (MALE_PREVIEW.has(first)) return "male";
  if (FEMALE_PREVIEW.has(first)) return "female";
  return "unknown";
}

export function formatGenderLabel(gender: ContactGender | null | undefined) {
  if (gender === "male") return "ذكر";
  if (gender === "female") return "أنثى";
  return "—";
}

export function formatGenderSalutation(gender: ContactGender | null | undefined) {
  if (gender === "male") return "سيد";
  if (gender === "female") return "سيدة";
  return "—";
}

export async function downloadContactsImportTemplate() {
  const response = await api.get("/contacts/export-template", { responseType: "arraybuffer" });
  triggerXlsxDownload(response.data as ArrayBuffer, "contacts-import-template.xlsx");
}

export async function openContactConversation(contactId: string): Promise<string> {
  const response = await api.post<{ conversation_id: string }>(`/contacts/${contactId}/conversation`);
  return response.data.conversation_id;
}

export async function exportContactGdprJson(contactId: string, displayName?: string | null) {
  const response = await api.get(`/contacts/${contactId}/export-data`, { responseType: "json" });
  const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `contact-${displayName?.trim() || contactId}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
