// ============================================================
// FILE 4 — lib/mock-data.ts (hotel profile + config expansion)
// All MOCK DATA of the project lives here.
// Pages import data from this file to render.
// Later (Phase B) this file is replaced by real data from the
// server — pages don't change, because the data shape stays.
//
// Naming convention (project standard):
//   - File names, variables, functions, types: ENGLISH only
//   - Only user-visible text stays Vietnamese for now;
//     it will move to language files when we add the
//     language switcher (i18n) later.
//
// Version notes:
// - 2026-10-21: Reservation includes "createdAt" in BOTH the
//   type and every sample reservation — type and data must
//   always match.
// - 2026-10-22: Hotel profile + per-hotel config/content added,
//   following the ezCloud hotel-info structure (registration
//   info, config, amenities, photos, nearby places, policies).
//   NEW fields are OPTIONAL on purpose: a hotel that has not
//   filled them in yet must never break a page — the profile
//   completeness meter counts what IS filled.
// ============================================================

// ---------- CHANNELS ----------
export type Channel = {
  code: string; // short code used in code: "website", "booking_com"...
  name: string; // display name
  type: "direct" | "ota" | "offline";
};

export const CHANNELS: Channel[] = [
  { code: "website", name: "Website", type: "direct" },
  { code: "frontdesk", name: "Front Desk", type: "offline" },
  { code: "booking_com", name: "Booking.com", type: "ota" },
  { code: "expedia", name: "Expedia", type: "ota" },
  { code: "airbnb", name: "Airbnb", type: "ota" },
  { code: "agoda", name: "Agoda", type: "ota" },
];

// ---------- ROOM TYPES & PHYSICAL ROOMS ----------
// "code" is the short mapping code used with channels (ezCloud
// style: 1BRG, 2BR...). Occupancy is split into adults/children
// (matches the children policy in the hotel config).
// "active: false" = stop selling this type without deleting it.
export type RoomType = {
  id: string;
  code?: string;
  name: string;
  maxOccupancy: number;
  maxAdults?: number;
  maxChildren?: number;
  bedConfig: string;
  active?: boolean;
  // --- per-room-type detail (managed on the room-type page) ---
  descriptionVi?: string;
  descriptionEn?: string;
  sizeM2?: number;
  maxInfants?: number;
  priceFloor?: number; // safe price range guardrails (VND)
  priceCeiling?: number;
  views?: string[]; // keys from ROOM_VIEWS
  bedOptions?: string[]; // bed setups the guest can choose
  photos?: HotelPhoto[]; // first photo = the type's cover photo
  amenities?: string[]; // keys from ROOM_AMENITY_GROUPS
};

export const ROOM_TYPES: RoomType[] = [
  { id: "deluxe", code: "DLX", name: "Deluxe King", maxOccupancy: 2, maxAdults: 2, maxChildren: 0, bedConfig: "1 king bed", active: true,
    descriptionVi: "Phòng Deluxe King giường lớn, cửa sổ rộng nhìn ra thành phố, phù hợp cho cặp đôi.",
    descriptionEn: "Deluxe King room with a large bed and wide city-view windows, ideal for couples.",
    sizeM2: 28, maxInfants: 1, priceFloor: 700000, priceCeiling: 2000000,
    views: ["city", "mountain"], bedOptions: ["1 giường King"],
    photos: [
      { id: "rt-deluxe-room-1", url: "https://picsum.photos/seed/deluxe-room-1/800/500", caption: "Phòng Deluxe King" },
      { id: "rt-deluxe-room-2", url: "https://picsum.photos/seed/deluxe-room-2/800/500", caption: "Góc cửa sổ" },
    ],
    amenities: ["tv", "aircon", "minibar", "safe", "desk", "wardrobe", "shower", "hairdryer", "toiletries", "coffee", "kettle"] },
  { id: "twin", code: "TWN", name: "Deluxe Twin", maxOccupancy: 2, maxAdults: 2, maxChildren: 0, bedConfig: "2 single beds", active: true,
    descriptionVi: "Phòng Deluxe Twin với 2 giường đơn riêng biệt, phù hợp cho bạn bè hoặc đồng nghiệp đi cùng.",
    descriptionEn: "Deluxe Twin room with two separate single beds, ideal for friends or colleagues.",
    sizeM2: 26, maxInfants: 0, priceFloor: 650000, priceCeiling: 1800000,
    views: ["garden"], bedOptions: ["2 giường đơn"],
    photos: [
      { id: "rt-twin-room-1", url: "https://picsum.photos/seed/twin-room-1/800/500", caption: "Phòng Deluxe Twin" },
      { id: "rt-twin-room-2", url: "https://picsum.photos/seed/twin-room-2/800/500", caption: "Hai giường đơn" },
    ],
    amenities: ["tv", "aircon", "safe", "desk", "wardrobe", "shower", "hairdryer", "toiletries", "kettle"] },
  { id: "studio", code: "STD", name: "Premier Studio", maxOccupancy: 3, maxAdults: 2, maxChildren: 1, bedConfig: "1 king bed + sofa", active: true,
    descriptionVi: "Premier Studio rộng rãi có bếp nhỏ và khu vực sofa, phù hợp cho kỳ nghỉ dài ngày.",
    descriptionEn: "Spacious Premier Studio with a kitchenette and sofa area, great for longer stays.",
    sizeM2: 38, maxInfants: 1, priceFloor: 900000, priceCeiling: 2600000,
    views: ["city", "garden"], bedOptions: ["1 giường King + 1 sofa bed"],
    photos: [
      { id: "rt-studio-room-1", url: "https://picsum.photos/seed/studio-room-1/800/500", caption: "Premier Studio" },
      { id: "rt-studio-room-2", url: "https://picsum.photos/seed/studio-room-2/800/500", caption: "Khu vực bếp nhỏ" },
    ],
    amenities: ["tv", "aircon", "minibar", "safe", "desk", "wardrobe", "bathtub", "shower", "hairdryer", "toiletries", "coffee", "kettle", "sofa", "kitchenette"] },
];

