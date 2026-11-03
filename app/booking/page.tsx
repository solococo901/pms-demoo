"use client";
// ============================================================
// FILE 12 — app/booking/page.tsx (Cloudbeds style)
// The GUEST-facing Booking Engine page (what a guest sees on
// the hotel website). A 4-step flow on one page:
//   Step 1 — pick dates + guests → see each room type with
//            LIVE availability and its WEBSITE rate plans
//   Step 2 — guest information form
//   Step 3 — payment choice (pay at hotel / card form, UI only)
//   Step 4 — confirmation with a booking code
//
// Key design points it demonstrates:
//   - Guests only ever see the "website" channel's plans —
//     per-channel pricing means OTA prices are invisible here,
//     and Website is the cheapest because no commission.
//   - Availability is the SHARED inventory: rooms left =
//     physical rooms of the type − rooms already taken by
//     bookings from ANY channel on those nights.
//   - Room types with no website plan (Twin, Studio in the
//     mock data) show "book by phone" instead of a price —
//     a channel only sells what it has plans for.
//   - The header photo is the hotel's cover photo from its
//     photo library (Khách sạn → tab Hình ảnh).
//   - On confirm, the booking is built exactly like a staff
//     booking, but with channelCode "website" — in the real
//     system it lands in the PMS list as source
//     "Website (Booking Engine)".
// Logic unchanged from the first version — colors + photo.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { INVENTORY_BLOCKS, RATE_PLANS, RESERVATIONS, ROOM_BLOCKS, ROOMS, ROOM_TYPES, TODAY, extraFeesPerNight, getHotelData, inventoryBlockOn, resolvePlanPrice, roomBlockOn, type RatePlan, type Reservation } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { queueChannexDates, stayDates } from "@/lib/channex-outbox";

// Round B (Buoc 4.4c): availability + prices come from Supabase
// and confirming a booking INSERTS a real reservation row —
// it appears in the PMS list, the calendar and the reports.
const HOTEL_ID = "cityhouse-mark";
const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

const DAY_MS = 86_400_000;
const toTime = (d: string) => new Date(d + "T00:00:00Z").getTime();
const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toISO(toTime(d) + n * DAY_MS);
const fmt = (n: number) => n.toLocaleString("vi-VN");
const fmtDate = (d: string) => d.split("-").reverse().join("/");

