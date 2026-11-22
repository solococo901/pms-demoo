"use client";
// PRICE4 — components/NewReservationWizard.tsx (Tao don 5 buoc)
// Chon goi chuan nhu luoi gia: goi goc room_only truoc, roi goi suy ra theo cong thuc kenh.
// Buoc 1 them tung phong vao gio (moi phong = 1 don rieng); buoc 2-4 xac nhan, khach, dich vu them; buoc 5 Payment chua lam.
// Doi sang token toi gian 2026-11-21; moi buoc kiem tra qua lib/booking-rules.ts truoc khi luu.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { queueChannexDates, stayDates } from "@/lib/channex-outbox";
import {
  CHANNELS,
  CHANNEL_FORMULA,
  getChannelName,
  type InventoryBlock,
  type RatePlan,
  type Reservation,
  type Room,
  type RoomBlock,
  type RoomType,
} from "@/lib/mock-data";
import {
  fittingRooms,
  nightsBetween,
  priceBreakdown,
  roomFits,
  roomsLeftRange,
  validateCreate,
  type AvailabilityData,
  type PriceBreakdown,
} from "@/lib/booking-rules";
import { DatePicker } from "@/components/DatePicker";
import { IconBed, IconCalendar, IconCheck, IconSearch } from "@/components/icons";

type WizardProps = {
  hotelId: string;
  accountId: string;
  currency: string;
  roomTypes: RoomType[];
  rooms: Room[];
  ratePlans: RatePlan[];
  reservations: Reservation[];
  roomBlocks: RoomBlock[];
  invBlocks: InventoryBlock[];
  priceOverrides: Record<string, number>;
};

// 1 phong trong gio = 1 don se tao (moi don 1 ma rieng).
type CartItem = {
  key: string;
  roomTypeId: string;
  planId: string;
  adults: number;
  children: number;
  roomNumber: string;
  status: "confirmed" | "pending";
};

type AddOn = { id: string; name: string; basis: "night" | "stay"; qty: number; unitPrice: number };

const ADDON_NAMES = ["Ăn sáng", "Giường phụ", "Đưa đón sân bay", "Trả phòng muộn"];

const STEPS = [
  { n: 1, label: "Availability" },
  { n: 2, label: "Details" },
  { n: 3, label: "Guests" },
  { n: 4, label: "Add-ons" },
  { n: 5, label: "Payment" },
];

