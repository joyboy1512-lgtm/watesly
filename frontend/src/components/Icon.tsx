type IconName =
  | "dashboard"
  | "inbox"
  | "team"
  | "organization"
  | "channel"
  | "template"
  | "campaign"
  | "admin"
  | "whatsapp"
  | "search"
  | "bell"
  | "moon"
  | "sun"
  | "menu"
  | "close"
  | "send"
  | "paperclip"
  | "plus";

const paths: Record<IconName, string> = {
  dashboard: "M3 3h7v7H3V3Zm11 0h7v4h-7V3ZM3 14h7v7H3v-7Zm11-3h7v10h-7V11Z",
  inbox: "M3 5h18v14H3V5Zm0 9h5l2 3h4l2-3h5",
  team: "M7 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM1 21v-2a6 6 0 0 1 12 0v2m2 0v-2a5 5 0 0 1 8-4",
  organization: "M4 21V3h12v18M8 7h4M8 11h4M8 15h4m4-6h4v12",
  channel: "M5 12a7 7 0 0 1 7-7m0 14a7 7 0 0 1-7-7m7-3a3 3 0 0 1 3 3m-3 3a3 3 0 0 1 3-3",
  template: "M4 3h16v18H4V3Zm4 4h8M8 11h8M8 15h5",
  campaign: "M3 11v2l12 4V7L3 11Zm12-4 4-2v14l-4-2",
  admin: "M12 3l7 4v5c0 5-3 8-7 9-4-1-7-4-7-9V7l7-4Zm-3 9 2 2 4-4",
  whatsapp: "M20 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.2A8.5 8.5 0 1 1 20 11.5Z",
  search: "m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Zm-8 11h4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z",
  sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M18 6 6 18",
  send: "m22 2-7 20-4-9-9-4 20-7Zm-11 11 5-5",
  paperclip: "m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5L14 2a4 4 0 0 1 5.7 5.7l-9.5 9.5a2 2 0 0 1-2.8-2.8l8.8-8.8",
  plus: "M12 5v14M5 12h14"
};

export default function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