// Room views a room type can offer (shown on the booking engine)
export const ROOM_VIEWS: { key: string; label: string }[] = [
  { key: "city", label: "Hướng thành phố" },
  { key: "garden", label: "Hướng vườn" },
  { key: "pool", label: "Hướng hồ bơi" },
  { key: "lake", label: "Hướng hồ" },
  { key: "river", label: "Hướng sông" },
  { key: "mountain", label: "Hướng núi" },
  { key: "sea", label: "Hướng biển" },
  { key: "park", label: "Hướng công viên" },
];
export const roomViewLabel = (key: string) => ROOM_VIEWS.find((v) => v.key === key)?.label ?? key;

// Amenities that belong to ONE room type (the hotel-wide catalog
// is AMENITY_GROUPS further below)
export const ROOM_AMENITY_GROUPS: { title: string; items: { key: string; label: string }[] }[] = [
  {
    title: "Trong phòng",
    items: [
      { key: "tv", label: "TV màn hình phẳng" },
      { key: "aircon", label: "Điều hoà" },
      { key: "minibar", label: "Minibar" },
      { key: "safe", label: "Két an toàn" },
      { key: "desk", label: "Bàn làm việc" },
      { key: "wardrobe", label: "Tủ quần áo" },
    ],
  },
  {
    title: "Phòng tắm",
    items: [
      { key: "bathtub", label: "Bồn tắm" },
      { key: "shower", label: "Vòi sen đứng" },
      { key: "hairdryer", label: "Máy sấy tóc" },
      { key: "toiletries", label: "Đồ vệ sinh cá nhân" },
    ],
  },
  {
    title: "Ăn uống & thư giãn",
    items: [
      { key: "coffee", label: "Máy pha cà phê/trà" },
      { key: "kettle", label: "Ấm đun nước" },
      { key: "balcony", label: "Ban công" },
      { key: "sofa", label: "Ghế sofa" },
      { key: "kitchenette", label: "Bếp nhỏ" },
    ],
  },
];

export type Room = {
  number: string; // "101", "102"...
  roomTypeId: string;
  housekeepingStatus: "clean" | "dirty" | "in_progress" | "out_of_order";
};

export const ROOMS: Room[] = [
  { number: "101", roomTypeId: "deluxe", housekeepingStatus: "clean" },
  { number: "102", roomTypeId: "deluxe", housekeepingStatus: "clean" },
  { number: "103", roomTypeId: "deluxe", housekeepingStatus: "out_of_order" },
  { number: "104", roomTypeId: "deluxe", housekeepingStatus: "dirty" },
  { number: "201", roomTypeId: "twin", housekeepingStatus: "clean" },
  { number: "202", roomTypeId: "twin", housekeepingStatus: "in_progress" },
  { number: "301", roomTypeId: "studio", housekeepingStatus: "clean" },
  { number: "302", roomTypeId: "studio", housekeepingStatus: "clean" },
];

// ---------- ROOM BLOCKS & INVENTORY BLOCKS ----------
// A ROOM BLOCK takes ONE physical room out of use for a range
// of nights (both ends included):
//   out_of_order   = broken / under repair -> NOT sellable,
//                    subtracted from the rooms-left count
//   out_of_service = temporarily closed (deep clean, painting,
//                    low season) -> still counted in inventory,
//                    only flagged so staff avoid assigning it
// Room 103 below is the same room that carries the timeless
// "out_of_order" housekeeping status: the block is its dated
// plan (in Round B the status becomes a snapshot of blocks).
export type RoomBlock = {
  id: string;
  roomNumber: string;
  from: string; // first blocked night, "2026-10-24"
  to: string; // last blocked night (included)
  kind: "out_of_order" | "out_of_service";
  reason: string;
};

export const ROOM_BLOCKS: RoomBlock[] = [
  { id: "blk-103", roomNumber: "103", from: "2026-10-01", to: "2026-11-30", kind: "out_of_order", reason: "Sửa điều hoà" },
  { id: "blk-302", roomNumber: "302", from: "2026-10-28", to: "2026-10-30", kind: "out_of_service", reason: "Sơn lại tường" },
];

// Is this room blocked on this night? (optionally of one kind)
export const roomBlockOn = (blocks: RoomBlock[], roomNumber: string, date: string, kind?: RoomBlock["kind"]) =>
  blocks.find((b) => b.roomNumber === roomNumber && b.from <= date && date <= b.to && (kind === undefined || b.kind === kind));

// Stop-sell ABOVE the rate-plan level. Together with the
// per-plan stop-sell in the rates grid these are the 3 levels:
//   scope "channel"   = that channel cannot sell this room type
//   scope "room_type" = NO channel can sell this room type
export type InventoryBlock = {
  id: string;
  scope: "channel" | "room_type";
  channelCode?: string; // only when scope = "channel"
  roomTypeId: string;
  from: string;
  to: string; // last blocked night (included)
  reason?: string;
};

export const INVENTORY_BLOCKS: InventoryBlock[] = [
  { id: "ib-airbnb-deluxe", scope: "channel", channelCode: "airbnb", roomTypeId: "deluxe", from: "2026-10-24", to: "2026-10-26", reason: "Dồn phòng cho kênh trực tiếp cuối tuần" },
];

