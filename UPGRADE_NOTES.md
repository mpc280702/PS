# Báo cáo rà soát và nâng cấp — AI Layer Splitter

## Kiến trúc hiện tại

- **Giao diện UXP:** `index.html`, `style.css`, `index.js` chạy trong panel Adobe Photoshop.
- **AI Server:** `server.py` dùng Flask, rembg và OpenCV, chỉ lắng nghe trên `127.0.0.1:5000`.
- **Tự khởi động Windows:** `run_ai_server.bat`, `setup_startup.ps1`, `start_hidden.vbs`.
- **Tương thích cũ:** `Auto_Separate_Layers.jsx` sử dụng endpoint multipart và các file kết quả legacy.

## Các vấn đề đã xử lý trong nhánh nâng cấp

1. **Website công khai không phải môi trường Photoshop.** Mã cũ nạp trực tiếp `index.js`, file này gọi `require("photoshop")` và `require("uxp")`; trình duyệt thông thường không có các module đó. Bổ sung `bootstrap.js` để chọn entrypoint phù hợp và `preview.js` giải thích rõ website chỉ là bản xem trước, không giả lập thành công xử lý ảnh.
2. **Script khởi động có thể dừng nhầm ứng dụng khác.** `run_ai_server.bat` từng dừng mọi `pythonw.exe`; `setup_startup.ps1` từng dừng mọi tiến trình `python` và `pythonw`. Hai script giờ kiểm tra endpoint health trước và không còn dừng tiến trình Python toàn hệ thống.
3. **Thông tin model có thể gây hiểu nhầm khi fallback.** Nếu model được chọn không khởi tạo được, server có thể dùng `u2netp` nhưng trả về tên model ban đầu. Server giờ trả lại tên model thực sự đang chạy.
4. **UX và khả năng đọc.** Giao diện có phân cấp rõ hơn, bố cục thích ứng panel hẹp, vùng trạng thái dễ nhìn, focus bàn phím và hướng dẫn về giới hạn của Inpainting.
5. **Tài liệu và phiên bản.** README ghi rõ sự khác nhau giữa website preview và plugin thật; phiên bản manifest tăng lên `2.1.0`.

## Cách cài đặt thử

1. Cập nhật nhánh này về máy hoặc tải source sau khi merge.
2. Chạy `pip install -r requirements.txt` trong môi trường Python tương thích.
3. Chạy `run_ai_server.bat` và đợi model AI khởi tạo.
4. Trong Adobe UXP Developer Tool, thêm plugin bằng file `manifest.json`, rồi Load.
5. Mở panel **AI Layer Splitter** trong Photoshop và dùng **Kiểm tra AI Server** trước khi xử lý ảnh.
6. Chỉ cài tự khởi động Windows khi đã xác nhận server chạy ổn định.

## Các giới hạn và việc nên làm tiếp

- **CORS của server hiện cho phép mọi origin (`Access-Control-Allow-Origin: *`).** Server chỉ bind vào loopback, nhưng website đang mở trong trình duyệt vẫn có thể thử gọi dịch vụ cục bộ. Trước khi dùng thường xuyên, nên thiết kế cơ chế origin/authentication phù hợp với origin thực tế của UXP trong phiên bản Photoshop đang dùng; cần kiểm thử kỹ để không chặn kết nối hợp lệ của plugin.
- OpenCV Inpainting là nội suy pixel, không phải Generative Fill. Kết quả thường kém hơn trên nền nhiều chi tiết, hoa văn hoặc vùng bị che lớn.
- Model AI có thể cần tải trọng số ở lần chạy đầu; tốc độ còn phụ thuộc CPU/RAM và kích thước ảnh.
- Nhánh này đã được rà soát tĩnh qua mã nguồn, **chưa được kiểm thử trực tiếp bên trong Adobe Photoshop/UXP Developer Tool hoặc trên Windows của bạn**. Nên thử với bản sao của tài liệu trước khi dùng cho file quan trọng.
