export function formatWindowExpiry(expiresAt: string | null | undefined): string {
  if (!expiresAt) return "";
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return "منتهية";
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 0) return `${hours}س ${minutes}د`;
  return `${minutes} دقيقة`;
}

export function normalizePhoneForWaMe(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export function buildWaMeLink(phone: string, message?: string): string {
  const digits = normalizePhoneForWaMe(phone);
  const base = `https://wa.me/${digits}`;
  if (!message?.trim()) return base;
  return `${base}?text=${encodeURIComponent(message.trim())}`;
}

export function qrCodeUrl(link: string, size = 220): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(link)}`;
}
