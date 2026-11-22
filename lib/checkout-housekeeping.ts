// HKCHECKOUT1 — lib/checkout-housekeeping.ts (tra phong tu chuyen phong thanh Chua don)
// Sau khi don chuyen sang checked_out, cac phong da gan cua don (dang Sach) chuyen thanh Chua don.
// Phong Dang don / Ngung ban GIU NGUYEN — dieu kien eq housekeeping_status='clean' lam viec nay ngay trong cau update.
import { supabase } from "@/lib/supabase";

// Tra phong tu chuyen phong thanh Chua don (Dot 1 muc 2, ke hoach thang 12).
// Chi doi phong dang Sach; loi thi tra ve chuoi loi chu khong nem — tra phong da xong thi van xong,
// goi noi tu quyet dinh co bao loi hay khong. Can chay SQL 22 truoc de vai tro khong phai admin cung doi duoc.
export async function markRoomsDirtyAfterCheckout(
  hotelId: string,
  roomNumbers: string[]
): Promise<{ flipped: number; error?: string }> {
  if (!hotelId || roomNumbers.length === 0) return { flipped: 0 };
  const { data, error } = await supabase
    .from("rooms")
    .update({ housekeeping_status: "dirty" })
    .eq("hotel_id", hotelId)
    .eq("housekeeping_status", "clean")
    .in("number", roomNumbers)
    .select("number");
  if (error) return { flipped: 0, error: error.message };
  return { flipped: data?.length ?? 0 };
}
