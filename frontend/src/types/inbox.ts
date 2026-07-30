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
  created_at: string;
};