// The inventory block (if any) that stops this channel from
// selling this room type on this night.
export const inventoryBlockOn = (blocks: InventoryBlock[], channelCode: string, roomTypeId: string, date: string) =>
  blocks.find((b) => b.roomTypeId === roomTypeId && b.from <= date && date <= b.to && (b.scope === "room_type" || b.channelCode === channelCode));

// ---------- RATE PLANS — one set per channel ----------
// Per-channel pricing (as designed): every channel has its own
// rate plans with its own prices. Nothing is shared except inventory.
// prices: key = date "2026-10-21", value = price per night (VND)
export type RatePlan = {
  id: string;
  channelCode: string;
  roomTypeId: string;
  name: string; // internal name, e.g. "BDC - Flexible"
  cancellationPolicy: "flexible" | "non_refundable";
  prices: Record<string, number>;
  // --- selling details (shown to guests / used by the rates grid) ---
  publicName?: string; // guest-facing name on the booking engine
  mealPlan?: "room_only" | "breakfast"; // what the price includes
  baseOccupancy?: number; // guests included in the price
  extraAdultFee?: number; // per night, per extra adult above baseOccupancy
  extraChildFee?: number; // per night, per extra child
  // --- price inheritance ("ke thua", ezCloud style) ---
  // A derived plan has no own price list: its price is computed from
  // the base plan with a formula (see PRICE_FORMULAS). The "prices"
  // record of a derived plan only keeps a snapshot so older pages
  // keep working in Round A; the rates grid always computes live
  // with resolvePlanPrice() below.
  derivedFromId?: string; // id of the base rate plan
  formulaId?: string; // id in PRICE_FORMULAS
};

const weekPrices = (weekday: number, weekend: number): Record<string, number> => ({
  "2026-10-21": weekday,
  "2026-10-22": weekday,
  "2026-10-23": weekday,
  "2026-10-24": weekend,
  "2026-10-25": weekend,
  "2026-10-26": weekend,
  "2026-10-27": weekday,
});

export const RATE_PLANS: RatePlan[] = [
  // Website channel — lowest prices (no commission)
  { id: "web-flex", channelCode: "website", roomTypeId: "deluxe", name: "WEB - Flexible", cancellationPolicy: "flexible", prices: weekPrices(900_000, 1_100_000), publicName: "Giá linh hoạt — gồm ăn sáng", mealPlan: "breakfast", baseOccupancy: 2, extraAdultFee: 200000, extraChildFee: 100000 },
  { id: "web-nonref", channelCode: "website", roomTypeId: "deluxe", name: "WEB - Non-refundable", cancellationPolicy: "non_refundable", prices: weekPrices(810_000, 990_000), publicName: "Giá tiết kiệm — không hoàn tiền", mealPlan: "breakfast", baseOccupancy: 2, extraAdultFee: 200000, extraChildFee: 100000 },
  // Booking.com channel — its own price set
  { id: "bdc-flex", channelCode: "booking_com", roomTypeId: "deluxe", name: "BDC - Flexible", cancellationPolicy: "flexible", prices: weekPrices(1_000_000, 1_250_000), publicName: "Flexible - free cancellation", mealPlan: "breakfast", baseOccupancy: 2, extraAdultFee: 250000, extraChildFee: 120000 },
  { id: "bdc-nonref", channelCode: "booking_com", roomTypeId: "deluxe", name: "BDC - Non-refundable", cancellationPolicy: "non_refundable", prices: weekPrices(900_000, 1_125_000), publicName: "Non-refundable - best price", mealPlan: "breakfast", baseOccupancy: 2, extraAdultFee: 250000, extraChildFee: 120000, derivedFromId: "bdc-flex", formulaId: "f-minus10" },
  // Expedia channel — different prices again
  { id: "exp-flex", channelCode: "expedia", roomTypeId: "deluxe", name: "EXP - Flexible", cancellationPolicy: "flexible", prices: weekPrices(1_020_000, 1_275_000), publicName: "Flexible", mealPlan: "breakfast", baseOccupancy: 2, extraAdultFee: 250000, extraChildFee: 120000, derivedFromId: "bdc-flex", formulaId: "f-plus2" },
  // Airbnb channel
  { id: "abb-std", channelCode: "airbnb", roomTypeId: "deluxe", name: "ABB - Standard", cancellationPolicy: "flexible", prices: weekPrices(950_000, 1_150_000), publicName: "Standard - room only", mealPlan: "room_only", baseOccupancy: 2, extraAdultFee: 150000, extraChildFee: 80000 },
  // Front desk (rack rate) — highest
  { id: "fo-rack", channelCode: "frontdesk", roomTypeId: "deluxe", name: "FO - Rack Rate", cancellationPolicy: "flexible", prices: weekPrices(1_200_000, 1_200_000), publicName: "Giá tại quầy — gồm ăn sáng", mealPlan: "breakfast", baseOccupancy: 2, extraAdultFee: 300000, extraChildFee: 150000 },

  { id: "fo-studio", channelCode: "frontdesk", roomTypeId: "studio", name: "FO - Studio Rack", cancellationPolicy: "flexible", prices: weekPrices(1_500_000, 1_700_000), publicName: "Giá tại quầy — Studio", mealPlan: "breakfast", baseOccupancy: 2, extraAdultFee: 250000, extraChildFee: 120000 },

];

// ---------- PRICE FORMULAS & INHERITANCE ----------
// A formula adjusts a base plan's price into a derived plan's
// price. percent: value is a % (e.g. -10 = 10% cheaper, rounded
// to the nearest 1.000 VND); amount: value is added in VND.
export type PriceFormula = {
  id: string;
  name: string;
  kind: "percent" | "amount";
  value: number;
};

