# 🤖 Antigravity Token Counter

VS Code Extension dành riêng cho **Google Antigravity IDE** giúp đếm, theo dõi và ước tính chi phí **Input / Output Tokens** theo thời gian thực trực tiếp trên thanh Status Bar.

---

## ✨ Tính Năng Nổi Bật

- 🤖 **⚡ Auto-Detect & Multi-Model Breakdown (Phân loại chi tiết theo từng Model)**: Tự động trích xuất model AI bạn đang sử dụng (Gemini 3.7 Flash, Claude 3.7 Sonnet, GPT-4o, v.v.) từ log hội thoại. Theo dõi và bóc tách chính xác số token & chi phí riêng biệt cho từng model ngay cả khi đổi model giữa chừng trong một phiên chat.
- 📊 **Thống kê theo Model (Breakdown by Model)**: Xem chi tiết tỷ trọng sử dụng (%), số token Input/Output, và số tiền ($) của từng model trong menu QuickPick, Status Bar Tooltip, và file báo cáo Export.
- ⚡ **Real-time Token Counting**: Tự động theo dõi các phiên làm việc (chat / tool calls / tasks) trong Antigravity và cập nhật số token ngay tức thì.
- 📥📤 **Tách biệt Input & Output**: Phân loại chi tiết Input tokens (Prompt người dùng, Context hệ thống, Kết quả tool) và Output tokens (Phản hồi của AI, Tool calls).
- 💵 **Ước tính chi phí ($)**: Hỗ trợ bảng giá cập nhật:
  - **Auto-Detect Model** (Tự động nhận diện theo phiên chat - Mặc định)
  - **Gemini 3.7 Flash** ($0.75/1M In, $3.75/1M Out)
  - **Gemini 2.0 Flash** ($0.10/1M In, $0.40/1M Out)
  - **Gemini 2.0 Flash Lite** ($0.075/1M In, $0.30/1M Out)
  - **Gemini 1.5 Flash** ($0.075/1M In, $0.30/1M Out) / **1.5 Pro** ($1.25/1M In, $5.00/1M Out)
  - **Claude 3.7 / 3.5 Sonnet** ($3.00/1M In, $15.00/1M Out)
  - **Claude 3.5 Haiku** ($0.80/1M In, $4.00/1M Out) / **Claude 3 Opus** ($15.00/1M In, $75.00/1M Out)
  - **GPT-4o** ($2.50/1M In, $10.00/1M Out) / **GPT-4o Mini** ($0.15/1M In, $0.60/1M Out)
  - **OpenAI o3-mini** ($1.10/1M In, $4.40/1M Out) / **o1** ($15.00/1M In, $60.00/1M Out)
  - **Custom Pricing** (Tự điền đơn giá theo ý muốn)
- 📊 **Thống kê đa tầng**:
  - Phiên hiện tại (Current Session)
  - Hôm nay (Today)
  - Toàn bộ lịch sử (All-Time)
  - Phân loại theo từng Model (By Model)
- 🎨 **Tùy biến hiển thị Status Bar**: 4 chế độ hiển thị (*Compact, Detailed, Total-Only, With-Cost*).
- 📑 **Xuất báo cáo (Export Report)**: Hỗ trợ xuất thống kê ra file **Markdown (.md)** hoặc **CSV (.csv)** kèm bảng phân bổ Model Breakdown chi tiết.
- 🔒 **100% Offline & Bảo mật**: Hoạt động hoàn toàn trên máy cục bộ bằng cách đọc file log transcript của Antigravity, không gửi bất kỳ dữ liệu nào qua mạng.

---

## 🚀 Cài Đặt & Sử Dụng

### Cách 1: Cài đặt từ file `.vsix` đã build
1. Chạy lệnh đóng gói:
   ```bash
   npm run package
   ```
2. Cài đặt vào Antigravity IDE:
   - Mở Antigravity IDE
   - Bấm `Ctrl+Shift+P` (hoặc `F1`) -> chọn **Extensions: Install from VSIX...**
   - Chọn file `antigravity-token-counter-1.0.0.vsix` vừa tạo.

### Cách 2: Chạy ở chế độ Development
1. Mở thư mục này trong Antigravity IDE.
2. Bấm `F5` để mở cửa sổ Extension Development Host mới.

---

## ⚙️ Cấu Hình (Settings)

Trong `Settings` (`Ctrl+,`), tìm `antigravityTokenCounter`:

| Thiết lập | Mô tả | Mặc định |
| :--- | :--- | :--- |
| `antigravityTokenCounter.brainPath` | Đường dẫn tới thư mục `brain` của Antigravity | Tự động nhận diện (`~/.gemini/antigravity-ide/brain`) |
| `antigravityTokenCounter.modelPricing` | Profile giá model (`auto`, `gemini-3.7-flash`, `claude-3-7-sonnet`, `custom`,...) | `auto` (Tự động nhận diện) |
| `antigravityTokenCounter.statusBarFormat` | Định dạng status bar (`compact`, `detailed`, `total-only`, `with-cost`) | `compact` |
| `antigravityTokenCounter.pollingIntervalMs` | Khoảng thời gian kiểm tra thay đổi (ms) | `1000` |

---

## 🛠️ Lệnh (Commands)

- `Antigravity Token Counter: Show Stats & Menu` (`antigravityTokenCounter.showStats`): Mở menu tổng quan khi click vào status bar.
- `Antigravity Token Counter: Reset Current Session` (`antigravityTokenCounter.resetSession`): Đặt lại bộ đếm phiên hiện tại về 0.
- `Antigravity Token Counter: Export Token Usage Report` (`antigravityTokenCounter.exportReport`): Xuất báo cáo Markdown/CSV.
- `Antigravity Token Counter: Rescan Active Conversation` (`antigravityTokenCounter.refreshWatcher`): Quét lại các thư mục hội thoại.
