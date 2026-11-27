"use client";
// ============================================================
// app/[hotelId]/reservations/new/page.tsx — Trang tao don moi
// kieu Cloudbeds (4 buoc; buoc Payment chen sau).
// Nap du lieu giong trang Danh sach dat phong + them
// inventory_blocks (de tinh ton) va price overrides cho goi ke thua.
// ============================================================

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import NewReservationWizard from "@/components/NewReservationWizard";
import { type StayRestrictions } from "@/lib/booking-rules";
import {
  resolvePlanPrice,
  type BaseRatePeriod,
  type InventoryBlock,
  type RatePlan,
  type Reservation,
  type Room,
  type RoomBlock,
  type RoomType,
} from "@/lib/mock-data";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

export default function NewReservationPage() {
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  // Tien te: khach san test dung USD, con lai VND (cung cach
  // trang Tong quan dang dung).
  const currency = HOTEL_ID === "test-property" ? "USD" : "VND";
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [roomBlocks, setRoomBlocks] = useState<RoomBlock[]>([]);
  const [invBlocks, setInvBlocks] = useState<InventoryBlock[]>([]);
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});
  const [baseRatePeriods, setBaseRatePeriods] = useState<BaseRatePeriod[]>([]);
  const [restrictions, setRestrictions] = useState<StayRestrictions>({});

  useEffect(() => {
    (async () => {
      const [res, rr, typesRes, roomsRes, plansRes, blocksRes, invRes, baseRes] = await Promise.all([
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID).order("booked_at", { ascending: false }),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
        supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("inventory_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("base_rate_periods").select("*").eq("hotel_id", HOTEL_ID),
      ]);
      const firstErr =
        res.error ?? rr.error ?? typesRes.error ?? roomsRes.error ?? plansRes.error ?? blocksRes.error ?? invRes.error ?? baseRes.error;
      if (firstErr) {
        setLoadError(firstErr.message);
        setLoading(false);
        return;
      }
      const roomsMap = new Map<string, string[]>();
      for (const row of rr.data ?? []) {
        const list = roomsMap.get(row.reservation_id) ?? [];
        list.push(row.room_number);
        roomsMap.set(row.reservation_id, list);
      }
      setReservations(
        (res.data ?? []).map((r) => ({
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
        })),
      );
      setRoomBlocks(
        (blocksRes.data ?? []).map((b) => ({
          id: b.id,
          roomNumber: b.room_number,
          from: b.from_date,
          to: b.to_date,
          kind: b.kind,
          reason: b.reason ?? "",
        })),
      );
      setInvBlocks(
        (invRes.data ?? []).map((b) => ({
          id: b.id,
          scope: b.scope,
          channelCode: b.channel_code ?? undefined,
          roomTypeId: b.room_type_id,
          from: b.from_date,
          to: b.to_date,
          reason: b.reason ?? undefined,
        })),
      );
      // Bang gia theo ngay (Supabase tra toi da 1000 dong/lan).
      let priceRows: { rate_plan_id: string; date: string; price: number; min_stay: number | null; max_stay: number | null }[] = [];
      if ((plansRes.data ?? []).length > 0) {
        for (let from = 0; ; from += 1000) {
          const { data: page } = await supabase
            .from("rate_prices")
            .select("rate_plan_id, date, price, min_stay, max_stay")
            .in("rate_plan_id", (plansRes.data ?? []).map((p) => p.id))
            .range(from, from + 999);
          priceRows = [...priceRows, ...(page ?? [])];
          if (!page || page.length < 1000) break;
        }
      }
      const dbPlans: RatePlan[] = (plansRes.data ?? []).map((p) => {
        const prices: Record<string, number> = {};
        for (const pr of priceRows) if (pr.rate_plan_id === p.id) prices[pr.date] = pr.price;
        return {
          id: p.id,
          channelCode: p.channel_code,
          roomTypeId: p.room_type_id,
          name: p.name,
          publicName: p.public_name ?? undefined,
          mealPlan: p.meal_plan as RatePlan["mealPlan"],
          baseOccupancy: p.base_occupancy,
          extraAdultFee: p.extra_adult_fee,
          extraChildFee: p.extra_child_fee,
          cancellationPolicy: p.cancellation_policy as RatePlan["cancellationPolicy"],
          derivedFromId: p.derived_from_id ?? undefined,
          formulaId: p.formula_id ?? undefined,
          prices,
        };
      });
      // Giai doan gia goc (de tinh gia suy ra cho ca goi goc lan goi ke thua).
      const basePeriods: BaseRatePeriod[] = (baseRes.data ?? []).map((b) => ({
        id: b.id,
        roomTypeId: b.room_type_id,
        from: b.from_date,
        to: b.to_date,
        price: Number(b.price),
      }));
      setBaseRatePeriods(basePeriods);
      // Han che o toi thieu / toi da theo goi gia + ngay.
      const restr: StayRestrictions = {};
      for (const row of priceRows) {
        if (row.min_stay != null || row.max_stay != null) {
          restr[`${row.rate_plan_id}|${row.date}`] = {
            minStay: row.min_stay ?? undefined,
            maxStay: row.max_stay ?? undefined,
          };
        }
      }
      setRestrictions(restr);
      // Gia rieng cua goi ke thua (gia luu khac gia tinh theo cong thuc).
      const dbOverrides: Record<string, number> = {};
      for (const row of priceRows) {
        const plan = dbPlans.find((p) => p.id === row.rate_plan_id);
        if (plan?.derivedFromId && resolvePlanPrice(plan, row.date, dbPlans, {}, basePeriods) !== Number(row.price)) {
          dbOverrides[`${row.rate_plan_id}|${row.date}`] = Number(row.price);
        }
      }
      setRatePlans(dbPlans);
      setPriceOverrides(dbOverrides);
      setRoomTypes(
        (typesRes.data ?? []).map((t) => ({
          id: t.id,
          code: t.code ?? undefined,
          name: t.name,
          maxOccupancy: t.max_occupancy,
          maxAdults: t.max_adults,
          maxChildren: t.max_children,
          maxInfants: t.max_infants,
          bedConfig: t.bed_config ?? "",
          sizeM2: t.size_sqm ?? undefined,
          priceFloor: t.min_price ?? undefined,
          priceCeiling: t.max_price ?? undefined,
          descriptionVi: t.description_vi ?? undefined,
          descriptionEn: t.description_en ?? undefined,
          active: t.active,
        })),
      );
      setRooms(
        (roomsRes.data ?? []).map((r) => ({
          number: r.number,
          roomTypeId: r.room_type_id,
          housekeepingStatus: r.housekeeping_status as Room["housekeepingStatus"],
        })),
      );
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!HOTEL_ID) {
    return (
      <div className="cb-card mt-10 p-6 text-center">
        <h1 className="text-xl font-bold text-[var(--cb-text)]">Chưa chọn khách sạn</h1>
        <p className="mt-2 text-sm text-[var(--cb-muted)]">Hãy chọn khách sạn trong danh sách trước.</p>
      </div>
    );
  }
  if (loading) {
    return <p className="mt-10 text-center text-sm text-[var(--cb-muted)]">Đang tải dữ liệu...</p>;
  }
  if (loadError) {
    return (
      <p className="mt-10 rounded-lg bg-[#fdecec] px-3 py-2 text-center text-sm text-[#e5484d]">
        Lỗi cơ sở dữ liệu: {loadError}
      </p>
    );
  }
  return (
    <NewReservationWizard
      hotelId={HOTEL_ID}
      accountId={ACCOUNT_ID}
      currency={currency}
      roomTypes={roomTypes}
      rooms={rooms}
      ratePlans={ratePlans}
      reservations={reservations}
      roomBlocks={roomBlocks}
      invBlocks={invBlocks}
      priceOverrides={priceOverrides}
      baseRatePeriods={baseRatePeriods}
      restrictions={restrictions}
    />
  );
}
