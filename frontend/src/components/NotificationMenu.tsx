import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { formatAppDateTime } from "../lib/language";
import type { Notification } from "../types/notification";
import Icon from "./Icon";

export default function NotificationMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get<Notification[]>("/notifications")).data,
    refetchInterval: 20000
  });

  const unread = (query.data ?? []).filter((item) => !item.read_at).length;

  async function openNotification(item: Notification) {
    if (!item.read_at) {
      await api.patch(`/notifications/${item.id}/read`);
      client.invalidateQueries({ queryKey: ["notifications"] });
    }

    const conversationId = item.data?.conversation_id;
    if (typeof conversationId === "string") {
      navigate(`/inbox?conversation=${conversationId}`);
      setOpen(false);
    }
  }

  return (
    <div className="notification-menu">
      <button className="icon-button notification-trigger" onClick={() => setOpen(!open)}>
        <Icon name="bell" />
        {unread > 0 && <span>{Math.min(unread, 99)}</span>}
      </button>

      {open && (
        <div className="notification-popover">
          <div className="notification-heading">
            <strong>{t("notifications.title")}</strong>
            <span>{t("notifications.unread", { count: unread })}</span>
          </div>
          <div className="notification-list">
            {(query.data ?? []).length === 0 && <p>{t("notifications.empty")}</p>}
            {(query.data ?? []).map((item) => (
              <button
                key={item.id}
                className={item.read_at ? "" : "unread"}
                onClick={() => openNotification(item)}
              >
                <strong>{item.title}</strong>
                <span>{item.body}</span>
                <small>{formatAppDateTime(item.created_at)}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