export const PRICE_FORMULAS: PriceFormula[] = [
  { id: "f-minus10", name: "Rẻ hơn gói gốc 10%", kind: "percent", value: -10 },
  { id: "f-minus5", name: "Rẻ hơn gói gốc 5%", kind: "percent", value: -5 },
  { id: "f-plus2", name: "Cao hơn gói gốc 2%", kind: "percent", value: 2 },
  { id: "f-plus100k", name: "Cộng thêm 100.000₫", kind: "amount", value: 100000 },
];

export const getFormula = (id?: string): PriceFormula | undefined =>
  PRICE_FORMULAS.find((f) => f.id === id);

export const applyFormula = (price: number, formula: PriceFormula): number => {
  const raw = formula.kind === "percent" ? price * (1 + formula.value / 100) : price + formula.value;
  return Math.round(raw / 1000) * 1000;
};

// The price of a plan on a date, resolved live:
// - base plan: its stored price; a date outside the seeded range
//   falls back to the plan's weekday/weekend sample price
//   (21/10 = weekday sample, 24/10 = weekend sample).
// - derived plan: the base plan's resolved price + its formula.
//   An entry in "overrides" (key "planId|date") is a SPECIAL price
//   set by hand on that date — it wins over the formula.
export const resolvePlanPrice = (
  plan: RatePlan,
  date: string,
  allPlans: RatePlan[],
  overrides?: Record<string, number>
): number | undefined => {
  if (plan.derivedFromId) {
    const special = overrides?.[`${plan.id}|${date}`];
    if (special !== undefined) return special;
    const base = allPlans.find((p) => p.id === plan.derivedFromId);
    if (!base) return undefined;
    const basePrice = resolvePlanPrice(base, date, allPlans, overrides);
    if (basePrice === undefined) return undefined;
    const formula = getFormula(plan.formulaId);
    return formula ? applyFormula(basePrice, formula) : basePrice;
  }
  const direct = plan.prices[date];
  if (direct !== undefined) return direct;
  const dow = new Date(`${date}T12:00:00`).getDay();
  const isWeekend = dow === 0 || dow === 6;
  return plan.prices[isWeekend ? "2026-10-24" : "2026-10-21"];
};

export const mealPlanLabel = (plan: RatePlan): string =>
  plan.mealPlan === "breakfast" ? "Gồm ăn sáng" : "Chỉ phòng";

// ---------- RESERVATIONS ----------
// Note: one reservation can include MULTIPLE rooms ("roomNumbers")
// — learned from the Cloudbeds layout. Empty [] = not assigned yet.
// "paymentCollector" = who collects the guest's money:
// the channel (channel_collect) or the hotel (hotel_collect).
// "createdAt" = the date the booking was made (Date Booked column).
export type ReservationStatus =
  | "pending" // Confirmation Pending
  | "confirmed" // Confirmed
  | "in_house" // In-House (checked in)
  | "checked_out" // Checked Out
  | "cancelled" // Cancelled
  | "no_show"; // No-show

export type Reservation = {
  id: string; // booking code, e.g. "66CJKJTJ6Z"
  guestName: string;
  guestPhone: string;
  channelCode: string;
  paymentCollector: "channel_collect" | "hotel_collect";
  roomNumbers: string[];
  roomTypeId: string;
  ratePlanId: string;
  checkIn: string; // "2026-10-21"
  checkOut: string;
  guests: number; // total guests (adults + children)
  adults?: number;
  children?: number;
  totalAmount: number;
  paidAmount: number;
  status: ReservationStatus;
  createdAt: string; // date the booking was made ("Date Booked" column)
  note?: string;
};

export const RESERVATIONS: Reservation[] = [
  {
    id: "66CJKJTJ6Z", guestName: "Trần Nghi", guestPhone: "0901234567",
    channelCode: "agoda", paymentCollector: "channel_collect",
    roomNumbers: ["301"], roomTypeId: "studio", ratePlanId: "bdc-flex",
    checkIn: "2026-10-21", checkOut: "2026-10-22", guests: 2, adults: 2, children: 0,
    totalAmount: 2_403_341, paidAmount: 2_403_341, status: "confirmed",
    createdAt: "2026-10-21",
  },
  {
    id: "66C5PUWKAE", guestName: "Hoàng Văn Kim", guestPhone: "0912345678",
    channelCode: "frontdesk", paymentCollector: "hotel_collect",
    roomNumbers: ["201", "102"], roomTypeId: "twin", ratePlanId: "fo-rack", // 1 booking — 2 rooms
    checkIn: "2026-10-21", checkOut: "2026-10-23", guests: 4, adults: 4, children: 0,
    totalAmount: 10_080_000, paidAmount: 5_000_000, status: "in_house",
    createdAt: "2026-10-21",
    note: "Small group, needs 2 rooms close together",
  },
  {
    id: "66C0GN74VN", guestName: "Trần Tuyết Ngân", guestPhone: "0933456789",
    channelCode: "frontdesk", paymentCollector: "hotel_collect",
    roomNumbers: ["302"], roomTypeId: "studio", ratePlanId: "fo-rack",
    checkIn: "2026-10-22", checkOut: "2026-10-23", guests: 2, adults: 2, children: 0,
    totalAmount: 1_800_000, paidAmount: 0, status: "pending",
    createdAt: "2026-10-21",
  },
  {
    id: "665PDPB3YD", guestName: "Lê Phương", guestPhone: "0974567890",
    channelCode: "agoda", paymentCollector: "channel_collect",
    roomNumbers: [], roomTypeId: "deluxe", ratePlanId: "bdc-flex", // not assigned yet
    checkIn: "2026-10-22", checkOut: "2026-10-24", guests: 2, adults: 2, children: 0,
    totalAmount: 4_501_576, paidAmount: 4_501_576, status: "confirmed",
    createdAt: "2026-10-20",
  },
  {
    id: "65THTNRT1S", guestName: "Catherine Wong", guestPhone: "+852 9123 4567",
    channelCode: "booking_com", paymentCollector: "hotel_collect",
    roomNumbers: ["104"], roomTypeId: "deluxe", ratePlanId: "bdc-flex",
    checkIn: "2026-10-25", checkOut: "2026-10-26", guests: 1, adults: 1, children: 0,
    totalAmount: 2_306_880, paidAmount: 0, status: "confirmed",
    createdAt: "2026-10-19",
    note: "Late arrival after 22:00",
  },
  {
    id: "65SMRHVHEP", guestName: "Nguyễn Hồng Hạnh", guestPhone: "0909876543",
    channelCode: "website", paymentCollector: "hotel_collect",
    roomNumbers: ["101"], roomTypeId: "deluxe", ratePlanId: "web-flex",
    checkIn: "2026-10-20", checkOut: "2026-10-23", guests: 2, adults: 2, children: 0,
    totalAmount: 5_400_000, paidAmount: 5_400_000, status: "in_house",
    createdAt: "2026-10-19",
  },
];

