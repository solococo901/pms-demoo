import { redirect } from "next/navigation";

// Duong dan cu cua khu lam viec (dashboard, calendar...) khong con ton
// tai — gap thi ve danh sach de chon lai khach san. Nguoc lai,
// /<ten-khach-san> tran -> ve dashboard cua khach san do.
const OLD_WORKSPACE = [
  "dashboard",
  "calendar",
  "reservations",
  "rates",
  "policies",
  "channels",
  "reports",
  "settings",
  "favicon.ico",
];

export default async function HotelHome({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  if (OLD_WORKSPACE.includes(hotelId)) {
    redirect("/");
  }
  redirect(`/${hotelId}/dashboard`);
}