const newCode = () =>
  Array.from({ length: 10 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmtDate = (d: string) => d.split("-").reverse().join("/");

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

export default function NewReservationWizard({
  hotelId,
  accountId,
  currency,
  roomTypes,
  rooms,
  ratePlans,
  reservations,
  roomBlocks,
  invBlocks,
  priceOverrides,
}: WizardProps) {
  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);
  const [todayStr, setTodayStr] = useState("");
  const [source, setSource] = useState("frontdesk");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [searched, setSearched] = useState(false);
  // So khach rieng tung dong loai phong o buoc 1 (mac dinh = so khach o form tim).
  const [rowGuests, setRowGuests] = useState<Record<string, { adults: number; children: number }>>({});
  const [cart, setCart] = useState<CartItem[]>([]);
  const [note, setNote] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdCodes, setCreatedCodes] = useState<string[]>([]);

  // Ngay hom nay that theo gio dia phuong (tinh o client, sau khi mount).
  useEffect(() => {
    const t = localToday();
    setTodayStr(t);
    setCheckIn(t);
    setCheckOut(addDays(t, 1));
  }, []);

  const nights = nightsBetween(checkIn, checkOut);
  const money = (n: number) =>
    currency === "USD"
      ? `$${Math.round(n).toLocaleString("en-US")}`
      : `${Math.round(n).toLocaleString("vi-VN")}₫`;

  const avail: AvailabilityData = useMemo(
    () => ({ rooms, reservations, blocks: roomBlocks, invBlocks }),
    [rooms, reservations, roomBlocks, invBlocks],
  );

  const plansFor = (channelCode: string, roomTypeId: string) =>
    ratePlans.filter((p) => p.channelCode === channelCode && p.roomTypeId === roomTypeId);

  const standardPlanFor = (channelCode: string, roomTypeId: string) => {
    const list = plansFor(channelCode, roomTypeId);
    return (
      list.find((p) => !p.derivedFromId && p.mealPlan === "room_only") ??
      // Goi suy ra chuan: ke thua tu gia Website theo cong thuc cua kenh.
      list.find((p) => p.derivedFromId && p.formulaId === CHANNEL_FORMULA[channelCode]) ??
      list.find((p) => p.derivedFromId) ??
      list[0]
    );
  };

  // ---------- buoc 1: cac loai phong tim duoc ----------
  const offers = useMemo(() => {
    if (!searched || nights <= 0) return [];
    return roomTypes
      .filter((t) => t.active !== false)
      .map((t) => {
        const plan = standardPlanFor(source, t.id);
        const left = roomsLeftRange(avail, t.id, checkIn, checkOut, source);
        const g = rowGuests[t.id] ?? { adults, children };
        const bd = plan
          ? priceBreakdown(plan, ratePlans, checkIn, checkOut, g.adults, g.children, priceOverrides)
          : null;
        return { type: t, plan, left: left.minLeft, worstDate: left.worstDate, bd, guests: g };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, nights, roomTypes, source, checkIn, checkOut, adults, children, rowGuests, avail, ratePlans, priceOverrides]);

  // Gia cua 1 phong trong gio (tinh lai theo ngay/so khach hien tai).
  const breakdownFor = (item: CartItem): PriceBreakdown | null => {
    const plan = ratePlans.find((p) => p.id === item.planId);
    if (!plan) return null;
    return priceBreakdown(plan, ratePlans, checkIn, checkOut, item.adults, item.children, priceOverrides);
  };

  const addonAmount = (a: AddOn) => a.unitPrice * a.qty * (a.basis === "night" ? Math.max(nights, 0) : 1);
  const addonLabel = (a: AddOn) =>
    `${a.name} — ${a.qty} × ${a.basis === "night" ? `${Math.max(nights, 0)} đêm` : "lượt"}`;
  const addOnsTotal = addOns.reduce((s, a) => s + addonAmount(a), 0);
  const cartRoomSum = cart.reduce((s, item) => {
    const bd = breakdownFor(item);
    return s + (bd ? bd.roomTotal + bd.feesTotal : 0);
  }, 0);
  const addOnsAll = addOnsTotal * cart.length; // dich vu them ap dung cho moi don
  const subtotal = cartRoomSum + addOnsAll;
  const grandTotal = subtotal;
  const balanceDue = grandTotal; // chua thu tien — thu o buoc Payment (sau) hoac tai quay

  function goTo(n: number) {
    if (n <= maxStep && n <= 4) {
      setStep(n);
      setError("");
    }
  }

  function runSearch() {
    if (!checkIn || !checkOut) return setError("Chọn ngày đến / ngày đi.");
    if (nightsBetween(checkIn, checkOut) <= 0) return setError("Ngày đi phải sau ngày đến.");
    if (todayStr && checkIn < todayStr) return setError("Ngày đến đã qua — không đặt được đơn vào ngày quá khứ.");
    if (adults < 1) return setError("Phải có ít nhất 1 người lớn.");
    setError("");
    setSearched(true);
  }

  // Doi nguon/ngay thi gio cu khong con dung (gia + ton theo ngay/nguon moi).
  function clearCartForNewSearch() {
    setCart([]);
    setRowGuests({});
    setStep(1);
    setMaxStep(1);
  }

  function addToCart(offer: (typeof offers)[number]) {
    const plan = offer.plan;
    if (!plan || !offer.bd || offer.bd.unpriced.length > 0) return;
    const g = offer.guests;
    if (g.adults + g.children > offer.type.maxOccupancy) return;
    const already = cart.filter((i) => i.roomTypeId === offer.type.id).length;
    if (already >= offer.left) return; // da them het so phong con trong cua loai nay
    setCart((prev) => [
      ...prev,
      {
        key: `ci-${Date.now()}-${prev.length}`,
        roomTypeId: offer.type.id,
        planId: plan.id,
        adults: g.adults,
        children: g.children,
        roomNumber: "",
        status: "confirmed",
      },
    ]);
    setError("");
  }

  function updateCartItem(key: string, patch: Partial<CartItem>) {
    setCart((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function removeFromCart(key: string) {
    const next = cart.filter((i) => i.key !== key);
    setCart(next);
    if (next.length === 0) {
      setStep(1);
      setMaxStep(1);
    }
  }

  function goStep2() {
    if (cart.length === 0) return setError("Chưa thêm phòng nào — bấm ADD ở danh sách bên phải.");
    setError("");
    setStep(2);
    setMaxStep((m) => Math.max(m, 2));
  }

  function createInputFor(item: CartItem) {
    const t = roomTypes.find((x) => x.id === item.roomTypeId);
    const plan = ratePlans.find((p) => p.id === item.planId);
    return {
      data: avail,
      checkIn,
      checkOut,
      adults: item.adults,
      children: item.children,
      maxOccupancy: t?.maxOccupancy ?? 0,
      roomTypeId: item.roomTypeId,
      plan: plan ?? undefined,
      allPlans: ratePlans,
      overrides: priceOverrides,
      channelCode: source,
      roomNumber: item.roomNumber || undefined,
      today: todayStr,
    };
  }

  function goStep3() {
    if (cart.length === 0) return setError("Chưa thêm phòng nào — bấm ADD ở bước 1.");
    for (const item of cart) {
      const t = roomTypes.find((x) => x.id === item.roomTypeId);
      const check = validateCreate(createInputFor(item));
      if (!check.ok) return setError(`Phòng ${t?.name ?? item.roomTypeId}: ${check.error ?? "Không tiếp tục được."}`);
      if (check.warnings.length > 0) {
        if (!confirm(`Phòng ${t?.name ?? ""}:\n${check.warnings.join("\n")}\nVẫn tiếp tục?`)) return;
      }
    }
    setError("");
    setStep(3);
    setMaxStep((m) => Math.max(m, 3));
  }

  function goStep4() {
    if (!guestName.trim()) return setError("Chưa nhập họ tên khách.");
    if (!guestPhone.trim()) return setError("Chưa nhập số điện thoại khách.");
    setError("");
    setStep(4);
    setMaxStep((m) => Math.max(m, 4));
  }

  function addAddOn() {
    setAddOns((prev) => [
      ...prev,
      { id: `ao-${Date.now()}-${prev.length}`, name: ADDON_NAMES[0], basis: "night", qty: 1, unitPrice: 0 },
    ]);
  }

  async function createBooking() {
    if (cart.length === 0) return setError("Chưa thêm phòng nào — bấm ADD ở bước 1.");
    for (const item of cart) {
      const t = roomTypes.find((x) => x.id === item.roomTypeId);
      const check = validateCreate(createInputFor(item));
      if (!check.ok) return setError(`Phòng ${t?.name ?? item.roomTypeId}: ${check.error ?? "Không tạo được đơn."}`);
      if (check.warnings.length > 0) {
        if (!confirm(`Phòng ${t?.name ?? ""}:\n${check.warnings.join("\n")}\nVẫn tạo đơn?`)) return;
      }
    }
    if (!guestName.trim() || !guestPhone.trim())
      return setError("Chưa đủ thông tin khách — quay lại bước Guests.");
    setError("");
    setCreating(true);
    const collector =
      CHANNELS.find((c) => c.code === source)?.type === "ota" ? "channel_collect" : "hotel_collect";
    const codes: string[] = [];
    for (const item of cart) {
      const t = roomTypes.find((x) => x.id === item.roomTypeId);
      const bd = breakdownFor(item);
      const total = (bd ? bd.roomTotal + bd.feesTotal : 0) + addOnsTotal;
      const code = newCode();
      const { error: dbErr } = await supabase.from("reservations").insert({
        id: code,
        hotel_id: hotelId,
        account_id: accountId,
        guest_name: guestName.trim(),
        guest_phone: guestPhone.trim(),
        channel_code: source,
        payment_collector: collector,
        room_type_id: item.roomTypeId,
        rate_plan_id: item.planId,
        check_in: checkIn,
        check_out: checkOut,
        adults: item.adults,
        children: item.children,
        total_amount: total,
        paid_amount: 0,
        status: item.status,
        note: note.trim() || null,
        booked_at: todayStr || localToday(),
      });
      if (dbErr) {
        setCreating(false);
        return setError(
          `Lưu phòng ${t?.name ?? item.roomTypeId} không thành công: ${dbErr.message}` +
            (codes.length > 0
              ? ` — đã tạo được ${codes.length} đơn (${codes.join(", ")}), kiểm tra lại trong danh sách Đặt phòng.`
              : ""),
        );
      }
      codes.push(code);
      if (item.roomNumber) {
        const { error: rrErr } = await supabase
          .from("reservation_rooms")
          .insert({ reservation_id: code, room_number: item.roomNumber });
        if (rrErr) alert(`Đơn đã tạo nhưng gán phòng ${item.roomNumber} không thành công: ${rrErr.message} — gán lại trên Lịch phòng.`);
      }
      const addonRows = addOns
        .filter((a) => addonAmount(a) > 0)
        .map((a, i) => ({
          id: `fi-${Date.now()}-${i}-${code}`,
          reservation_id: code,
          hotel_id: hotelId,
          account_id: accountId,
          date: checkIn,
          label: addonLabel(a),
          amount: addonAmount(a),
        }));
      if (addonRows.length > 0) {
        const { error: fiErr } = await supabase.from("folio_items").insert(addonRows);
        if (fiErr) alert("Đơn đã tạo nhưng lưu dịch vụ thêm không thành công: " + fiErr.message);
      }
    }
    queueChannexDates(stayDates(checkIn, checkOut));
    setCreating(false);
    setCreatedCodes(codes);
  }

  function resetWizard() {
    setStep(1);
    setMaxStep(1);
    setSearched(false);
    setRowGuests({});
    setCart([]);
    setNote("");
    setGuestName("");
    setGuestPhone("");
    setAddOns([]);
    setError("");
    setCreatedCodes([]);
  }

  const inputCls =
    "rounded-lg border border-line px-3 py-2 text-sm text-ink outline-none focus:border-primary";

  // Phong trong gio cho form gan phong o buoc 2 (tru phong da gan cho phong khac).
  const fitFor = (item: CartItem) => {
    const taken = new Set(
      cart.filter((o) => o.key !== item.key && o.roomNumber).map((o) => o.roomNumber),
    );
    return fittingRooms(avail, item.roomTypeId, checkIn, checkOut).filter((rm) => !taken.has(rm.number));
  };
  const warningsFor = (item: CartItem) => {
    const rm = rooms.find((r) => r.number === item.roomNumber);
    if (!rm) return [];
    return roomFits(avail, rm, item.roomTypeId, checkIn, checkOut).warnings;
  };

  // ---------- man hinh tao xong ----------
  if (createdCodes.length > 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-xl border border-line bg-success-soft p-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success"><IconCheck className="h-7 w-7" /></div>
          <h2 className="mt-2 text-xl font-bold text-ink">
            {createdCodes.length > 1 ? `Tạo ${createdCodes.length} đơn thành công!` : "Tạo đơn thành công!"}
          </h2>
          <p className="mt-1 text-sm text-muted">Mã đặt phòng</p>
          <div className="mt-2 space-y-2">
            {createdCodes.map((code) => (
              <div key={code} className="flex flex-wrap items-center justify-center gap-3">
                <span className="text-2xl font-bold tracking-widest text-ink">{code}</span>
                <Link href={`/${hotelId}/reservations/${code}`} className="text-sm font-medium text-primary hover:underline">
                  Mở trang chi tiết ↗
                </Link>
              </div>
            ))}
          </div>
          <div className="mx-auto mt-4 max-w-md space-y-1 rounded-xl border border-line bg-surface p-4 text-left text-sm">
            <div className="flex justify-between"><span className="text-muted">Khách</span><b className="text-ink">{guestName} · {guestPhone}</b></div>
            <div className="flex justify-between"><span className="text-muted">Phòng</span><b className="text-ink">{cart.map((i) => `${roomTypes.find((x) => x.id === i.roomTypeId)?.name ?? i.roomTypeId}${i.roomNumber ? ` (${i.roomNumber})` : ""}`).join(", ")}</b></div>
            <div className="flex justify-between"><span className="text-muted">Thời gian</span><b className="text-ink">{fmtDate(checkIn)} → {fmtDate(checkOut)} ({nights} đêm)</b></div>
            <div className="flex justify-between"><span className="text-muted">Tổng tiền</span><b className="text-ink">{money(grandTotal)}</b></div>
            <div className="flex justify-between"><span className="text-muted">Đã thu</span><b className="text-ink">0₫ — thu tại quầy</b></div>
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href={`/${hotelId}/reservations`} className="cb-btn-ghost px-4 py-2.5 text-sm">
              Xem đơn trong danh sách
            </Link>
            <button onClick={resetWizard} className="cb-btn-ghost px-4 py-2.5 text-sm">Tạo đơn khác</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* tieu de + 5 buoc (buoc 5 Payment chua lam — hien mo, de chen sau) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">New Reservation</h1>
        <div className="flex flex-wrap items-center gap-2">
          {STEPS.map((s) => {
            const active = step === s.n;
            const done = s.n < step;
            const disabled = s.n === 5;
            const clickable = !disabled && s.n <= maxStep;
            return (
              <button
                key={s.n}
                disabled={!clickable}
                onClick={() => goTo(s.n)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${
                  active
                    ? "bg-primary font-semibold text-white"
                    : done
                      ? "bg-success-soft font-medium text-success"
                      : "bg-[var(--nui-bg)] text-muted"
                } ${disabled ? "opacity-70" : ""}`}
                title={disabled ? "Bước Payment sẽ chèn vào sau" : undefined}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                    active ? "bg-surface text-primary" : done ? "bg-success text-white" : "bg-surface text-muted"
                  }`}
                >
                  {s.n}
                </span>
                {s.label}
                {disabled && <span className="text-xs">(sau)</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* hang tim kiem — buoc 1 (kieu Cloudbeds) */}
      {step === 1 && (
        <div className="cb-card mt-4 flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm text-ink">
            Select Source *
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setSearched(false);
                clearCartForNewSearch();
              }}
              className={`${inputCls} mt-1 block w-44`}
            >
              {CHANNELS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-ink">
            Check-In
            <span className="mt-1 block">
              <DatePicker
                value={checkIn}
                onChange={(v) => {
                  setCheckIn(v);
                  // Chon ngay den >= ngay di thi ngay di tu nhay sang hom sau (khong khoa chet o ngay den).
                  if (v && checkOut && v >= checkOut) setCheckOut(addDays(v, 1));
                  clearCartForNewSearch();
                }}
                min={todayStr || undefined}
              />
            </span>
          </label>
          <label className="text-sm text-ink">
            Check-Out
            <span className="mt-1 block">
              <DatePicker
                value={checkOut}
                onChange={(v) => {
                  setCheckOut(v);
                  clearCartForNewSearch();
                }}
                min={checkIn ? addDays(checkIn, 1) : todayStr ? addDays(todayStr, 1) : undefined}
                rangeStart={checkIn || undefined}
              />
            </span>
          </label>
          <label className="text-sm text-ink">
            Người lớn
            <input
              type="number" min={1} value={adults}
              onChange={(e) => {
                setAdults(Number(e.target.value));
                setRowGuests({});
              }}
              className={`${inputCls} mt-1 block w-20`}
            />
          </label>
          <label className="text-sm text-ink">
            Trẻ em
            <input
              type="number" min={0} value={children}
              onChange={(e) => {
                setChildren(Number(e.target.value));
                setRowGuests({});
              }}
              className={`${inputCls} mt-1 block w-20`}
            />
          </label>
          <button onClick={runSearch} className="inline-flex items-center gap-2 rounded-lg bg-success px-6 py-2.5 text-sm font-bold text-white hover:brightness-95">
            <IconSearch className="h-4 w-4" /> SEARCH
          </button>
          <span className="pb-2 text-xs text-muted">
            Nguồn đơn quyết định giá theo kênh và bên thu tiền: kênh OTA do kênh thu hộ, Lễ tân / Website do khách sạn tự thu.
          </span>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* cot trai: ACCOMMODATIONS — phong da chon */}
        <div className="h-fit overflow-hidden rounded-xl border border-line bg-surface">
          <div className="bg-primary px-4 py-3 text-sm font-bold text-white">ACCOMMODATIONS</div>
          {cart.length === 0 ? (
            <div className="p-5 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--nui-bg)]"><IconBed className="h-7 w-7 text-muted" /></div>
              <p className="mt-3 text-sm text-muted">Add accommodations to start your reservation</p>
            </div>
          ) : (
            <div className="space-y-3 p-4 text-sm">
              {cart.map((item) => {
                const t = roomTypes.find((x) => x.id === item.roomTypeId);
                const bd = breakdownFor(item);
                const plan = ratePlans.find((p) => p.id === item.planId);
                return (
                  <div key={item.key} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <b className="text-ink">{t?.name ?? item.roomTypeId}</b>
                      <button onClick={() => removeFromCart(item.key)} className="text-danger hover:underline" title="Xoá phòng này khỏi đơn">✕</button>
                    </div>
                    <div className="mt-1 text-muted">
                      {fmtDate(checkIn)} → {fmtDate(checkOut)} · {nights} đêm · {item.adults + item.children} khách
                    </div>
                    <div className="text-muted">Gói: {plan?.name ?? "—"}</div>
                    <div className="text-muted">Phòng: {item.roomNumber ? `Phòng ${item.roomNumber}` : "Chưa gán — gán sau trên lịch"}</div>
                    <div className="mt-1 flex justify-between">
                      <span className="text-muted">Tiền phòng + phụ thu</span>
                      <b className="text-ink">{bd ? money(bd.roomTotal + bd.feesTotal) : "—"}</b>
                    </div>
                  </div>
                );
              })}
              <div className="space-y-1 border-t border-[var(--nui-bg)] pt-2">
                <div className="flex justify-between">
                  <span className="text-muted">Tiền phòng + phụ thu</span>
                  <b className="text-ink">{money(cartRoomSum)}</b>
                </div>
                {addOnsAll > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">Dịch vụ thêm</span>
                    <b className="text-ink">{money(addOnsAll)}</b>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="font-semibold text-ink">Tổng</span>
                  <b className="text-ink">{money(grandTotal)}</b>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* cot phai: noi dung tung buoc */}
        <div>
          {step === 1 && (
            <div className="cb-card p-4">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-semibold text-ink">Select accommodations:</span>
                <span className="rounded bg-[var(--nui-bg)] px-3 py-1.5 text-muted">
                  {cart.length > 0 ? `Đã thêm ${cart.length} phòng` : "ALL ROOM TYPES"}
                </span>
                <span className="text-muted">
                  {nights > 0 ? `${nights} đêm · ${fmtDate(checkIn)} → ${fmtDate(checkOut)} · ${adults + children} khách` : "Chọn ngày đến / ngày đi rồi bấm SEARCH."}
                </span>
              </div>

              {!searched ? (
                <div className="py-16 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--nui-bg)]"><IconCalendar className="h-8 w-8 text-muted" /></div>
                  <p className="mt-4 text-sm text-muted">Select check-in and check-out dates to search for availability</p>
                </div>
              ) : roomTypes.filter((t) => t.active !== false).length === 0 ? (
                <p className="py-10 text-center text-sm text-muted">
                  Khách sạn chưa có loại phòng nào — tạo loại phòng ở Thiết lập khách sạn trước.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {offers.map((o) => {
                    const g = o.guests;
                    const overCapacity = g.adults + g.children > o.type.maxOccupancy;
                    const noPlan = !o.plan;
                    const unpriced = o.bd !== null && o.bd.unpriced.length > 0;
                    const already = cart.filter((i) => i.roomTypeId === o.type.id).length;
                    const soldOut = o.left - already < 1;
                    const disabled = noPlan || unpriced || soldOut || overCapacity;
                    const minNight =
                      o.bd && o.bd.perNight.length > 0
                        ? Math.min(...o.bd.perNight.map((n) => n.price ?? Number.POSITIVE_INFINITY))
                        : null;
                    const cap = Math.max(o.type.maxOccupancy, 1);
                    return (
                      <div key={o.type.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
                        <div>
                          <div className="font-bold text-ink">{o.type.name}</div>
                          <div className="text-xs text-muted">
                            {o.type.bedConfig ? `${o.type.bedConfig} · ` : ""}tối đa {o.type.maxOccupancy} khách
                            {o.plan ? ` · gói ${o.plan.name}` : ""}
                          </div>
                          {noPlan && (
                            <div className="mt-1 text-xs text-warning">Kênh này chưa có gói giá cho loại phòng này — tạo gói giá ở Kênh bán.</div>
                          )}
                          {unpriced && o.bd && (
                            <div className="mt-1 text-xs text-warning">
                              Chưa có giá đêm {o.bd.unpriced.map(fmtDate).join(", ")} — nhập giá ở Lịch giá.
                            </div>
                          )}
                          {soldOut && !noPlan && !unpriced && (
                            <div className="mt-1 text-xs text-danger">
                              {already > 0
                                ? `Đã thêm hết ${o.left} phòng còn trống của loại này.`
                                : `Hết phòng${o.worstDate ? ` đêm ${fmtDate(o.worstDate)}` : ""} — không tạo được đơn.`}
                            </div>
                          )}
                          {overCapacity && (
                            <div className="mt-1 text-xs text-danger">Quá sức chứa loại phòng này.</div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="text-xs text-muted">
                            Người lớn
                            <select
                              value={g.adults}
                              onChange={(e) => setRowGuests((prev) => ({ ...prev, [o.type.id]: { ...g, adults: Number(e.target.value) } }))}
                              className={`${inputCls} ml-1 w-16 px-2 py-1.5`}
                            >
                              {Array.from({ length: cap }, (_, i) => i + 1).map((n) => (<option key={n} value={n}>{n}</option>))}
                            </select>
                          </label>
                          <label className="text-xs text-muted">
                            Trẻ em
                            <select
                              value={g.children}
                              onChange={(e) => setRowGuests((prev) => ({ ...prev, [o.type.id]: { ...g, children: Number(e.target.value) } }))}
                              className={`${inputCls} ml-1 w-16 px-2 py-1.5`}
                            >
                              {Array.from({ length: cap + 1 }, (_, i) => i).map((n) => (<option key={n} value={n}>{n}</option>))}
                            </select>
                          </label>
                          <div className="text-right">
                            <span className={`rounded-full px-3 py-1 text-xs font-medium ${soldOut ? "bg-danger-soft text-danger" : "bg-success-soft text-success"}`}>
                              {soldOut ? "Hết phòng" : `Còn ${o.left - already} phòng`}
                            </span>
                            {o.bd && !unpriced && minNight !== null && Number.isFinite(minNight) && (
                              <div className="mt-1 text-sm">
                                <b className="text-ink">{money(o.bd.grandTotal)}</b>
                                <span className="text-muted"> / {nights} đêm · từ {money(minNight)}/đêm</span>
                              </div>
                            )}
                          </div>
                          <button
                            disabled={disabled}
                            onClick={() => addToCart(o)}
                            className="cb-btn-primary px-4 py-2 text-sm disabled:opacity-40"
                          >
                            ADD
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="cb-card space-y-4 p-5 text-sm">
              <h2 className="text-base font-bold text-ink">Details — xác nhận thông tin từng phòng</h2>
              <p className="text-muted">
                {cart.length} phòng · {fmtDate(checkIn)} → {fmtDate(checkOut)} · {nights} đêm · nguồn {getChannelName(source)}
              </p>
              {cart.map((item) => {
                const t = roomTypes.find((x) => x.id === item.roomTypeId);
                const bd = breakdownFor(item);
                const fit = fitFor(item);
                const warns = warningsFor(item);
                return (
                  <div key={item.key} className="space-y-3 rounded-xl border border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b className="text-ink">{t?.name ?? item.roomTypeId}</b>
                      <b className="text-ink">{bd ? money(bd.roomTotal + bd.feesTotal) : "—"}</b>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-ink">
                        Người lớn
                        <input type="number" min={1} value={item.adults} onChange={(e) => updateCartItem(item.key, { adults: Number(e.target.value) })} className={`${inputCls} mt-1 block w-full`} />
                      </label>
                      <label className="text-ink">
                        Trẻ em
                        <input type="number" min={0} value={item.children} onChange={(e) => updateCartItem(item.key, { children: Number(e.target.value) })} className={`${inputCls} mt-1 block w-full`} />
                      </label>
                      <label className="text-ink">
                        Gói giá (kênh {getChannelName(source)})
                        <select value={item.planId} onChange={(e) => updateCartItem(item.key, { planId: e.target.value })} className={`${inputCls} mt-1 block w-full`}>
                          {plansFor(source, item.roomTypeId).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}{p.derivedFromId ? " (kế thừa)" : ""}
                            </option>
                          ))}
                          {plansFor(source, item.roomTypeId).length === 0 && <option value="">— chưa có gói giá —</option>}
                        </select>
                      </label>
                      <label className="text-ink">
                        Gán phòng ngay
                        <select value={item.roomNumber} onChange={(e) => updateCartItem(item.key, { roomNumber: e.target.value })} className={`${inputCls} mt-1 block w-full`}>
                          <option value="">Chưa gán — gán sau trên lịch</option>
                          {fit.map((rm) => (
                            <option key={rm.number} value={rm.number}>
                              Phòng {rm.number}
                              {["dirty", "in_progress"].includes(rm.housekeepingStatus) ? " (chưa dọn)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {fit.length === 0 && (
                      <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                        Không còn phòng trống phù hợp để gán ngay — cứ tạo đơn chưa gán, gán sau trên lịch khi có phòng.
                      </p>
                    )}
                    {warns.length > 0 && (
                      <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">{warns.join(" ")}</p>
                    )}
                    <div>
                      <span className="text-ink">Trạng thái đơn</span>
                      <span className="mt-1 flex gap-4">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="radio" checked={item.status === "confirmed"} onChange={() => updateCartItem(item.key, { status: "confirmed" })} className="accent-primary" />
                          Đã xác nhận
                        </label>
                        <label className="flex cursor-pointer items-center gap-2">
                          <input type="radio" checked={item.status === "pending"} onChange={() => updateCartItem(item.key, { status: "pending" })} className="accent-primary" />
                          Chờ xác nhận (duyệt sau)
                        </label>
                      </span>
                    </div>
                    {bd && (
                      <div className="space-y-1 rounded-xl bg-primary-soft px-4 py-3">
                        {bd.perNight.map((n) => (
                          <div key={n.date} className="flex justify-between">
                            <span>Tiền phòng — đêm {fmtDate(n.date)}</span>
                            <span className="font-medium">{n.price === null ? "Chưa có giá" : money(n.price)}</span>
                          </div>
                        ))}
                        {bd.feesTotal > 0 && (
                          <div className="flex justify-between"><span>Phụ thu thêm khách × {nights} đêm</span><span className="font-medium">{money(bd.feesTotal)}</span></div>
                        )}
                        <div className="flex justify-between border-t border-line pt-2 font-bold">
                          <span>Tổng tiền phòng</span><span>{money(bd.roomTotal + bd.feesTotal)}</span>
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end">
                      <button onClick={() => removeFromCart(item.key)} className="text-sm text-danger hover:underline">Xoá phòng này</button>
                    </div>
                  </div>
                );
              })}
              <div>
                <label className="text-ink">
                  Ghi chú / yêu cầu đặc biệt (áp dụng cho tất cả đơn)
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tầng cao, phòng yên tĩnh..." className={`${inputCls} mt-1 block w-full`} />
                </label>
              </div>
              <div className="flex gap-2">
                <button onClick={() => goTo(1)} className="cb-btn-ghost px-4 py-2.5 text-sm">← Quay lại</button>
                <button onClick={goStep3} className="cb-btn-primary flex-1 py-2.5 text-sm">Tiếp tục → Guests</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="cb-card space-y-4 p-5 text-sm">
              <h2 className="text-base font-bold text-ink">Guests — thông tin khách</h2>
              <p className="text-muted">
                {cart.length} phòng · {fmtDate(checkIn)} → {fmtDate(checkOut)} · {nights} đêm · {cart.reduce((s, i) => s + i.adults + i.children, 0)} khách
                {cart.some((i) => i.roomNumber) ? ` · phòng ${cart.filter((i) => i.roomNumber).map((i) => i.roomNumber).join(", ")}` : " · chưa gán phòng"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-ink">
                  Họ tên *
                  <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="VD: Nguyễn Văn A" className={`${inputCls} mt-1 block w-full`} />
                </label>
                <label className="text-ink">
                  Số điện thoại *
                  <input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="VD: 0901234567" className={`${inputCls} mt-1 block w-full`} />
                </label>
              </div>
              <p className="text-xs text-muted">
                Email khách chưa nhập ở đây — cần thêm 1 cột vào cơ sở dữ liệu, sẽ làm cùng bước Payment sau.
              </p>
              <div className="flex gap-2">
                <button onClick={() => goTo(2)} className="cb-btn-ghost px-4 py-2.5 text-sm">← Quay lại</button>
                <button onClick={goStep4} className="cb-btn-primary flex-1 py-2.5 text-sm">Tiếp tục → Add-ons</button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="cb-card space-y-4 p-5 text-sm">
              <h2 className="text-base font-bold text-ink">Add-ons — dịch vụ thêm</h2>
              <p className="text-muted">
                Khách: <b className="text-ink">{guestName}</b> · {guestPhone} · {cart.length} phòng · {fmtDate(checkIn)} → {fmtDate(checkOut)}
              </p>
              {addOns.length === 0 && (
                <p className="rounded-lg bg-[var(--nui-bg)] px-3 py-2 text-muted">
                  Không bắt buộc — bấm “+ Thêm dịch vụ” nếu khách dùng thêm, không thì tạo đơn luôn.
                </p>
              )}
              {addOns.map((a) => (
                <div key={a.id} className="flex flex-wrap items-end gap-2 rounded-xl border border-line p-3">
                  <label className="text-ink">
                    Dịch vụ
                    <select
                      value={a.name}
                      onChange={(e) => setAddOns((prev) => prev.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)))}
                      className={`${inputCls} mt-1 block`}
                    >
                      {ADDON_NAMES.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-ink">
                    Tính theo
                    <select
                      value={a.basis}
                      onChange={(e) => setAddOns((prev) => prev.map((x) => (x.id === a.id ? { ...x, basis: e.target.value as "night" | "stay" } : x)))}
                      className={`${inputCls} mt-1 block`}
                    >
                      <option value="night">Mỗi đêm</option>
                      <option value="stay">Cả kỳ ở</option>
                    </select>
                  </label>
                  <label className="text-ink">
                    Số lượng
                    <input
                      type="number" min={1} value={a.qty}
                      onChange={(e) => setAddOns((prev) => prev.map((x) => (x.id === a.id ? { ...x, qty: Number(e.target.value) } : x)))}
                      className={`${inputCls} mt-1 block w-20`}
                    />
                  </label>
                  <label className="text-ink">
                    Đơn giá
                    <input
                      type="number" min={0} value={a.unitPrice}
                      onChange={(e) => setAddOns((prev) => prev.map((x) => (x.id === a.id ? { ...x, unitPrice: Number(e.target.value) } : x)))}
                      className={`${inputCls} mt-1 block w-32`}
                    />
                  </label>
                  <span className="pb-2 font-semibold text-ink">{money(addonAmount(a))}</span>
                  <button
                    onClick={() => setAddOns((prev) => prev.filter((x) => x.id !== a.id))}
                    className="pb-2 text-danger"
                    title="Xoá dịch vụ này"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button onClick={addAddOn} className="cb-btn-ghost px-4 py-2 text-sm">+ Thêm dịch vụ</button>
              <div className="space-y-1 rounded-xl bg-primary-soft px-4 py-3">
                <div className="flex justify-between"><span>Tiền phòng + phụ thu ({cart.length} phòng)</span><span className="font-medium">{money(cartRoomSum)}</span></div>
                <div className="flex justify-between"><span>Dịch vụ thêm (áp dụng cho mỗi phòng)</span><span className="font-medium">{money(addOnsAll)}</span></div>
                <div className="flex justify-between border-t border-line pt-2 font-bold"><span>Tổng cộng</span><span>{money(grandTotal)}</span></div>
                <div className="text-xs text-muted">Chưa thu tiền — thu tại quầy hoặc ở bước Payment (sẽ chèn sau).</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => goTo(3)} className="cb-btn-ghost px-4 py-2.5 text-sm">← Quay lại</button>
                <button onClick={createBooking} disabled={creating} className="cb-btn-primary flex-1 py-2.5 text-sm disabled:opacity-50">
                  {creating ? "Đang tạo đơn..." : cart.length > 1 ? `Tạo ${cart.length} đơn` : "Tạo đơn"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {/* dai tong tien — kieu Cloudbeds, dinh duoi trang */}
      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-end gap-6 rounded-xl border border-line bg-surface px-5 py-3 text-sm shadow-lg">
        <span className="text-muted">Subtotal <b className="ml-1 text-ink">{money(subtotal)}</b></span>
        <span className="text-muted">Grand Total <b className="ml-1 text-ink">{money(grandTotal)}</b></span>
        <span className="rounded bg-[var(--nui-bg)] px-3 py-1.5 font-semibold text-ink">
          Balance Due {money(balanceDue)}
        </span>
        {step === 1 && (
          <button
            onClick={goStep2}
            disabled={cart.length === 0}
            className="cb-btn-primary px-5 py-2.5 text-sm disabled:opacity-40"
            title={cart.length === 0 ? "Thêm ít nhất 1 phòng bằng nút ADD" : "Sang bước Details"}
          >
            BOOKING DETAILS ›
          </button>
        )}
      </div>
    </div>
  );
}