// ---------- HOTELS ----------
// The product manages MANY hotels (decided 2026-10-22): hotel
// data does NOT live in Settings. Settings (/settings) holds
// system-wide options only; each hotel is managed in its own
// area (/hotels, then /hotels/[id]).
// The Hotel type below is the hotel's PROFILE (the "general
// information" guests see — ezCloud's registration tab).
// Operational data lives per hotel in HOTEL_DATA below.
export type Hotel = {
  id: string;
  code?: string; // short hotel code, e.g. "CH001"
  name: string;
  nameEn?: string; // name in English (content is multilingual)
  address: string;
  country?: string;
  city?: string;
  ward?: string;
  area?: string;
  phone: string;
  email: string;
  starRating?: number;
  businessType?: string; // "Hotel", "Apartment", "Resort"...
  timezone?: string; // the hotel's OWN timezone, e.g. "Asia/Ho_Chi_Minh"
  websiteUrl?: string;
  bookingEngineUrl?: string;
  logoUrl?: string; // "" = no logo yet
  descriptionVi?: string;
  descriptionEn?: string;
  latitude?: number;
  longitude?: number;
  mapZoom?: number;
  checkInTime: string;
  checkOutTime: string;
};

export const HOTELS: Hotel[] = [
  {
    id: "cityhouse-mark",
    code: "CH001",
    name: "CityHouse MARK El Pino Realm",
    nameEn: "CityHouse MARK El Pino Realm",
    address: "Đà Lạt, Lâm Đồng",
    country: "Việt Nam",
    city: "Đà Lạt",
    ward: "Phường 1",
    area: "Trung tâm",
    phone: "0263 000 0000",
    email: "stay@cityhouse.example",
    starRating: 4,
    businessType: "Hotel",
    timezone: "Asia/Ho_Chi_Minh",
    websiteUrl: "https://cityhouse-mark.example",
    bookingEngineUrl: "https://cityhouse-mark.example/booking",
    logoUrl: "",
    descriptionVi:
      "Căn hộ dịch vụ cao cấp tại trung tâm Đà Lạt, cách Hồ Xuân Hương 800m. Phòng rộng, bếp đầy đủ, phù hợp gia đình và khách công tác dài ngày.",
    descriptionEn:
      "Premium serviced apartments in central Da Lat, 800m from Xuan Huong Lake. Spacious rooms with full kitchens, ideal for families and long stays.",
    latitude: 11.9404,
    longitude: 108.4583,
    mapZoom: 15,
    checkInTime: "14:00",
    checkOutTime: "12:00",
  },
  {
    id: "riverside-danang",
    code: "RV001",
    name: "Riverside Hotel Đà Nẵng",
    nameEn: "Riverside Hotel Da Nang",
    address: "Bạch Đằng, Hải Châu, Đà Nẵng",
    country: "Việt Nam",
    city: "Đà Nẵng",
    ward: "Hải Châu",
    area: "Bạch Đằng",
    phone: "0236 000 0000",
    email: "hello@riverside.example",
    starRating: 4,
    businessType: "Hotel",
    timezone: "Asia/Ho_Chi_Minh",
    websiteUrl: "https://riverside-danang.example",
    bookingEngineUrl: "",
    logoUrl: "",
    descriptionVi: "Khách sạn ven sông Hàn, view cầu Rồng.",
    descriptionEn: "Riverside hotel by the Han River, facing the Dragon Bridge.",
    latitude: 16.0544,
    longitude: 108.2022,
    mapZoom: 15,
    checkInTime: "14:00",
    checkOutTime: "12:00",
  },
];

// ---------- AMENITY CATALOG ----------
// The master checklist of amenities (Booking.com-style groups,
// like ezCloud's facilities tab). Each hotel ticks the ones it
// has; the ticked ids are stored in HOTEL_DATA[hotel].amenities.
export type AmenityGroup = {
  id: string;
  name: string;
  items: { id: string; name: string }[];
};

