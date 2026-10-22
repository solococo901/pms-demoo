// ============================================================
// CURRENT HOTEL — lib/current-hotel.ts
// Khach san dang duoc chon o thanh tren (bo chon khach san).
// Luu trong localStorage cua trinh duyet; doi khach san thi
// tai lai trang de moi man hinh doc du lieu cua khach san moi.
// Mac dinh la khach san pilot cityhouse-mark.
// ============================================================

export const HOTEL_STORAGE_KEY = "pms-current-hotel";
export const DEFAULT_HOTEL_ID = "cityhouse-mark";

export function currentHotelId(): string {
  if (typeof window === "undefined") return DEFAULT_HOTEL_ID;
  return window.localStorage.getItem(HOTEL_STORAGE_KEY) ?? DEFAULT_HOTEL_ID;
}
