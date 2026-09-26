# MuMu CLI Bridge

Cầu nối giả lập API OpenAI (`/v1/models`, `/v1/chat/completions`) và xử lý mỗi request bằng **Claude Code CLI** (`claude`) hoặc **OpenAI Codex CLI** (`codex`) đã đăng nhập sẵn trên máy. Nhờ đó MuMu dùng được gói thuê bao Claude Pro/Max hoặc ChatGPT Plus/Pro mà không cần API key trả theo token.

Chỉ dùng module có sẵn của Node.js (18+), không cần `npm install`.

```
MuMu (Docker) ──► http://host.docker.internal:8787/v1 ──► bridge (Windows) ──► claude -p / codex exec
```

## Cài đặt

1. Cài Node.js 18+ (https://nodejs.org).
2. Cài CLI (chỉ cần cái bạn dùng):
   ```bat
   npm install -g @anthropic-ai/claude-code
   npm install -g @openai/codex
   ```
3. Đăng nhập một lần:
   - Claude: chạy `claude`, gõ `/login`, chọn tài khoản Claude (Pro/Max), rồi thoát.
   - Codex: `codex login` (đăng nhập bằng ChatGPT).
4. Chạy `Start-CLI-Bridge.bat` ở thư mục gốc. Lần đầu nó tạo `tools/cli-bridge/config.json` với `apiKey` ngẫu nhiên. Mở file đó và copy `apiKey`.
5. Trong file `.env` ở thư mục gốc, thêm:
   ```
   ALLOWED_AI_HOSTS=host.docker.internal
   ```
   rồi chạy lại `Start-MuMu.bat` (từ giờ `Start-MuMu.bat` tự bật bridge, `Stop-MuMu.bat` tự tắt).
6. Trong MuMu → Cài đặt AI:
   - Nhà cung cấp: **OpenAI** (tương thích OpenAI)
   - URL: `http://host.docker.internal:8787/v1`
   - API key: giá trị `apiKey` trong `config.json`
   - Model: bấm tải danh sách model, chọn `claude-sonnet`, `claude-opus`, `claude-haiku` hoặc `codex`.

Kiểm tra nhanh: mở http://127.0.0.1:8787/health.

## Model

| Model trong MuMu | Chạy bằng |
|---|---|
| `claude-sonnet` / `claude-opus` / `claude-haiku` | `claude --model sonnet/opus/haiku` |
| `claude-...` khác (vd. tên model đầy đủ) | `claude --model <tên đó>` |
| `codex` | `codex exec` với model mặc định trong `~/.codex/config.toml` |
| `codex:<model>` hoặc `gpt-...` | `codex exec -m <model>` |

Sửa mục `models` trong `config.json` để thêm/bớt model hiển thị trong danh sách.

## Cấu hình (`config.json`)

| Khóa | Ý nghĩa |
|---|---|
| `host`, `port` | Địa chỉ lắng nghe, mặc định `127.0.0.1:8787`. Nếu container không kết nối được, đặt `host` thành `0.0.0.0` (khi đó giữ `apiKey` bí mật và không mở cổng ra Internet). |
| `apiKey` | Khóa MuMu phải gửi kèm (`Authorization: Bearer ...`). |
| `requestTimeoutSeconds` | Giới hạn thời gian mỗi lần gọi CLI (mặc định 900 giây). |
| `claude.maxConcurrent`, `codex.maxConcurrent` | Số lần gọi đồng thời; request thừa sẽ xếp hàng. |
| `claude.command`, `codex.command` | Đường dẫn lệnh nếu không nằm trong PATH. |
| `codex.reasoningEffort` | Ví dụ `low` để Codex trả lời nhanh hơn. |
| `baseSystemPrompt` | System prompt nền thay cho persona "trợ lý lập trình" mặc định của CLI. |

## Giới hạn

- `temperature` và `max_tokens` bị bỏ qua (CLI không hỗ trợ).
- Tool calling (Agent dự án, MCP) được **giả lập** bằng prompt: model trả về khối `<tool_call>{...}</tool_call>` và bridge chuyển thành `tool_calls` chuẩn OpenAI. Hoạt động được nhưng kém ổn định hơn API thật. Khi có tool, nội dung được trả về một lần khi xong thay vì stream từng chữ.
- Codex chỉ trả kết quả khi đã xong, nên streaming với Codex hiện ra một lần ở cuối.
- Mỗi request khởi động một tiến trình CLI (thêm vài giây) và tính vào hạn mức gói thuê bao. Sinh hàng loạt chương dễ chạm giới hạn 5 giờ/tuần.
- Chỉ dùng cho cá nhân trên máy của bạn. Không chia sẻ bridge hay mở ra Internet: dùng đăng nhập gói thuê bao cho người khác vi phạm điều khoản của Anthropic/OpenAI.
