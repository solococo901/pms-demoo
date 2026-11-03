// ============================================================
// CURRENT HOTEL — lib/current-hotel.ts
// Khach san dang duoc chon o thanh tren (bo chon khach san).
// Luu trong sessionStorage cua trinh duyet: MOI TAB GIU KHACH SAN
// RIENG — mo 2 tab 2 khach san thi khong ghi de len nhau (localStorage
// cu dung chung moi tab nen tab sau ghi de tab truoc). Doi khach san
// thi tai lai trang de moi man hinh doc du lieu cua khach san moi.
// Tab moi mo thang trang chuc nang thi chua co gia tri luu -> khung
// app day ve danh sach de chon. Mac dinh la khach san pilot cityhouse-mark.
// ============================================================

export const HOTEL_STORAGE_KEY = "pms-current-hotel";
export const DEFAULT_HOTEL_ID = "cityhouse-mark";

export function currentHotelId(): string {
  if (typeof window === "undefined") return DEFAULT_HOTEL_ID;
  return window.sessionStorage.getItem(HOTEL_STORAGE_KEY) ?? DEFAULT_HOTEL_ID;
}
