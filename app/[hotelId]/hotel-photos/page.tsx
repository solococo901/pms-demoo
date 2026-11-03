import HotelDetailPage from "@/components/HotelDetailPage";

// Khu lam viec /<ten-khach-san>/hotel-photos — trang quan ly thu vien
// anh: mo tab "Thông tin chung" dung muc con "Hình ảnh".
export default async function HotelPhotosPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = await params;
  return <HotelDetailPage hotelId={hotelId} initialTab="general" initialGeneralSub="photos" />;
}
