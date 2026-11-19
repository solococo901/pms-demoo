"use client";

// ============================================================
// FILE CBLAYOUT5 — app/layout.tsx (Cloudbeds-style shell)
// CBLAYOUT5 (2026-11-17): logo PMS Hotel van chi hien 1 lan,
// nhung chuyen cho: mo menu thi logo nam o dau aside, dong
// menu thi logo o thanh tren (thanh tren an logo khi menu mo).
// Ban CBLAYOUT4 de dau aside chi co nut X, trong trong nen xau.
// The app FRAME, rebuilt to Cloudbeds' official layout
// (2026-11-17, Vos approved the demo): NO permanent sidebar.
// Fixed white top bar: hamburger, logo, hotel switcher,
// search pill, "+" new booking, bell, user menu.
// CBLAYOUT3 (2026-11-17): the menu is a PUSH sidebar —
// when it opens, the whole frame (top bar + content) slides
// right instead of the menu covering the content; closing it
// slides everything back. No backdrop/overlay anymore.
// (Cloudbeds itself uses an overlay menu; Vos asked for
// push instead.)
// KEPT from the old shell (MENU1/ASIDE1) — only the frame
// changed, no page lost a feature:
//  - MENU order = Vos's own order (Thiet lap khach san 1-7,
//    Van hanh, Quan li) — NOT Cloudbeds' menu order.
//  - Role blocking (staff sees Operations only) + ADMIN_ROUTES.
//  - Hotel from URL segment 1, mirrored to sessionStorage;
//    bounce to "/" when no hotel is stored.
//  - AuthGate, ChannexOutbox, login page bare, "/" list bare.
// CHANGED vs CBLAYOUT2:
//  - Aside is a flex sibling of the content column (its width
//    animates 0 <-> 18rem); top bar + main live inside the
//    content column, so they shift with it. Aside header height
//    matches the top bar (py-2.5) so the two sit level.
//  - Hamburger toggles (open/close); a menu item click still
//    navigates + closes the menu; X button closes it.
//  - "+" button opens the staff New Reservation wizard.
//  - Calendar + Reservations shortcut buttons sit on the top bar (Cloudbeds style).
//  - HotelSwitcher + UserBox restyled for the white top bar.
// Next.js 16 notes (do NOT "simplify" these away):
//  - usePathname() only runs inside <Shell>, BELOW the <Suspense>
//    boundary in RootLayout. Calling it directly in RootLayout
//    blocks prerendering ("Blocking Route" error in dev).
//  - HotelSwitcher reads sessionStorage only AFTER mount (effect),
//    so the first render matches the server ("cityhouse-mark").
//    Reading it in useState would cause a hydration mismatch
//    whenever another hotel was stored.
// Naming: files/variables/routes in ENGLISH; labels Vietnamese.
// ============================================================

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import "./globals.css";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import AuthGate from "@/components/AuthGate";
import UserBox from "@/components/UserBox";
import ChannexOutbox from "@/components/ChannexOutbox";
import { IconBed, IconBell, IconCalendar, IconPlus } from "@/components/icons";
import { supabase } from "@/lib/supabase";
import { currentHotelId, DEFAULT_HOTEL_ID, HOTEL_STORAGE_KEY } from "@/lib/current-hotel";
import { useCurrentRole } from "@/lib/current-role";