export const AMENITY_GROUPS: AmenityGroup[] = [
  {
    id: "top", name: "Tiện ích nổi bật",
    items: [
      { id: "wifi", name: "Wi-Fi miễn phí" },
      { id: "parking", name: "Bãi đỗ xe" },
      { id: "pool", name: "Hồ bơi" },
      { id: "restaurant", name: "Nhà hàng" },
      { id: "bar", name: "Quầy bar" },
      { id: "spa", name: "Spa" },
      { id: "gym", name: "Phòng gym" },
      { id: "aircon", name: "Điều hoà nhiệt độ" },
      { id: "family_rooms", name: "Phòng gia đình" },
      { id: "nonsmoking", name: "Phòng không hút thuốc" },
      { id: "room_service", name: "Dịch vụ phòng" },
      { id: "frontdesk24", name: "Lễ tân 24 giờ" },
    ],
  },
  {
    id: "transport", name: "Di chuyển",
    items: [
      { id: "airport_shuttle", name: "Xe đưa đón sân bay" },
      { id: "bike_rental", name: "Cho thuê xe đạp" },
      { id: "car_rental", name: "Cho thuê ô tô" },
      { id: "secure_parking", name: "Bãi xe có bảo vệ" },
      { id: "ev_charging", name: "Trạm sạc xe điện" },
    ],
  },
  {
    id: "frontdesk", name: "Dịch vụ lễ tân",
    items: [
      { id: "concierge", name: "Hỗ trợ đặc biệt (concierge)" },
      { id: "currency_exchange", name: "Đổi ngoại tệ" },
      { id: "safe", name: "Két an toàn" },
      { id: "tour_desk", name: "Bàn đặt tour" },
      { id: "express_checkin", name: "Nhận/trả phòng nhanh" },
      { id: "atm", name: "ATM trong khuôn viên" },
    ],
  },
  {
    id: "common", name: "Khu vực chung",
    items: [
      { id: "garden", name: "Sân vườn" },
      { id: "terrace", name: "Sân thượng" },
      { id: "shared_kitchen", name: "Bếp chung" },
      { id: "library", name: "Thư viện" },
      { id: "shared_lounge", name: "Phòng sinh hoạt chung / TV" },
      { id: "game_room", name: "Phòng trò chơi" },
    ],
  },
  {
    id: "family", name: "Giải trí & gia đình",
    items: [
      { id: "playground", name: "Sân chơi trẻ em" },
      { id: "babysitting", name: "Dịch vụ trông trẻ" },
      { id: "kids_tv", name: "Kênh TV trẻ em" },
      { id: "board_games", name: "Trò chơi cờ bàn" },
      { id: "outdoor_play", name: "Thiết bị chơi ngoài trời" },
    ],
  },
  {
    id: "cleaning", name: "Giặt ủi & dọn dẹp",
    items: [
      { id: "laundry", name: "Giặt ủi" },
      { id: "dry_cleaning", name: "Giặt khô" },
      { id: "ironing", name: "Ủi đồ" },
      { id: "daily_housekeeping", name: "Dọn phòng hằng ngày" },
    ],
  },
];

// ---------- PER-HOTEL OPERATIONAL DATA ----------
// Hotel CONFIG = the operating rules of one hotel (ezCloud's
// "hotel configuration"): notification emails, auto-cancel
// rules, weekend definition, currency + tax/fees, children
// policy. Check-in/out times stay on the Hotel profile above
// (other pages already read them from there).
export type HotelConfig = {
  notifyEmail: string; // receives booking notifications
  ccEmail: string;
  bccEmail: string;
  cardEmail: string; // receives OTA card-access codes
  autoCancelUnconfirmed: boolean;
  autoCancelFailedPaymentMinutes: number; // 0 = off
  displayLanguages: string[]; // e.g. ["vi", "en"]
  primaryLanguage: string;
  weekendDays: number[]; // 0 = Sunday ... 6 = Saturday
  currency: string;
  vatPercent: number;
  serviceFeePercent: number;
  pricesIncludeTax: boolean;
  infantMaxAge: number;
  childMaxAge: number;
  childPolicy: string;
  yearBuilt: number;
  floors: number;
  distanceAirportKm: number;
  distanceCenterKm: number;
  airportMinutes: number;
  roomService: boolean;
  regulations: string;
};

// One photo of the hotel. The FIRST photo is the cover photo.
export type HotelPhoto = {
  id: string;
  url: string;
  caption: string;
};

export type NearbyCategory =
  | "nearest" | "popular" | "airport" | "tourist" | "food";

export type NearbyPlace = {
  category: NearbyCategory;
  name: string;
  distanceKm: number;
};

// A named policy (payment or cancellation). Rate plans will
// reference these by name in a later step — richer than the
// simple flexible/non-refundable flag used today.
export type NamedPolicy = {
  id: string;
  name: string;
  description: string;
  active: boolean;
};

// Payment methods shown to guests, applied per sales channel.
export type PaymentMethods = {
  bankTransfer: boolean;
  cash: boolean;
  credit: boolean; // "công nợ" — pay later on account (companies/agents)
  note: string;
  channelCode: string;
};

export type HotelAlerts = {
  email: string;
  lowRoomThreshold: number; // warn when rooms left <= this number
  enabled: boolean;
};

// Per-hotel master data. Hotel 1 reuses the sets above (they
// were always its data). Hotel 2 has its OWN set — different
// room types, different room numbers (5xx/6xx), its own plans.
// Nothing is shared between hotels except the channels list.
export type HotelData = {
  roomTypes: RoomType[];
  rooms: Room[];
  ratePlans: RatePlan[];
  config?: HotelConfig;
  amenities?: string[]; // ticked amenity ids (see AMENITY_GROUPS)
  photos?: HotelPhoto[];
  nearby?: NearbyPlace[];
  paymentPolicies?: NamedPolicy[];
  cancellationPolicies?: NamedPolicy[];
  paymentMethods?: PaymentMethods;
  alerts?: HotelAlerts;
};

