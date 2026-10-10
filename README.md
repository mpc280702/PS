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


---

## Tách banner thành nhiều layer (v2.3)

Với poster/banner có chữ nghệ thuật, mây, hoa lá, biểu tượng và họa tiết, panel có thêm chế độ **Phân tích toàn banner**. Chế độ này sử dụng SAM Automatic Mask Generator để tìm nhiều vùng ứng viên trên ảnh:

1. Cài SAM một lần bằng file cai_dat_sam.bat, khởi động lại run_ai_server.bat.
2. Trong Photoshop, mở banner và chọn **Tách banner thành nhiều layer**.
3. Chọn mức **Cơ bản / Cân bằng / Chi tiết**, rồi bấm **Phân tích toàn banner**.
4. Xem thumbnail vùng AI tìm được. Bỏ chọn vùng nền lớn, vùng trùng hoặc vùng không cần; sửa tên layer cho dễ quản lý.
5. Bấm **Thêm các phần đã chọn thành layer**. Các vùng được xuất thành PNG RGBA cùng kích thước canvas và nhập lần lượt thành layer riêng.
6. Dùng chế độ **Tinh chỉnh một vật thể bằng điểm chọn** khi muốn chọn lại chính xác một vùng bằng điểm + và −.

### Hiểu đúng kết quả

- SAM tự động tạo **các vùng ứng viên**, không phải hệ thống hiểu ngữ nghĩa hoàn hảo. Một chữ có thể bị chia nhỏ, một cụm họa tiết có thể có nhiều mặt nạ chồng lấn; hãy xem thumbnail và bỏ chọn vùng thừa.
- Các layer mới là phần pixel đã tách, có nền trong suốt và giữ nguyên tọa độ canvas. Để tránh làm hỏng thiết kế, mặc định layer gốc vẫn được giữ nguyên và hiển thị.
- Nếu bật **Ẩn layer gốc sau khi tách**, chỉ các phần được tách còn hiện trên nền trong suốt. Công cụ chưa tự phục dựng nền phức tạp phía sau các vật thể; khi di chuyển phần tử trên banner, bạn có thể cần xóa/retouch vùng cũ hoặc tự dựng layer nền riêng.
- Mức Chi tiết có thể chậm trên CPU và cần nhiều RAM. Nên thử với bản sao của tài liệu, đặc biệt khi xử lý file khổ lớn.


---

## Bản tách banner nhiều thành phần — v2.4

Bản này sửa điểm yếu của v2.3: bản cũ chỉ giữ các mặt nạ lớn trước nên dễ bỏ sót chữ, nhãn nhỏ hoặc họa tiết ở cột bên phải.

Các thay đổi:
- Mức **Cân bằng** và **Chi tiết** quét thêm các crop để bắt được chữ/họa tiết nhỏ, ngoài lượt phân tích toàn ảnh.
- Danh sách vùng được chọn theo nhiều dải kích thước và vị trí trên banner, không chỉ lấy các mặt nạ lớn nhất.
- Mặt nạ nằm gần như hoàn toàn bên trong một vùng khác được đánh dấu **Chi tiết** và không chọn mặc định để tránh nhập trùng hàng loạt.
- Nút **Phần chính** chọn các cụm chính được đề xuất; **Tất cả** bật mọi vùng ứng viên; có thể bỏ chọn vùng nền lớn/vùng sai.
- Tọa độ vùng chọn được quy đổi độc lập theo chiều ngang/dọc để giữ đúng kích thước canvas khi ảnh được thu nhỏ cho AI.

Cách dùng:
1. Cài/cập nhật source mới, sau đó chạy cai_dat_sam.bat nếu SAM chưa được cài.
2. Khởi động lại run_ai_server.bat và nạp lại plugin bằng UXP Developer Tool.
3. Mở banner, chạy **Phân tích toàn banner** ở mức Cân bằng trước. Nếu còn thiếu chi tiết nhỏ, chạy lại ở mức Chi tiết.
4. Bấm **Phần chính** để nhập các vùng lớn hơn trước. Xem thumbnail, sau đó bật thêm các vùng **Chi tiết** cần thiết. Đổi tên layer trước khi nhập.

Lưu ý:
- SAM là mô hình phân đoạn theo hình ảnh, không phải mô hình hiểu cấu trúc thiết kế/kiểu chữ hoàn hảo. Một chữ nghệ thuật có thể tách thành nhiều mặt nạ hoặc một cụm nhiều ký tự có thể thành một vùng.
- Các mặt nạ vẫn có thể chồng lấn. Giữ layer gốc hiển thị trong lúc kiểm tra; chỉ ẩn layer gốc khi đã chắc chắn các vùng quan trọng đều được giữ.
- Công cụ không tự tái tạo pixel nền bị che sau khi di chuyển phần tử. Muốn banner tái cấu trúc hoàn chỉnh, bước dựng nền và kiểm soát thứ tự lớp vẫn có thể cần thao tác thủ công.

 
---
 
## Fix Scratch Disk Full / import performance — v2.5
 
The object export endpoints now return a tightly cropped PNG plus its original canvas offset (crop_x, crop_y), rather than encoding a full-canvas transparent PNG for every small object. The UXP plugin imports each cropped layer and translates it back to the original position. Standard full-canvas foreground/background imports are unchanged.
 
This reduces PNG transfer size, temporary document pixel dimensions, and avoidable scratch-disk usage when importing many banner objects. It cannot replace free scratch-disk space when Photoshop itself reports the disk is full.
 
If Photoshop still shows Scratch Disks Are Full, follow Adobe's steps: close Photoshop after saving work, free space on the configured scratch disk (Adobe recommends at least 100 GB free on the primary scratch disk for demanding work), then set another available drive via Edit > Preferences > Scratch Disks. If Photoshop cannot launch, hold Ctrl+Alt while launching to choose a scratch disk. Source: Adobe Help — Troubleshoot scratch disk full errors.

 
---
 
## Giữ banner liền mạch khi tách layer — v2.6
 
Bản v2.6 bổ sung hai điều còn thiếu khi dùng trên poster nhiều họa tiết:
 
- **Gom vùng gần nhau thành cụm chính:** các mặt nạ SAM chồng lấn hoặc nằm sát nhau có thể được hợp nhất thành một layer cụm. Các mặt nạ nhỏ vẫn có thể hiện ở mục Chi tiết để bạn chọn riêng. Đây là nhóm hình học theo khoảng cách/vùng giao, không phải nhãn ngữ nghĩa do AI hiểu chắc chắn.
- **Layer phần còn lại:** nếu bật tùy chọn ẩn layer gốc, plugin tạo thêm một layer chứa toàn bộ pixel không thuộc các vùng đã chọn. Layer này giữ lại vùng không được SAM nhận diện, giúp các layer mới khi ghép lại không để lộ checkerboard.
 
Layer phần còn lại **không phải nền đã phục dựng**. Nó giữ nguyên pixel cũ ở phần chưa tách, nên nếu bạn di chuyển một vật thể, vùng cũ có thể còn trống hoặc cần retouch. Muốn nền mới sạch hoàn toàn sau khi di chuyển các vật thể, cần inpainting/generative fill phù hợp.