// Left menu items. To add/remove a menu item, edit only this list.
// adminOnly = chi quan tri vien thay (nhan vien bi an + chan duong dan).
// group = tieu de nhom hien tren menu; thu tu nhom theo MENU_GROUPS.
// THU TU MENU = flow thiet lap khach san moi (MENU1, 2026-11-10):
// nhom "Thiet lap khach san" (7 buoc danh so, chi admin) len dau —
// vao khach san moi thi di tu buoc 1 xuong buoc 7 la xong phan dung;
// roi moi den Van hanh (dung hang ngay) va Quan li. Tao khach san
// thi lam o trang Danh sach (nut "+ Them khach san"), khong nam
// trong menu nay.
const MENU = [
  { label: "1. Thông tin chung", href: "/hotel-info", icon: "hotel", group: "Thiết lập khách sạn", adminOnly: true },
  { label: "2. Thư viện ảnh", href: "/hotel-photos", icon: "image", group: "Thiết lập khách sạn", adminOnly: true },
  { label: "3. Cấu hình khách sạn", href: "/hotel-config", icon: "tune", group: "Thiết lập khách sạn", adminOnly: true },
  { label: "4. Thông tin loại phòng", href: "/room-types", icon: "bed", group: "Thiết lập khách sạn", adminOnly: true },
  { label: "5. Kênh bán", href: "/channels", icon: "channels", group: "Thiết lập khách sạn", adminOnly: true },
  { label: "6. Lịch giá", href: "/rates", icon: "rates", group: "Thiết lập khách sạn", adminOnly: true },
  { label: "7. Chặn phòng & Đóng bán", href: "/inventory", icon: "archive", group: "Thiết lập khách sạn", adminOnly: true },
  { label: "Tổng quan", href: "/dashboard", icon: "dashboard", group: "Vận hành" },
  { label: "Lịch phòng", href: "/calendar", icon: "calendar", group: "Vận hành" },
  { label: "Đặt phòng", href: "/reservations", icon: "reservations", group: "Vận hành" },
  { label: "Báo cáo", href: "/reports", icon: "reports", group: "Quản lí", adminOnly: true },
  { label: "Cài đặt", href: "/settings", icon: "settings", group: "Quản lí", adminOnly: true },
  { label: "Người dùng", href: "/settings/users", icon: "user", group: "Quản lí", adminOnly: true },
];
const MENU_GROUPS = ["Thiết lập khách sạn", "Vận hành", "Quản lí"];

// Icon net don (stroke) cho menu — thay cho ky tu unicode/emoji cu
// (⌂ 🏨 ▦...) hien khong deu tuy font. Them muc menu: them 1 dong vao
// MENU + 1 duong path vao ICONS.
const ICONS: Record<string, string> = {
  dashboard: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  hotel: "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6M9 11h.01M15 11h.01",
  calendar: "M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18",
  reservations: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  rates: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.82 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01",
  channels: "M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
  reports: "M12 20V10M18 20V4M6 20v-6",
  settings: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  tune: "M4 8h10M18 8h4M4 16h4M12 16h10M14 8a2 2 0 1 0 0-0.01M8 16a2 2 0 1 0 0-0.01",
  bed: "M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18h18M5 21v-3M19 21v-3",
  image: "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8.5 10a1.5 1.5 0 1 0 0-0.01M21 15l-5-5L5 21",
  layers: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  archive: "M21 8v13H3V8M1 3h22v5H1zM10 12h4",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
};
function MenuIcon({ name }: { name: string }) {
  return (
    <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.dashboard} />
    </svg>
  );
}

// Cac duong dan chi admin duoc vao (staff go thang cung bi chan).
// "/hotels/" (co dau / cuoi) chi chan trang con /hotels/[id] — trang
// danh sach /hotels mo cho ca nhan vien de chon khach san lam viec.
const ADMIN_ROUTES = ["/hotels/", "/rates", "/channels", "/reports", "/settings"];