const newCode = () =>
  Array.from({ length: 10 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");

// rooms of this type still free on a given night (shared inventory, all channels)
// Dated blocks drive availability (audit A3): an out-of-order
// block covering this night removes the room from the sellable
// total; a stop-sell block for the website channel (or for the
// whole room type) closes the night completely.
function roomsLeftOn(
  rooms: typeof ROOMS,
  reservations: typeof RESERVATIONS,
  roomBlocks: typeof ROOM_BLOCKS,
  inventoryBlocks: typeof INVENTORY_BLOCKS,
  roomTypeId: string,
  date: string
) {
  if (inventoryBlockOn(inventoryBlocks, "website", roomTypeId, date)) return 0;
  const total = rooms.filter((r) => r.roomTypeId === roomTypeId && !roomBlockOn(roomBlocks, r.number, date, "out_of_order")).length;
  const taken = reservations.filter(
    (r) =>
      r.roomTypeId === roomTypeId &&
      !["cancelled", "no_show"].includes(r.status) &&
      r.checkIn <= date &&
      date < r.checkOut
  ).reduce((sum, r) => sum + Math.max(1, r.roomNumbers.length), 0);
  return Math.max(0, total - taken);
}

function priceFor(plan: RatePlan, date: string, allPlans: RatePlan[], overrides?: Record<string, number>) {
  return resolvePlanPrice(plan, date, allPlans, overrides) ?? 0;
}

const inputCls = "rounded-lg border border-[#dde3ea] px-3 py-2 text-[#17293e] outline-none focus:border-[#2563eb]";

export default function BookingPage() {
  const [step, setStep] = useState(1);
  const [checkIn, setCheckIn] = useState(TODAY);
  const [checkOut, setCheckOut] = useState(addDays(TODAY, 2));
  const [guests, setGuests] = useState(2);
  const [planId, setPlanId] = useState<string>("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [note, setNote] = useState("");
  const [payMethod, setPayMethod] = useState<"hotel" | "card">("hotel");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const coverPhoto = getHotelData("cityhouse-mark").photos?.[0];

  const nights = Math.max(0, Math.round((toTime(checkOut) - toTime(checkIn)) / DAY_MS));
  // ---------- data from Supabase (starts as sample, replaced on load) ----------
  const [roomsDb, setRoomsDb] = useState(ROOMS);
  const [reservationsDb, setReservationsDb] = useState<Reservation[]>(RESERVATIONS);
  const [roomBlocksDb, setRoomBlocksDb] = useState(ROOM_BLOCKS);
  const [invBlocksDb, setInvBlocksDb] = useState(INVENTORY_BLOCKS);
  const [plansDb, setPlansDb] = useState<RatePlan[]>(RATE_PLANS);
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});
  const [dbError, setDbError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [roomsRes, resRes, rrRes, blocksRes, invRes, plansRes, pricesRes] = await Promise.all([
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("inventory_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_prices").select("*"),
      ]);
      const err = roomsRes.error ?? resRes.error ?? rrRes.error ?? blocksRes.error ?? invRes.error ?? plansRes.error ?? pricesRes.error;
      if (err) return setDbError(err.message);
      setRoomsDb(
        (roomsRes.data ?? []).map((r) => ({ number: r.number, roomTypeId: r.room_type_id, housekeepingStatus: r.housekeeping_status }))
      );
      const roomsMap = new Map<string, string[]>();
      for (const row of rrRes.data ?? []) {
        const list = roomsMap.get(row.reservation_id) ?? [];
        list.push(row.room_number);
        roomsMap.set(row.reservation_id, list);
      }
      setReservationsDb(
        (resRes.data ?? []).map((r) => ({
          id: r.id,
          guestName: r.guest_name,
          guestPhone: r.guest_phone ?? "",
          channelCode: r.channel_code,
          paymentCollector: r.payment_collector,
          roomNumbers: roomsMap.get(r.id) ?? [],
          roomTypeId: r.room_type_id,
          ratePlanId: r.rate_plan_id ?? "",
          checkIn: r.check_in,
          checkOut: r.check_out,
          guests: (r.adults ?? 0) + (r.children ?? 0),
          adults: r.adults,
          children: r.children,
          totalAmount: r.total_amount,
          paidAmount: r.paid_amount,
          status: r.status,
          createdAt: String(r.booked_at).slice(0, 10),
          note: r.note ?? undefined,
        }))
      );
      setRoomBlocksDb(
        (blocksRes.data ?? []).map((b) => ({ id: b.id, roomNumber: b.room_number, from: b.from_date, to: b.to_date, kind: b.kind, reason: b.reason ?? "" }))
      );
      setInvBlocksDb(
        (invRes.data ?? []).map((b) => ({
          id: b.id,
          scope: b.scope,
          channelCode: b.channel_code ?? undefined,
          roomTypeId: b.room_type_id,
          from: b.from_date,
          to: b.to_date,
          reason: b.reason ?? undefined,
        }))
      );
      const dbPlans: RatePlan[] = (plansRes.data ?? []).map((row) => ({
        id: row.id,
        channelCode: row.channel_code,
        roomTypeId: row.room_type_id,
        name: row.name,
        cancellationPolicy: row.cancellation_policy as RatePlan["cancellationPolicy"],
        prices: {},
        publicName: row.public_name ?? undefined,
        mealPlan: row.meal_plan as RatePlan["mealPlan"],
        baseOccupancy: row.base_occupancy,
        extraAdultFee: Number(row.extra_adult_fee),
        extraChildFee: Number(row.extra_child_fee),
        derivedFromId: row.derived_from_id ?? undefined,
        formulaId: row.formula_id ?? undefined,
      }));
      const planIds = new Set(dbPlans.map((p) => p.id));
      const priceRows = (pricesRes.data ?? []).filter((r) => planIds.has(r.rate_plan_id));
      for (const row of priceRows) {
        const plan = dbPlans.find((p) => p.id === row.rate_plan_id);
        if (plan && !plan.derivedFromId) plan.prices[row.date] = Number(row.price);
      }
      const dbOverrides: Record<string, number> = {};
      for (const row of priceRows) {
        const plan = dbPlans.find((p) => p.id === row.rate_plan_id);
        if (plan?.derivedFromId && resolvePlanPrice(plan, row.date, dbPlans, {}) !== Number(row.price)) {
          dbOverrides[`${row.rate_plan_id}|${row.date}`] = Number(row.price);
        }
      }
      setPlansDb(dbPlans);
      setPriceOverrides(dbOverrides);
    })();
  }, []);

  const nightsList = useMemo(() => Array.from({ length: nights }, (_, i) => addDays(checkIn, i)), [checkIn, nights]);

  // availability + website plans per room type for the chosen range
  const offers = useMemo(
    () =>
      ROOM_TYPES.map((t) => {
        const left = nightsList.length ? Math.min(...nightsList.map((d) => roomsLeftOn(roomsDb, reservationsDb, roomBlocksDb, invBlocksDb, t.id, d))) : 0;
        const plans = plansDb.filter((p) => p.channelCode === "website" && p.roomTypeId === t.id);
        return { type: t, left, plans };
      }),
    [nightsList, roomsDb, reservationsDb, roomBlocksDb, invBlocksDb, plansDb]
  );

  const plan = plansDb.find((p) => p.id === planId);
  const planType = plan ? ROOM_TYPES.find((t) => t.id === plan.roomTypeId) : undefined;
  const perNight = plan ? nightsList.map((d) => ({ date: d, price: priceFor(plan, d, plansDb, priceOverrides) })) : [];
  const total = perNight.reduce((s, n) => s + n.price, 0);
  // Extra-guest fees: the booking page collects ONE guest count
  // (treated as adults); guests beyond the plan's included
  // occupancy pay the plan's extra-adult fee per night.
  const fees = plan ? extraFeesPerNight(plan, guests, 0) : { extraAdults: 0, adultTotal: 0, childTotal: 0, total: 0 };
  const feesTotal = fees.total * nights;
  const grandTotal = total + feesTotal;

  async function confirm() {
    if (!guestName.trim()) return setError("Chưa nhập họ tên.");
    if (!guestPhone.trim()) return setError("Chưa nhập số điện thoại.");
    if (!plan) return;
    setError("");
    setSaving(true);
    const bookingCode = newCode();
    const { error: dbErr } = await supabase.from("reservations").insert({
      id: bookingCode,
      hotel_id: HOTEL_ID,
      account_id: ACCOUNT_ID,
      guest_name: guestName.trim(),
      guest_phone: guestPhone.trim(),
      channel_code: "website",
      payment_collector: "hotel_collect",
      room_type_id: plan.roomTypeId,
      rate_plan_id: plan.id,
      check_in: checkIn,
      check_out: checkOut,
      adults: guests,
      children: 0,
      total_amount: grandTotal,
      paid_amount: payMethod === "card" ? grandTotal : 0,
      status: "confirmed",
      note: note || null,
      booked_at: TODAY,
    });
    setSaving(false);
    if (dbErr) return setError("Đặt phòng chưa lưu được vào hệ thống: " + dbErr.message);
    queueChannexDates(stayDates(checkIn, checkOut));
    // The room is now taken in this page's own availability too.
    setReservationsDb((prev) => [
      ...prev,
      {
        id: bookingCode,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim(),
        channelCode: "website",
        paymentCollector: "hotel_collect",
        roomNumbers: [],
        roomTypeId: plan.roomTypeId,
        ratePlanId: plan.id,
        checkIn,
        checkOut,
        guests,
        adults: guests,
        children: 0,
        totalAmount: grandTotal,
        paidAmount: payMethod === "card" ? grandTotal : 0,
        status: "confirmed",
        createdAt: TODAY,
        note: note || undefined,
      },
    ]);
    setCode(bookingCode);
    setStep(4);
  }

  const stepCls = (n: number) =>
    `flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${step === n ? "bg-[#2563eb] font-medium text-white" : step > n ? "bg-[#e6f7f1] text-[#0e7a56]" : "bg-[#eef1f5] text-[#68707a]"}`;

  return (
    <div className="mx-auto max-w-3xl">
      {/* hotel cover photo from the photo library */}
      {coverPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverPhoto.url} alt={coverPhoto.caption ?? "Ảnh khách sạn"} className="mb-4 h-48 w-full rounded-xl object-cover" />
      )}
      <h1 className="text-2xl font-bold text-[#17293e]">Đặt phòng trực tuyến</h1>
      <p className="mt-1 text-sm text-[#68707a]">CityHouse MARK El Pino Realm — đặt trực tiếp trên website, giá tốt nhất vì không qua trung gian.</p>
      {dbError && <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}

      {/* progress */}
      <div className="mt-4 flex flex-wrap gap-2">
        <span className={stepCls(1)}>1 · Chọn phòng</span>
        <span className={stepCls(2)}>2 · Thông tin khách</span>
        <span className={stepCls(3)}>3 · Thanh toán</span>
        <span className={stepCls(4)}>4 · Hoàn tất</span>
      </div>

      {/* ============ STEP 1 — dates + offers ============ */}
      {step === 1 && (
        <div className="mt-5">
          <div className="cb-card flex flex-wrap gap-3 p-4">
            <label className="text-sm text-[#17293e]">Ngày đến<input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={`${inputCls} mt-1 block`} /></label>
            <label className="text-sm text-[#17293e]">Ngày đi<input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={`${inputCls} mt-1 block`} /></label>
            <label className="text-sm text-[#17293e]">Số khách<input type="number" min={1} value={guests} onChange={(e) => setGuests(Number(e.target.value))} className={`${inputCls} mt-1 block w-24`} /></label>
            <div className="ml-auto self-end text-sm text-[#68707a]">{nights > 0 ? `${nights} đêm · ${fmtDate(checkIn)} → ${fmtDate(checkOut)}` : "Ngày đi phải sau ngày đến"}</div>
          </div>

          {offers.map(({ type, left, plans }) => (
            <div key={type.id} className="cb-card mt-4 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-bold text-[#17293e]">{type.name}</div>
                  <div className="text-sm text-[#68707a]">{type.bedConfig} · tối đa {type.maxOccupancy} khách</div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${left > 0 ? "bg-[#e6f7f1] text-[#0e7a56]" : "bg-[#fdecec] text-[#e5484d]"}`}>
                  {left > 0 ? `Còn ${left} phòng` : "Hết phòng"}
                </span>
              </div>

              {plans.length === 0 ? (
                <p className="mt-3 rounded-lg bg-[#fff8ec] px-3 py-2 text-sm text-[#92600a]">
                  Loại phòng này chưa mở bán online — vui lòng gọi lễ tân để đặt. (Kênh Website chưa có gói giá cho loại phòng này; tạo thêm ở Khách sạn → tab Gói giá.)
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {plans.map((p) => {
                    const pFees = extraFeesPerNight(p, guests, 0);
                    const sum = nightsList.reduce((s, d) => s + priceFor(p, d, plansDb, priceOverrides), 0) + pFees.total * nightsList.length;
                    return (
                      <div key={p.id} className="flex items-center justify-between rounded-lg border border-[#eef1f5] px-4 py-3">
                        <div>
                          <div className="font-medium text-[#17293e]">{p.name.replace("WEB - ", "")}</div>
                          <div className="text-xs text-[#68707a]">{p.cancellationPolicy === "flexible" ? "Huỷ miễn phí trước ngày đến" : "Không hoàn tiền — rẻ hơn"}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="font-bold text-[#17293e]">{fmt(sum)}₫</div>
                            <div className="text-xs text-[#68707a]">{nights} đêm{pFees.total > 0 ? ` · đã gồm phụ thu +${pFees.extraAdults} khách` : ""}</div>
                          </div>
                          <button
                            disabled={left === 0 || nights === 0}
                            onClick={() => { setPlanId(p.id); setStep(2); }}
                            className="cb-btn-primary px-4 py-2 text-sm disabled:opacity-40"
                          >
                            Chọn
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ============ STEP 2 — guest info ============ */}
      {step === 2 && plan && (
        <div className="cb-card mt-5 p-5">
          <h2 className="font-bold text-[#17293e]">Thông tin khách</h2>
          <p className="mt-1 text-sm text-[#68707a]">{planType?.name} · {plan.name.replace("WEB - ", "")} · {fmtDate(checkIn)} → {fmtDate(checkOut)} · {nights} đêm · {guests} khách</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-[#17293e]">Họ tên *<input value={guestName} onChange={(e) => setGuestName(e.target.value)} className={`${inputCls} mt-1 w-full`} placeholder="VD: Nguyễn Văn A" /></label>
            <label className="text-sm text-[#17293e]">Số điện thoại *<input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} className={`${inputCls} mt-1 w-full`} /></label>
            <label className="text-sm text-[#17293e] sm:col-span-2">Email (nhận xác nhận)<input value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} className={`${inputCls} mt-1 w-full`} /></label>
            <label className="text-sm text-[#17293e] sm:col-span-2">Yêu cầu đặc biệt<input value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} mt-1 w-full`} placeholder="Tầng cao, phòng yên tĩnh..." /></label>
          </div>
          {error && <p className="mt-3 text-sm text-[#e5484d]">{error}</p>}
          <div className="mt-5 flex gap-2">
            <button onClick={() => setStep(1)} className="cb-btn-ghost px-4 py-2.5 text-sm">← Quay lại</button>
            <button onClick={() => { if (!guestName.trim() || !guestPhone.trim()) return setError("Nhập họ tên và số điện thoại trước khi tiếp tục."); setError(""); setStep(3); }} className="cb-btn-primary flex-1 py-2.5 text-sm">
              Tiếp tục thanh toán →
            </button>
          </div>
        </div>
      )}

      {/* ============ STEP 3 — payment (UI only) ============ */}
      {step === 3 && plan && (
        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_320px]">
          <div className="cb-card p-5">
            <h2 className="font-bold text-[#17293e]">Thanh toán</h2>
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-[#eef1f5] p-3">
              <input type="radio" checked={payMethod === "hotel"} onChange={() => setPayMethod("hotel")} className="mt-1 accent-[#2563eb]" />
              <span className="text-sm text-[#17293e]"><b>Trả tại khách sạn</b><br /><span className="text-[#68707a]">Thanh toán khi nhận phòng. Đơn được giữ đến 18:00 ngày đến.</span></span>
            </label>
            <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-lg border border-[#eef1f5] p-3">
              <input type="radio" checked={payMethod === "card"} onChange={() => setPayMethod("card")} className="mt-1 accent-[#2563eb]" />
              <span className="text-sm text-[#17293e]"><b>Trả ngay bằng thẻ</b><br /><span className="text-[#68707a]">Cổng thanh toán thật (VNPay/MoMo/Stripe) sẽ nối ở Vòng B — ở đây chỉ là giao diện.</span></span>
            </label>
            {payMethod === "card" && (
              <div className="mt-3 grid gap-3">
                <input placeholder="Số thẻ  •••• •••• •••• ••••" className={`${inputCls} text-sm`} />
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Hết hạn MM/YY" className={`${inputCls} text-sm`} />
                  <input placeholder="CVC" className={`${inputCls} text-sm`} />
                </div>
              </div>
            )}
            {error && <p className="mt-3 text-sm text-[#e5484d]">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button onClick={() => setStep(2)} className="cb-btn-ghost px-4 py-2.5 text-sm">← Quay lại</button>
              <button onClick={confirm} disabled={saving} className="cb-btn-primary flex-1 py-2.5 text-sm disabled:opacity-50">{saving ? "Đang lưu đơn..." : "Xác nhận đặt phòng"}</button>
            </div>
          </div>

          <div className="cb-card h-fit p-5">
            <h3 className="font-bold text-[#17293e]">Tóm tắt</h3>
            <div className="mt-2 space-y-1 text-sm text-[#68707a]">
              <div>{planType?.name} — {plan.name.replace("WEB - ", "")}</div>
              <div>{fmtDate(checkIn)} → {fmtDate(checkOut)} · {guests} khách</div>
              <div>Khách: {guestName}</div>
            </div>
            <div className="mt-3 space-y-1 border-t border-[#eef1f5] pt-3 text-sm text-[#17293e]">
              {perNight.map((n) => (
                <div key={n.date} className="flex justify-between"><span>{fmtDate(n.date)}</span><span>{fmt(n.price)}₫</span></div>
              ))}
              {feesTotal > 0 && (
                <div className="flex justify-between"><span>Phụ thu thêm {fees.extraAdults} khách × {nights} đêm</span><span>{fmt(feesTotal)}₫</span></div>
              )}
              <div className="flex justify-between border-t border-[#eef1f5] pt-2 text-base font-bold"><span>Tổng</span><span>{fmt(grandTotal)}₫</span></div>
              <div className="text-xs text-[#68707a]">{payMethod === "hotel" ? "Trả tại khách sạn" : "Trả ngay bằng thẻ"} · {plan.cancellationPolicy === "flexible" ? "Huỷ miễn phí trước ngày đến" : "Không hoàn tiền"}</div>
            </div>
          </div>
        </div>
      )}

      {/* ============ STEP 4 — confirmation ============ */}
      {step === 4 && plan && (
        <div className="mt-5 rounded-xl border border-[#bfe9d9] bg-[#eafaf3] p-6 text-center">
          <div className="text-4xl">✅</div>
          <h2 className="mt-2 text-xl font-bold text-[#17293e]">Đặt phòng thành công!</h2>
          <p className="mt-1 text-sm text-[#68707a]">Mã đặt phòng của bạn</p>
          <div className="mt-1 text-2xl font-bold tracking-widest text-[#17293e]">{code}</div>
          <div className="mx-auto mt-4 max-w-md space-y-1 rounded-xl border border-[#dde3ea] bg-white p-4 text-left text-sm">
            <div className="flex justify-between"><span className="text-[#68707a]">Khách</span><b className="text-[#17293e]">{guestName}</b></div>
            <div className="flex justify-between"><span className="text-[#68707a]">Phòng</span><b className="text-[#17293e]">{planType?.name} — {plan.name.replace("WEB - ", "")}</b></div>
            <div className="flex justify-between"><span className="text-[#68707a]">Thời gian</span><b className="text-[#17293e]">{fmtDate(checkIn)} → {fmtDate(checkOut)} ({nights} đêm)</b></div>
            <div className="flex justify-between"><span className="text-[#68707a]">Tổng tiền</span><b className="text-[#17293e]">{fmt(grandTotal)}₫</b></div>
            <div className="flex justify-between"><span className="text-[#68707a]">Thanh toán</span><b className="text-[#17293e]">{payMethod === "hotel" ? "Tại khách sạn" : "Đã trả bằng thẻ (mô phỏng)"}</b></div>
          </div>
          <p className="mx-auto mt-4 max-w-md text-xs text-[#68707a]">
            Ở hệ thống thật, đơn này lập tức xuất hiện trong PMS với nguồn <b className="text-[#17293e]">Website (Booking Engine)</b>, quỹ phòng chung trừ đi 1 phòng — các OTA cũng thấy ít đi 1 phòng ngay, nên không bao giờ bán trùng.
            {guestEmail && <> Email xác nhận sẽ gửi tới {guestEmail}.</>}
          </p>
          <button onClick={() => { setStep(1); setPlanId(""); setGuestName(""); setGuestPhone(""); setGuestEmail(""); setNote(""); }} className="cb-btn-ghost mt-4 px-4 py-2 text-sm">
            Đặt thêm phòng khác
          </button>
        </div>
      )}
    </div>
  );
}
