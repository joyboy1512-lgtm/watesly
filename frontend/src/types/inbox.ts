export type Tag = {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
};

export type Note = {
  id: string;
  conversation_id: string;
  user_id: string;
  body: string;
  kind?: "note" | "whisper";
  author_name?: string | null;
  is_internal?: boolean;
  created_at: string;
};