function HotelSwitcher() {
  const [hotels, setHotels] = useState<{ id: string; name: string }[]>([]);
  const pathname = usePathname();
  // Ten khach san doc thang tu URL (doan dau tien), tru cac duong dan he
  // thong — de nut chon luon hien dung khach san cua URL hien tai.
  // Trang cu /hotels/[id]... thi ma la doan thu hai.
  const seg = (pathname ?? "").split("/");
  const urlHotel = seg[1] && !["hotels", "login", "booking"].includes(seg[1]) ? seg[1] : undefined;
  const detailHotel = seg[1] === "hotels" && seg[2] ? seg[2] : undefined;
  const pageHotel = urlHotel ?? detailHotel;
  // Khoi tao bang gia tri mac dinh (giong phia server), roi moi doc
  // khach san da luu sau khi mount — tranh hydration mismatch.
  const [current, setCurrent] = useState(DEFAULT_HOTEL_ID);
  useEffect(() => {
    setCurrent(currentHotelId());
  }, []);
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
      value={pageHotel ?? current}
      onChange={(e) => {
        const next = e.target.value;
        window.sessionStorage.setItem(HOTEL_STORAGE_KEY, next);
        setCurrent(next);
        // Doi khach san thi luon ve trang Tong quan cua khach san moi
        // truoc (nap lai toan bo de moi module doc lai khach san).
        // (Truoc day giu nguyen trang dang mo — vd dang o Lich phong
        // thi sang Lich phong cua khach san moi — anh muon ve Tong
        // quan truoc.)
        if (urlHotel || detailHotel) {
          window.location.href = `/${next}/dashboard`;
        } else {
          window.location.reload();
        }
      }}
      className="shrink-0 cursor-pointer rounded-lg border border-[var(--cb-border)] bg-white px-2 py-1.5 text-sm font-semibold text-[var(--cb-text)]"
      title="Đổi khách sạn"
    >
      {hotels.length === 0 && <option value={pageHotel ?? current}>{pageHotel ?? current}</option>}
      {hotels.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
        </option>
      ))}
    </select>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center text-sm text-[var(--cb-muted)]">
              Đang tải...
            </div>
          }
        >
          <Shell>{children}</Shell>
        </Suspense>
      </body>
    </html>
  );
}

