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

## Dùng Claude CLI / Codex CLI thay cho API key

Có thể dùng gói Claude Pro/Max hoặc ChatGPT Plus/Pro thông qua CLI thay vì API key:

1. Cài Node.js, rồi `npm install -g @anthropic-ai/claude-code @openai/codex`. Đăng nhập bằng `claude` (lệnh `/login`) và `codex login`.
2. Chạy `Start-CLI-Bridge.bat` một lần để tạo `tools/cli-bridge/config.json`; copy giá trị `apiKey` trong đó.
3. Thêm `ALLOWED_AI_HOSTS=host.docker.internal` vào `.env`, rồi chạy lại `Start-MuMu.bat` (từ giờ nó tự bật bridge).
4. Trong cài đặt AI của MuMu: nhà cung cấp **OpenAI**, URL `http://host.docker.internal:8787/v1`, API key là `apiKey` ở bước 2, model `claude-sonnet` / `claude-opus` / `claude-haiku` / `codex`.

Chi tiết và giới hạn: `tools/cli-bridge/README.md`.

## Giao diện tiếng Việt và AI viết bằng tiếng Việt

Bản trong repository này đã thêm tiếng Việt (image của tác giả thì chưa có), nên cần tự build image một lần:

```bat
docker compose -f compose.local.yaml build
Start-MuMu.bat
```

- Chuyển ngôn ngữ giao diện bằng nút 中文 / Tiếng Việt ở trang đăng nhập, danh sách dự án hoặc menu người dùng.
- Để AI viết truyện bằng tiếng Việt: vào Cài đặt, mục ngôn ngữ nội dung, chọn **Tiếng Việt**.
- Dữ liệu dựng sẵn (thể loại, ngôi kể, giới tính, loại quan hệ, Skill, phong cách viết, mẫu prompt) và thông báo lỗi/tiến trình từ backend được **phủ lớp nghĩa**: giá trị lưu vẫn là tiếng Trung, chỉ chữ hiển thị đổi sang tiếng Việt. Rê chuột lên để xem nguyên văn (tắt trong Cài đặt).
- Các cụm lệnh kích hoạt Skill (ví dụ 「帮我开书」) giữ nguyên tiếng Trung vì là lệnh cần gõ đúng.

### Cập nhật bản dịch

Yêu cầu Claude CLI đã đăng nhập (xem mục CLI bridge).

```bat
python backend\scripts\export_i18n_values.py
cd frontend
node scripts\i18n-translate.mjs
```

- Lệnh 1 gom chuỗi hiển thị từ backend vào `frontend/src/i18n/locales/values.source.json`.
- Lệnh 2 dịch mọi chuỗi còn thiếu (giao diện `t('...')` và dữ liệu `label()`).
- Gặp chữ Trung chưa dịch khi dùng app: vào **Cài đặt → Xuất văn bản chưa dịch**, rồi chạy `node scripts\i18n-translate.mjs --from đường\dẫn\mumu-missing-translations.json`, sau đó build lại image.
