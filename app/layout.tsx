"use client";

// ============================================================
// FILE 2 — app/layout.tsx (Cloudbeds-style shell)
// The app FRAME: white left menu + white top bar, on every page.
// NEW vs the old dark shell:
//  - Light theme (white menu, navy text) like Cloudbeds.
//  - Top bar: hotel switcher (left), pill search (center),
//    round "+" button, bell with a red dot, user avatar (right).
//  - The menu item of the page you are on is highlighted
//    (soft blue) — that is why this file starts with
//    "use client": it needs to know the current URL.
// Naming: files/variables/routes in ENGLISH; labels Vietnamese.
// ============================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import "./globals.css";
import { useEffect, useState, type ReactNode } from "react";
import AuthGate from "@/components/AuthGate";
import UserBox from "@/components/UserBox";
import ChannexOutbox from "@/components/ChannexOutbox";
import { supabase } from "@/lib/supabase";
import { currentHotelId, HOTEL_STORAGE_KEY } from "@/lib/current-hotel";

// Left menu items. To add/remove a menu item, edit only this list.
const MENU = [
  { label: "Tổng quan", href: "/", icon: "⌂" },
  { label: "Khách sạn", href: "/hotels", icon: "🏨" },
  { label: "Lịch phòng", href: "/calendar", icon: "▦" },
  { label: "Đặt phòng", href: "/reservations", icon: "☰" },
  { label: "Lịch giá", href: "/rates", icon: "₫" },
  { label: "Kênh bán", href: "/channels", icon: "⇄" },
  { label: "Báo cáo", href: "/reports", icon: "📊" },
  { label: "Cài đặt", href: "/settings", icon: "⚙" },
];

function HotelSwitcher() {
  const [hotels, setHotels] = useState<{ id: string; name: string }[]>([]);
  const [current, setCurrent] = useState(currentHotelId());
  useEffect(() => {
    supabase
      .from("hotels")
      .select("id, name")
      .order("name")
      .then(({ data }) => {
        if (data && data.length > 0) setHotels(data);
      });
  }, []);
  return (
    <select
      value={current}
      onChange={(e) => {
        window.localStorage.setItem(HOTEL_STORAGE_KEY, e.target.value);
        setCurrent(e.target.value);
        window.location.reload();
      }}
      className="shrink-0 cursor-pointer rounded-lg border border-[#dde3ea] bg-white px-2 py-1.5 text-sm font-semibold text-[#17293e]"
      title="Đổi khách sạn"
    >
      {hotels.length === 0 && <option value={current}>{current}</option>}
      {hotels.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
        </option>
      ))}
    </select>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // A menu item is "active" when the current URL starts with its href.
  // ("/" is special: it must match exactly, or everything would match.)
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // The login page stands alone — no shell, no gate.
  if (pathname === "/login") {
    return (
      <html lang="vi">
        <body>{children}</body>
      </html>
    );
  }

  return (
    <html lang="vi">
      <body>
        <AuthGate>
        <div className="flex min-h-screen">
          {/* ============ LEFT MENU (white) ============ */}
          <aside className="flex w-60 shrink-0 flex-col border-r border-[#dde3ea] bg-white">
            <div className="flex items-center gap-2.5 border-b border-[#eef1f5] px-5 py-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2563eb] text-base font-bold text-white">
                P
              </div>
              <div>
                <div className="text-[15px] font-bold leading-tight text-[#17293e]">
                  PMS Hotel
                </div>
                <div className="text-[11px] leading-tight text-[#68707a]">
                  Quản lí khách sạn
                </div>
              </div>
            </div>

            <nav className="flex-1 space-y-1 px-3 py-4">
              {MENU.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    isActive(item.href)
                      ? "flex items-center gap-3 rounded-lg bg-[#e8effe] px-3 py-2 text-sm font-semibold text-[#2563eb]"
                      : "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#17293e] hover:bg-[#f4f7fb]"
                  }
                >
                  <span className="w-5 text-center">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </nav>

            <UserBox />
          </aside>

          {/* ============ RIGHT COLUMN: top bar + page content ============ */}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-4 border-b border-[#dde3ea] bg-white px-6 py-3">
              <HotelSwitcher />

              {/* Pill search, centered like Cloudbeds */}
              <div className="flex flex-1 justify-center">
                <input
                  className="cb-input-pill w-full max-w-xl px-4 py-2 text-sm"
                  placeholder="Tìm đặt phòng, khách, và hơn nữa..."
                />
              </div>

              {/* Round "+" create button */}
              <button
                className="cb-btn-primary flex h-9 w-9 shrink-0 items-center justify-center text-lg leading-none"
                title="Tạo đặt phòng mới"
              >
                +
              </button>

              {/* Bell with red dot */}
              <button className="relative shrink-0 text-xl" title="Thông báo">
                🔔
                <span className="cb-dot absolute right-0 top-0 h-2.5 w-2.5 border-2 border-white" />
              </button>
            </header>

            <main className="flex-1 p-6">{children}</main>
          </div>
        </div>
        <ChannexOutbox />
        </AuthGate>
      </body>
    </html>
  );
}
