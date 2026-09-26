# MuMuAINovel — hướng dẫn dùng trên máy này

- Mở Docker Desktop, sau đó chạy `Start-MuMu.bat`.
- Truy cập http://localhost:8000.
- Tên đăng nhập: `admin`. Mật khẩu nằm ở dòng `LOCAL_AUTH_PASSWORD` trong `.env`.
- Sau khi đăng nhập, mở phần cài đặt AI, điền nhà cung cấp, API key, URL và model của bạn.
- Chạy `Stop-MuMu.bat` để dừng ứng dụng mà vẫn giữ dữ liệu.

Mã nguồn: https://github.com/xiamuceer-j/MuMuAINovel
Ứng dụng chạy bằng image Docker do tác giả phát hành; cấu hình riêng: `compose.local.yaml`.
PostgreSQL lưu dữ liệu trong Docker volume `mumuainovel_postgres_data`. Không xóa volume nếu muốn giữ truyện.
Ảnh bìa lưu trong `storage/generated_covers`; log trong `logs`.
Cấu hình và mật khẩu nằm trong `.env`; không chia sẻ file này.
Ứng dụng và PostgreSQL chỉ mở cổng trên 127.0.0.1.

## Cài mới từ repository

Bản cài hiện tại đã có `.env`. Khi clone trên máy khác, sao chép `backend/.env.example` thành `.env`, đặt mật khẩu mới cho `POSTGRES_PASSWORD` và `LOCAL_AUTH_PASSWORD`, đặt `SESSION_COOKIE_SECURE=false` cho truy cập HTTP localhost. Đặt `POSTGRES_PORT=127.0.0.1:5432` để chỉ mở PostgreSQL trên máy đó.
Chạy `docker compose -f compose.local.yaml pull` trước khi chạy `Start-MuMu.bat` lần đầu.