export const HOTEL_DATA: Record<string, HotelData> = {
  "cityhouse-mark": {
    roomTypes: ROOM_TYPES,
    rooms: ROOMS,
    ratePlans: RATE_PLANS,
    config: {
      notifyEmail: "reservation@cityhouse.example",
      ccEmail: "",
      bccEmail: "",
      cardEmail: "reservation@cityhouse.example",
      autoCancelUnconfirmed: true,
      autoCancelFailedPaymentMinutes: 30,
      displayLanguages: ["vi", "en"],
      primaryLanguage: "vi",
      weekendDays: [6, 0], // Saturday + Sunday
      currency: "VND",
      vatPercent: 10,
      serviceFeePercent: 5,
      pricesIncludeTax: true,
      infantMaxAge: 6,
      childMaxAge: 12,
      childPolicy: "Trẻ dưới 6 tuổi ngủ chung giường với bố mẹ: miễn phí.",
      yearBuilt: 2019,
      floors: 5,
      distanceAirportKm: 30,
      distanceCenterKm: 1.2,
      airportMinutes: 40,
      roomService: true,
      regulations: "Không hút thuốc trong phòng. Không mang thú cưng.",
    },
    amenities: [
      "wifi", "parking", "restaurant", "bar", "aircon", "family_rooms",
      "nonsmoking", "room_service", "frontdesk24", "garden", "terrace",
      "concierge", "shared_kitchen", "laundry", "daily_housekeeping",
    ],
    photos: [
      { id: "mark-lobby", url: "https://picsum.photos/seed/mark-lobby/800/600", caption: "Sảnh lễ tân" },
      { id: "mark-room1", url: "https://picsum.photos/seed/mark-room1/800/600", caption: "Phòng Deluxe King" },
      { id: "mark-room2", url: "https://picsum.photos/seed/mark-room2/800/600", caption: "Phòng Deluxe Twin" },
      { id: "mark-studio", url: "https://picsum.photos/seed/mark-studio/800/600", caption: "Premier Studio" },
      { id: "mark-bath", url: "https://picsum.photos/seed/mark-bath/800/600", caption: "Phòng tắm" },
      { id: "mark-view", url: "https://picsum.photos/seed/mark-view/800/600", caption: "View thành phố" },
    ],
    nearby: [
      { category: "tourist", name: "Hồ Xuân Hương", distanceKm: 0.8 },
      { category: "food", name: "Chợ đêm Đà Lạt", distanceKm: 1.2 },
      { category: "nearest", name: "Quảng trường Lâm Viên", distanceKm: 1.5 },
      { category: "airport", name: "Sân bay Liên Khương", distanceKm: 30 },
    ],
    paymentPolicies: [
      { id: "pay-at-hotel", name: "Thanh toán tại khách sạn", description: "Khách thanh toán toàn bộ khi nhận phòng.", active: true },
      { id: "deposit-50", name: "Đặt cọc 50%", description: "Đặt cọc 50% khi đặt phòng, phần còn lại thanh toán khi nhận phòng.", active: true },
    ],
    cancellationPolicies: [
      { id: "free-24h", name: "Huỷ miễn phí trước 24 giờ", description: "Miễn phí huỷ đến 24 giờ trước giờ nhận phòng; sau đó tính phí đêm đầu tiên.", active: true },
      { id: "non-refundable", name: "Không hoàn tiền", description: "Không hoàn tiền khi huỷ hoặc không đến.", active: true },
    ],
    paymentMethods: {
      bankTransfer: true, cash: true, credit: false,
      note: "Chuyển khoản trước 50% để giữ phòng.",
      channelCode: "website",
    },
    alerts: { email: "reservation@cityhouse.example", lowRoomThreshold: 2, enabled: true },
  },
  "riverside-danang": {
    roomTypes: [
      { id: "superior", code: "SUP", name: "Superior", maxOccupancy: 2, maxAdults: 2, maxChildren: 0, bedConfig: "1 queen bed", active: true,
    descriptionVi: "Phòng Superior nhìn ra sông Hàn, giường Queen, đầy đủ tiện nghi cho chuyến công tác hoặc nghỉ dưỡng.",
    descriptionEn: "Superior room overlooking the Han River with a queen bed and full amenities.",
    sizeM2: 30, maxInfants: 1, priceFloor: 550000, priceCeiling: 1500000,
    views: ["river"], bedOptions: ["1 giường Queen"],
    photos: [
      { id: "rt-superior-room-1", url: "https://picsum.photos/seed/superior-room-1/800/500", caption: "Phòng Superior" },
      { id: "rt-superior-room-2", url: "https://picsum.photos/seed/superior-room-2/800/500", caption: "Hướng sông Hàn" },
    ],
    amenities: ["tv", "aircon", "minibar", "safe", "desk", "wardrobe", "shower", "hairdryer", "toiletries", "kettle"] },
      { id: "suite", code: "SUI", name: "Suite Sông Hàn", maxOccupancy: 3, maxAdults: 2, maxChildren: 1, bedConfig: "1 king bed + living room", active: true,
    descriptionVi: "Suite Sông Hàn có phòng khách riêng, bồn tắm và ban công nhìn ra cầu Rồng.",
    descriptionEn: "Han River Suite with a separate living room, bathtub and a balcony facing Dragon Bridge.",
    sizeM2: 55, maxInfants: 1, priceFloor: 1200000, priceCeiling: 3200000,
    views: ["river", "city"], bedOptions: ["1 giường King"],
    photos: [
      { id: "rt-suite-room-1", url: "https://picsum.photos/seed/suite-room-1/800/500", caption: "Suite Sông Hàn" },
      { id: "rt-suite-room-2", url: "https://picsum.photos/seed/suite-room-2/800/500", caption: "Phòng khách riêng" },
    ],
    amenities: ["tv", "aircon", "minibar", "safe", "desk", "wardrobe", "bathtub", "shower", "hairdryer", "toiletries", "coffee", "kettle", "sofa", "balcony"] },
    ],
    rooms: [
      { number: "501", roomTypeId: "superior", housekeepingStatus: "clean" },
      { number: "502", roomTypeId: "superior", housekeepingStatus: "clean" },
      { number: "503", roomTypeId: "superior", housekeepingStatus: "dirty" },
      { number: "601", roomTypeId: "suite", housekeepingStatus: "clean" },
      { number: "602", roomTypeId: "suite", housekeepingStatus: "clean" },
    ],
    ratePlans: [
      { id: "rv-web-flex", channelCode: "website", roomTypeId: "superior", name: "WEB - Flexible", cancellationPolicy: "flexible", prices: weekPrices(700_000, 900_000), publicName: "Giá linh hoạt — gồm ăn sáng", mealPlan: "breakfast", baseOccupancy: 2, extraAdultFee: 150000, extraChildFee: 80000 },
      { id: "rv-bdc-flex", channelCode: "booking_com", roomTypeId: "superior", name: "BDC - Flexible", cancellationPolicy: "flexible", prices: weekPrices(780_000, 980_000), publicName: "Flexible", mealPlan: "breakfast", baseOccupancy: 2, extraAdultFee: 180000, extraChildFee: 90000 },
      { id: "rv-web-suite", channelCode: "website", roomTypeId: "suite", name: "WEB - Suite Flexible", cancellationPolicy: "flexible", prices: weekPrices(1_400_000, 1_800_000), publicName: "Suite linh hoạt — gồm ăn sáng", mealPlan: "breakfast", baseOccupancy: 2, extraAdultFee: 250000, extraChildFee: 120000 },
    ],
    config: {
      notifyEmail: "booking@riverside.example",
      ccEmail: "",
      bccEmail: "",
      cardEmail: "booking@riverside.example",
      autoCancelUnconfirmed: false,
      autoCancelFailedPaymentMinutes: 0,
      displayLanguages: ["vi", "en"],
      primaryLanguage: "vi",
      weekendDays: [6, 0],
      currency: "VND",
      vatPercent: 10,
      serviceFeePercent: 5,
      pricesIncludeTax: true,
      infantMaxAge: 6,
      childMaxAge: 12,
      childPolicy: "",
      yearBuilt: 2016,
      floors: 8,
      distanceAirportKm: 8,
      distanceCenterKm: 0.5,
      airportMinutes: 20,
      roomService: true,
      regulations: "",
    },
    amenities: [],
    photos: [],
    nearby: [
      { category: "tourist", name: "Cầu Rồng", distanceKm: 1.5 },
    ],
    paymentPolicies: [
      { id: "rv-pay-at-hotel", name: "Thanh toán tại khách sạn", description: "Khách thanh toán toàn bộ khi nhận phòng.", active: true },
    ],
    cancellationPolicies: [
      { id: "rv-free-48h", name: "Huỷ miễn phí trước 48 giờ", description: "Miễn phí huỷ đến 48 giờ trước giờ nhận phòng.", active: true },
    ],
    paymentMethods: {
      bankTransfer: true, cash: true, credit: true,
      note: "",
      channelCode: "website",
    },
    alerts: { email: "", lowRoomThreshold: 0, enabled: false },
  },
};

