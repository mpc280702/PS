import sys
import io
import os
import base64

# Đảm bảo in tiếng Việt trên console Windows hoặc chạy ngầm (pythonw) không bị lỗi
log_file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'server_debug.log')

def log_debug(msg):
    try:
        with open(log_file_path, 'a', encoding='utf-8') as f:
            f.write(str(msg) + '\n')
    except Exception:
        pass

if sys.stdout is None or sys.stderr is None:
    null_out = open(os.devnull, 'w', encoding='utf-8')
    if sys.stdout is None:
        sys.stdout = null_out
    if sys.stderr is None:
        sys.stderr = null_out
else:
    try:
        if hasattr(sys.stdout, 'encoding') and sys.stdout.encoding != 'utf-8':
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        if hasattr(sys.stderr, 'encoding') and sys.stderr.encoding != 'utf-8':
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

log_debug("=== Server starting ===")

from flask import Flask, request, jsonify
from PIL import Image
from rembg import remove, new_session

app = Flask(__name__)

# Cho phép Photoshop UXP giao tiếp không bị lỗi CORS
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

log_debug("Loading models...")
# Khởi tạo model AI phù hợp
u2net_path = os.path.expanduser("~/.u2net/u2net.onnx")
current_model_name = "u2netp"

if os.path.exists(u2net_path) and os.path.getsize(u2net_path) > 150000000:
    current_model_name = "u2net"
    log_debug("Using u2net")
else:
    log_debug("Using u2netp")

try:
    session = new_session(current_model_name)
    log_debug("Model loaded successfully")
except Exception as e:
    log_debug(f"Fallback to u2netp: {e}")
    current_model_name = "u2netp"
    session = new_session("u2netp")


print("====================================================")

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        "status": "ok",
        "model": current_model_name,
        "message": "AI Server is running"
    })

@app.route('/process', methods=['POST', 'OPTIONS'])
def process_image():
    if request.method == 'OPTIONS':
        return ('', 204)

    img = None
    try:
        if request.is_json:
            data = request.get_json(silent=True) or {}
            if 'image_base64' in data and data['image_base64']:
                print("[AI Server] Đang nhận ảnh Base64 từ Photoshop...")
                raw_bytes = base64.b64decode(data['image_base64'])
                img = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
        
        if img is None and 'file' in request.files:
            print("[AI Server] Đang nhận ảnh Multipart từ Photoshop...")
            file = request.files['file']
            img = Image.open(file.stream).convert("RGBA")

        if img is None:
            return jsonify({"status": "error", "error": "Không tìm thấy dữ liệu ảnh"}), 400

        w, h = img.size
        print(f"[AI Server] Kích thước ảnh: {w}x{h}. Đang tách chủ thể...")

        # Tách chủ thể bằng AI
        foreground = remove(img, session=session)

        buf = io.BytesIO()
        foreground.save(buf, format="PNG")
        fg_base64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        print("[AI Server] Tách chủ thể thành công! Đang gửi Layer về Photoshop...")
        return jsonify({
            "status": "success",
            "foreground_base64": fg_base64,
            "width": w,
            "height": h
        })
    except Exception as e:
        print(f"[AI Server] Lỗi xử lý: {str(e)}")
        return jsonify({"status": "error", "error": str(e)}), 500

if __name__ == '__main__':
    print("=== AI Photoshop Layer Separator Server đang chạy trên port 5000 ===")
    app.run(host='127.0.0.1', port=5000, debug=False)
