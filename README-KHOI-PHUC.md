# Khôi phục pms-demoo (bản cũ tháng 10)

Đây là toàn bộ code bản cũ tháng 10, gồm cả những file mới nhất đã giao
nhưng chưa kịp dán hồi đó (Bán phòng 2 tab, Chặn phòng & Đóng bán,
Thông tin chung / Cấu hình / Loại phòng tách riêng, chi tiết loại phòng
1 trang cuộn). Dữ liệu không nằm trong gói này — dữ liệu nằm trên
project Supabase cũ hồi tháng 10, vẫn còn nguyên.

## Cách chạy lại

1. Giải nén được thư mục `pms-demoo`, mở VS Code tại thư mục đó.
2. Mở terminal tại thư mục đó, chạy: `npm install`
3. Tạo file `.env.local` ngay trong thư mục đó, đúng 4 dòng
   (xem mẫu trong `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_ANON_KEY`:
     lấy trong Supabase, project CŨ hồi tháng 10 (không phải project
     city-house-pms Singapore mới làm sau này), mục Settings → API.
   - `CHANNEX_API_KEY`: key staging của Channex.
   - `CHANNEX_ENV=staging`
4. Chạy: `npm run dev`, mở http://localhost:3000, đăng nhập bằng
   tài khoản cũ.

## Để khỏi mất nữa

Đẩy code lên GitHub ngay sau khi chạy được: tạo repo mới trên GitHub
rồi `git init`, `git add .`, `git commit -m "khoi phuc pms-demoo"`,
`git push`. Từ đó code nằm cả trên máy lẫn trên GitHub.