// ---------- FOLIO (extras charged to a reservation) ----------
// The folio of a reservation = room charges (from the
// reservation itself) + these extra items - payments (payments
// live on the reservation's paidAmount). This is how laundry,
// minibar, airport shuttle... get charged to the guest.
export type FolioItem = {
  id: string;
  reservationId: string;
  date: string;
  label: string;
  amount: number; // VND, positive = charge to the guest
};

export const FOLIO_ITEMS: FolioItem[] = [
  { id: "fi-kim-shuttle", reservationId: "66C5PUWKAE", date: "2026-10-21", label: "Đưa đón sân bay", amount: 350000 },
  { id: "fi-hanh-laundry", reservationId: "65SMRHVHEP", date: "2026-10-22", label: "Giặt ủi", amount: 120000 },
];

// Extra-guest fees of a plan for ONE night: the price already
// includes baseOccupancy adults; every additional adult costs
// extraAdultFee, every child costs extraChildFee.
export const extraFeesPerNight = (plan: RatePlan, adults: number, children: number) => {
  const extraAdults = Math.max(0, adults - (plan.baseOccupancy ?? 2));
  const adultTotal = extraAdults * (plan.extraAdultFee ?? 0);
  const childTotal = children * (plan.extraChildFee ?? 0);
  return { extraAdults, adultTotal, childTotal, total: adultTotal + childTotal };
};

// ---------- HELPERS ----------
export const getChannelName = (code: string) =>
  CHANNELS.find((c) => c.code === code)?.name ?? code;

export const getRoomTypeName = (id: string) =>
  ROOM_TYPES.find((r) => r.id === id)?.name ?? id;

// The operational data of one hotel; a brand-new hotel that has
// no entry yet gets empty sets (it fills them in step by step).
export const getHotelData = (hotelId: string): HotelData =>
  HOTEL_DATA[hotelId] ?? { roomTypes: [], rooms: [], ratePlans: [] };

// "Today" of the mock data — fixed while learning, real date later
export const TODAY = "2026-10-21";
