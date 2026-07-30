import { api } from "./api";

export type UploadedFile = {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number;
  object_key: string;
  public_url: string;
};

export async function uploadFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);

  const response = await api.post<UploadedFile>("/uploads", form, {
    headers: { "Content-Type": "multipart/form-data" }
  });
  return response.data;
}
