export const REPLY_VARIABLES = [
  { token: "{{contact.name}}", label: "اسم العميل" },
  { token: "{{contact.phone}}", label: "رقم الهاتف" },
  { token: "{{contact.email}}", label: "البريد" }
] as const;

export function insertReplyVariable(current: string, token: string) {
  return current.trim() ? `${current} ${token}` : token;
}

export type ConversationContext = {
  attribution: {
    source_campaign_id: string | null;
    source_campaign_name: string | null;
    source_tracked_link_id: string | null;
    source_tracked_link_name: string | null;
  };
  knowledge_articles: Array<{
    id: string;
    title: string;
    body: string;
    category: string;
  }>;
  viewers: Array<{ membership_id: string; name: string }>;
  typing: Array<{ membership_id: string; name: string }>;
  suggested_query: string | null;
};
