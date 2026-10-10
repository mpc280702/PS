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

---

## Bản nâng cấp giao diện và khởi động an toàn

- Website GitHub Pages là **bản xem trước giao diện**; xử lý ảnh thật cần chạy trong panel UXP của Photoshop.
- `bootstrap.js` chọn đúng chế độ: `index.js` trong Photoshop, `preview.js` trên trình duyệt thông thường.
- Giao diện có trạng thái server rõ ràng, tùy chọn dễ đọc, bố cục thích ứng panel hẹp và hỗ trợ focus bàn phím.
- Script khởi động không còn dừng toàn bộ tiến trình `python.exe`/`pythonw.exe`; nó kiểm tra server trước để tránh mở tiến trình trùng.

### Cài đặt / cập nhật

1. Cài Python tương thích và thư viện bằng `pip install -r requirements.txt`.
2. Chạy `run_ai_server.bat`, chờ model AI khởi tạo xong.
3. Trong Adobe UXP Developer Tool, thêm plugin bằng cách chọn file `manifest.json`, sau đó Load.
4. Mở panel **AI Layer Splitter** trong Photoshop và bấm **Kiểm tra AI Server**.
5. Chạy `cai_dat_tu_dong_chay.bat` nếu muốn thêm server vào mục khởi động Windows.

> Lưu ý: tạo nền bằng OpenCV Inpainting là nội suy điểm ảnh, không phải Generative Fill. Với nền nhiều chi tiết, có thể cần chỉnh sửa thủ công.


---

## Tách từng vật thể bằng SAM (mới)

Chế độ tách nền bằng rembg vẫn hoạt động như trước. Với poster, chữ, họa tiết và hình minh họa cần tách riêng, có thể dùng vùng chọn tương tác **SAM**:

1. Chạy \`cai_dat_sam.bat\` một lần trên Windows có Internet. Model SAM ViT-B sẽ được tải vào thư mục \`models\` (dung lượng lớn, chỉ tải lần đầu).
2. Nếu máy đã cài PyTorch/TorchVision, script giữ nguyên môi trường đó. Nếu chưa có, script mặc định đề nghị bản PyTorch CPU; chọn N nếu bạn muốn tự cài bản CUDA/GPU từ trang PyTorch.
3. Khởi động lại \`run_ai_server.bat\` sau khi cài.
4. Mở panel AI Layer Splitter trong Photoshop, bấm **Nạp ảnh từ Photoshop**.
5. Bấm vào bên trong một vật thể. Dùng điểm \`+\` để giữ thêm phần của vật thể, hoặc \`−\` để loại phần bị dính nhầm. Khi vùng chọn đúng, nhập tên và bấm **Thêm thành layer riêng**.
6. Lặp lại cho chữ, biểu tượng, mây, hoa lá hoặc chi tiết tiếp theo.

**Cơ chế:** SAM tạo mặt nạ từ điểm người dùng chọn, và plugin xuất vùng đã chọn thành PNG trong suốt với cùng kích thước canvas, rồi nhập vào Photoshop thành layer độc lập. Cách chọn có hướng dẫn này hữu ích hơn việc đoán tất cả đối tượng trong poster tự động; các vùng chồng lấn hoặc chi tiết rất nhỏ có thể vẫn cần thêm điểm +/− để tinh chỉnh.

**Khắc phục:** nếu thấy thông báo chưa cài model, chạy lại \`cai_dat_sam.bat\`, xác nhận có \`models/sam_vit_b_01ec64.pth\`, rồi khởi động lại server. Lần nạp model đầu tiên có thể chậm, đặc biệt khi chạy CPU.