// Shell that needs the current URL + role — must stay BELOW the
// <Suspense> boundary above, never moved back into RootLayout.
function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const role = useCurrentRole();

  // Khach san cua khu lam viec: doc thang tu URL (doan dau tien), khong
  // qua useParams vi khung goc khong chac nhan duoc tham so cua doan
  // con. Khi o /<ten-khach-san>, ma tren URL la nguon dung that — dong
  // bo vao bo nho tab ngay trong lan ve (truoc khi cac trang con ve) de
  // moi cho doc bo nho tab cung thay dung khach san. O trang quan li
  // /hotels/[id] thi ma la doan thu hai; o noi khac thi dung gia tri
  // da luu theo tab.
  const seg = (pathname ?? "").split("/");
  const urlHotel = seg[1] && !["hotels", "login", "booking"].includes(seg[1]) ? seg[1] : undefined;
  const detailHotel = seg[1] === "hotels" && seg[2] ? seg[2] : undefined;
  const pageHotel = urlHotel ?? detailHotel;
  const [storedHotel, setStoredHotel] = useState(DEFAULT_HOTEL_ID);
  useEffect(() => {
    setStoredHotel(currentHotelId());
  }, []);
  if (
    typeof window !== "undefined" &&
    pageHotel &&
    window.sessionStorage.getItem(HOTEL_STORAGE_KEY) !== pageHotel
  ) {
    window.sessionStorage.setItem(HOTEL_STORAGE_KEY, pageHotel);
  }
  const menuHotel = urlHotel ?? detailHotel ?? storedHotel;

  // Chua chon khach san nao thi day ve danh sach (trang danh sach
  // /hotels va login duoc mien). Chi chay sau khi mount nen khong
  // anh huong lan ve dau; chon xong thi sessionStorage da co gia
  // tri nen khong bi day lai.
  useEffect(() => {
    if (
      pathname !== "/" &&
      pathname !== "/hotels" &&
      pathname !== "/login" &&
      !window.sessionStorage.getItem(HOTEL_STORAGE_KEY)
    ) {
      router.replace("/");
    }
  }, [pathname, router]);

  // A menu item is "active" when the current URL starts with its href.
  // ("/" is special: it must match exactly, or everything would match.)
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : (pathname ?? "").startsWith(href);

  // Menu luon tro toi khu lam viec /<ten-khach-san>/... cua khach san hien
  // tai (trang danh sach "/" giu nguyen). MENU goc giu duong dan dang
  // "/dashboard", "/calendar"... de de sua; o day moi ghep ten khach san
  // vao dau duong dan.
  const menuItems = MENU.map((i) => ({
    ...i,
    href: i.href === "/" ? "/" : `/${menuHotel}${i.href}`,
  }));
  const visibleMenu = menuItems.filter((i) => !("adminOnly" in i && i.adminOnly) || role === "admin");
  // Chan staff o ca 2 dang duong dan: khu lam viec /<ten-khach-san>/<muc>
  // (xet muc thu 2 cua duong dan) va dang cu /hotels/[id] (xet tien to).
  const wsSub = urlHotel ? (pathname ?? "").split("/")[2] : undefined;
  const blockedForStaff =
    role === "staff" &&
    (wsSub
      ? ["rates", "channels", "reports", "settings", "hotel-info", "hotel-config", "hotel-photos", "room-types", "rate-plans", "inventory"].includes(wsSub)
      : ADMIN_ROUTES.some((r) => (pathname ?? "").startsWith(r)));

  // Dropdown menu: moi nhom tu dong/mo doc lap — an tieu de thi mo,
  // an them lan nua thi dong, khong tu dong dong nhom khac, khong
  // reset khi chuyen trang. Mac dinh mo tat ca (nhu ban cu).
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(MENU_GROUPS));
  const toggleGroup = (group: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  // Menu day (push): nut ☰ mo/dong, nut X dong, bam 1 muc menu thi
  // chuyen trang + dong menu. Menu la 1 cot flex nam canh cot noi
  // dung — mo ra thi noi dung dich sang phai, dong thi dich ve.
  const [menuOpen, setMenuOpen] = useState(false);

  // The login page stands alone — no shell, no gate.
  if (pathname === "/login") {
    return <>{children}</>;
  }

  // Trang danh sach /hotels (va cua vao /) dung rieng, khong khung
  // app (thanh tren, menu day) — nhung van qua cong kiem tra dang
  // nhap. Khong kem ChannexOutbox: chip trang thai dong bo la phan
  // cua khung app, khong thuoc trang nay.
  if (pathname === "/" || pathname === "/hotels") {
    return (
      <AuthGate>
        <main className="mx-auto min-h-screen w-[80%] bg-[var(--cb-bg)] p-6">{children}</main>
      </AuthGate>
    );
  }


  return (
    <AuthGate>
      <div className="flex min-h-screen bg-[var(--cb-bg)]">
        {/* ============ ASIDE (push: mo thi day noi dung sang phai) ============ */}
        <aside
          className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden border-r border-[var(--cb-border)] bg-white transition-all duration-300 ease-in-out ${menuOpen ? "w-72" : "w-0 border-r-0"}`}
        >
          <div className="flex w-72 shrink-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-[var(--cb-border)] px-5 py-2.5">
              <Link
                href="/hotels"
                onClick={() => setMenuOpen(false)}
                title="Về danh sách khách sạn"
                className="flex items-center gap-2.5"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--cb-blue)] text-base font-bold text-white">
                  P
                </div>
                <div className="text-[15px] font-bold leading-tight text-[var(--cb-text)]">
                  PMS Hotel
                </div>
              </Link>
              <button
                onClick={() => setMenuOpen(false)}
                title="Đóng menu"
                aria-label="Đóng menu"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--cb-text)] hover:bg-[#f5f7fb]"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3">
              {role !== null && MENU_GROUPS.map((group) => {
                const items = visibleMenu.filter((i) => i.group === group);
                if (items.length === 0) return null;
                const open = openGroups.has(group);
                return (
                  <div key={group} className="mb-1">
                    <button
                      onClick={() => toggleGroup(group)}
                      aria-expanded={open}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--cb-muted)] hover:bg-[#f5f7fb]"
                    >
                      <span>{group}</span>
                      <svg className={`h-4 w-4 shrink-0 transition-transform ${open ? "" : "rotate-180"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M6 15l6-6 6 6" />
                      </svg>
                    </button>
                    {open && (
                      <div className="space-y-1">
                      {items.map((item) => {
                        const active = isActive(item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMenuOpen(false)}
                            aria-current={active ? "page" : undefined}
                            className={
                              active
                                ? "relative flex items-center gap-3 rounded-lg bg-[var(--cb-blue-soft)] px-3 py-2 text-sm font-semibold text-[var(--cb-blue)] before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-[var(--cb-blue)]"
                                : "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--cb-text)] hover:bg-[#f5f7fb]"
                            }
                          >
                            <MenuIcon name={item.icon} />
                            {item.label}
                          </Link>
                        );
                      })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>

            <div className="border-t border-[var(--cb-border)] px-5 py-3 text-xs text-[var(--cb-muted)]">
              cityhousePMS — {menuHotel || "Chưa chọn khách sạn"}
            </div>
          </div>
        </aside>

        {/* ============ CONTENT COLUMN (dich theo aside) ============ */}
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          {/* ============ TOP BAR (white, sticky) ============ */}
          <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-[var(--cb-border)] bg-white px-4 py-2.5">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              title="Mở/đóng menu"
              aria-label="Mở/đóng menu"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--cb-text)] hover:bg-[#f5f7fb]"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            {!menuOpen && (
            <Link href="/hotels" title="Về danh sách khách sạn" className="flex shrink-0 items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--cb-blue)] text-base font-bold text-white">
                P
              </div>
              <div className="hidden sm:block">
                <div className="text-[15px] font-bold leading-tight text-[var(--cb-text)]">
                  PMS Hotel
                </div>
                <div className="text-[11px] leading-tight text-[var(--cb-muted)]">
                  Quản lí khách sạn
                </div>
              </div>
            </Link>)}

            <HotelSwitcher />

            {/* Pill search, centered like Cloudbeds (desktop only) */}
            <div className="hidden flex-1 justify-center md:flex">
              <input
                className="cb-input-pill w-full max-w-xl px-4 py-2 text-sm"
                placeholder="Tìm đặt phòng, khách, và hơn nữa..."
              />
            </div>

            {/* Round "+" create button — opens the staff New Reservation wizard (Cloudbeds style) */}
            <Link
              href={menuHotel ? `/${menuHotel}/reservations/new` : "/"}
              className="cb-btn-primary flex h-9 w-9 shrink-0 items-center justify-center"
              title="Tạo đặt phòng mới"
            >
              <IconPlus className="h-5 w-5" />
            </Link>

            {/* Calendar + Reservations shortcuts on the top bar (Cloudbeds style) */}
            <Link
              href={menuHotel ? `/${menuHotel}/calendar` : "/"}
              title="Lịch phòng"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${pathname?.endsWith("/calendar") ? "bg-[var(--cb-blue-soft)] text-[var(--cb-blue)]" : "text-[var(--cb-text)] hover:bg-[var(--cb-bg)]"}`}
            >
              <IconCalendar className="h-5 w-5" />
            </Link>
            <Link
              href={menuHotel ? `/${menuHotel}/reservations` : "/"}
              title="Đặt phòng"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${pathname?.endsWith("/reservations") ? "bg-[var(--cb-blue-soft)] text-[var(--cb-blue)]" : "text-[var(--cb-text)] hover:bg-[var(--cb-bg)]"}`}
            >
              <IconBed className="h-5 w-5" />
            </Link>

            {/* Bell with red dot */}
            <button className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--cb-text)] hover:bg-[var(--cb-bg)]" title="Thông báo">
              <IconBell className="h-5 w-5" />
              <span className="cb-dot absolute right-1 top-1 h-2.5 w-2.5 border-2 border-white" />
            </button>

            <UserBox />
          </header>

          <main className="flex-1 p-6">
            <div className="mx-auto w-[80%]">
              {blockedForStaff ? (
                <div className="cb-card mx-auto mt-10 max-w-md p-6 text-center">
                  <div className="text-base font-bold text-[var(--cb-text)]">Trang dành cho quản trị viên</div>
                  <p className="mt-2 text-sm text-[var(--cb-muted)]">
                    Tài khoản nhân viên chỉ dùng được Tổng quan, Lịch phòng, Đặt phòng
                    và danh sách Khách sạn.
                    Nếu bạn cần quyền quản trị, hãy nhờ quản trị viên cấp lại vai trò.
                  </p>
                  <Link href={`/${menuHotel}/calendar`} className="cb-btn-primary mt-4 inline-block px-4 py-2 text-sm">
                    Về Lịch phòng
                  </Link>
                </div>
              ) : (
                children
              )}
            </div>
          </main>
        </div>
      </div>
      <ChannexOutbox />
    </AuthGate>
  );
}
