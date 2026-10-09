# Photoshop AI Layer Splitter 🎨⚡

Plugin Photoshop UXP và AI Backend giúp tự động tách nền / tách chủ thể bằng AI (`rembg` / `u2net`) và tạo layer mới trực tiếp trong Adobe Photoshop.

---

## 🌟 Tính Năng

- **Tách chủ thể 1-click**: Tự động nhận diện chủ thể và tách khỏi nền.
- **Tích hợp Photoshop UXP**: Giao diện plugin hiện đại, thao tác trực tiếp trên panel Photoshop.
- **Local AI Server**: Xử lý hoàn toàn offline trên máy tính, bảo mật dữ liệu, không tốn chi phí API bên ngoài.
- **Hỗ trợ tự động chạy ngầm**: Kèm script cấu hình AI Server tự khởi động cùng Windows (chạy ẩn không hiện cửa sổ CMD).

---

## 📁 Cấu Trúc Dự Án

- `server.py`: Server Flask AI cục bộ xử lý tách nền qua thư viện `rembg`.
- `manifest.json`, `index.html`, `index.js`, `style.css`: Giao diện và mã nguồn Photoshop UXP Plugin.
- `Auto_Separate_Layers.jsx`: ExtendScript hỗ trợ tự động hóa layer trong Photoshop.
- `run_ai_server.bat`: File batch chạy AI server thủ công.
- `cai_dat_tu_dong_chay.bat` / `tat_tu_dong_chay.bat`: Cài đặt / gỡ bỏ tự động khởi động server cùng Windows.
- `start_hidden.vbs`: Script VBScript giúp chạy ngầm server hoàn toàn trong nền.

---

## 🚀 Hướng Dẫn Cài Đặt & Sử Dụng

### 1. Cài Đặt Môi Trường Python

Cài đặt các thư viện cần thiết:
```bash
pip install -r requirements.txt
```

### 2. Khởi Động AI Server

- **Chạy thủ công:** Chạy file `run_ai_server.bat` hoặc lệnh:
  ```bash
  python server.py
  ```
- **Chạy tự động cùng Windows (khuyên dùng):** Click đúp vào `cai_dat_tu_dong_chay.bat`.

### 3. Cài Đặt Plugin Vào Photoshop

1. Mở **Adobe UXP Developer Tool**.
2. Chọn **Add Plugin** và trỏ đến thư mục chứa file `manifest.json`.
3. Bấm **Load** để nạp plugin vào Photoshop.
4. Mở Photoshop, vào menu `Plugins` > `Photoshop AI Layer Splitter` để sử dụng!
