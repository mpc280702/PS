"""Local AI backend for Photoshop AI Auto Layer Splitter v2.

Runs only on loopback. Foreground extraction uses rembg/U2Net. Background
reconstruction uses OpenCV inpainting, which is classical pixel interpolation,
not generative AI fill.
"""
from __future__ import annotations

import base64
import io
import logging
import os
import re
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from flask import Flask, jsonify, request
from PIL import Image, UnidentifiedImageError
from rembg import new_session, remove

BASE_DIR = Path(__file__).resolve().parent
LOG_PATH = BASE_DIR / "server_debug.log"
MAX_REQUEST_BYTES = 250 * 1024 * 1024
MAX_IMAGE_PIXELS = 45_000_000
OUTPUT_DIR = Path(tempfile.gettempdir()) / "ai_layer_splitter_outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

if sys.stdout is None:
    try:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    except Exception:
        pass
else:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

if sys.stderr is None:
    try:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    except Exception:
        pass
else:
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

logger = logging.getLogger("ai_layer_splitter")
logger.setLevel(logging.INFO)
logger.handlers.clear()
_file_handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
_file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logger.addHandler(_file_handler)
if sys.stdout is not None:
    _stream_handler = logging.StreamHandler(sys.stdout)
    _stream_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(_stream_handler)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES
inference_lock = threading.Lock()


def log_debug(message: Any) -> None:
    try:
        logger.info("%s", message)
    except Exception:
        pass


AVAILABLE_MODELS = ["isnet-general-use", "u2net", "u2netp"]
SESSIONS: dict[str, Any] = {}


def get_session(model_name: str) -> Any:
    if model_name not in AVAILABLE_MODELS:
        model_name = "isnet-general-use"
    with inference_lock:
        if model_name not in SESSIONS:
            log_debug(f"Loading session for model '{model_name}'...")
            try:
                SESSIONS[model_name] = new_session(model_name)
                log_debug(f"Model '{model_name}' initialized successfully.")
            except Exception as err:
                log_debug(f"Failed to load '{model_name}': {err}; falling back to u2netp.")
                if "u2netp" not in SESSIONS:
                    SESSIONS["u2netp"] = new_session("u2netp")
                return SESSIONS["u2netp"]
        return SESSIONS[model_name]


log_debug("=== AI Layer Splitter v2 server starting ===")
# Pre-warm default high-detail model
try:
    current_model_name = "isnet-general-use"
    session = get_session("isnet-general-use")
    log_debug("Primary model isnet-general-use pre-warmed successfully.")
except Exception as init_err:
    log_debug(f"Pre-warm failed: {init_err}")
    current_model_name = "u2netp"
    session = get_session("u2netp")


def decode_image_request() -> Image.Image:
    """Read an image from JSON Base64 (UXP) or multipart form (legacy JSX)."""
    if request.is_json:
        data = request.get_json(silent=True) or {}
        encoded = data.get("image_base64")
        if not isinstance(encoded, str) or not encoded.strip():
            raise ValueError("Không tìm thấy image_base64 trong dữ liệu gửi lên.")
        if "," in encoded:
            encoded = encoded.split(",", 1)[1]
        
        # Xóa sạch khoảng trắng, ký tự xuống dòng (\r, \n) do MIME/UXP tạo ra
        encoded = re.sub(r"[\r\n\s]", "", encoded)
        
        # Bổ sung ký tự '=' padding nếu bị thiếu
        missing_padding = len(encoded) % 4
        if missing_padding:
            encoded += "=" * (4 - missing_padding)

        try:
            raw_bytes = base64.b64decode(encoded)
        except Exception as exc:
            preview = encoded[:40] if isinstance(encoded, str) else ""
            log_debug(f"Base64 decode error: {exc} (length={len(encoded)}, sample={preview!r})")
            raise ValueError("Dữ liệu Base64 của ảnh không hợp lệ.") from exc
    elif "file" in request.files:
        file_storage = request.files["file"]
        raw_bytes = file_storage.read()
        if not raw_bytes:
            raise ValueError("File ảnh được gửi lên đang trống.")
    else:
        raise ValueError("Không tìm thấy dữ liệu ảnh. Hãy gửi image_base64 hoặc file.")

    try:
        with Image.open(io.BytesIO(raw_bytes)) as opened:
            width, height = opened.size
            if width < 1 or height < 1:
                raise ValueError("Kích thước ảnh không hợp lệ.")
            if width * height > MAX_IMAGE_PIXELS:
                raise ValueError(
                    f"Ảnh có {width * height:,} pixel, vượt giới hạn an toàn {MAX_IMAGE_PIXELS:,}. "
                    "Hãy giảm kích thước ảnh rồi thử lại."
                )
            opened.load()
            image = opened.convert("RGBA")
            # Preserve resolution metadata so imported PNG layers retain their
            # physical size when the Photoshop document uses non-72-DPI settings.
            dpi = opened.info.get("dpi")
            if isinstance(dpi, (tuple, list)) and len(dpi) >= 2:
                try:
                    dpi_x, dpi_y = float(dpi[0]), float(dpi[1])
                    if 1 <= dpi_x <= 100000 and 1 <= dpi_y <= 100000:
                        image.info["dpi"] = (dpi_x, dpi_y)
                except (TypeError, ValueError, OverflowError):
                    pass
            return image
    except UnidentifiedImageError as exc:
        raise ValueError("File gửi lên không phải ảnh hợp lệ hoặc định dạng chưa được hỗ trợ.") from exc


def save_png_preserving_dpi(image: Image.Image, destination: Any) -> None:
    """Save PNG output with DPI metadata when the source image has it."""
    options: dict[str, Any] = {"format": "PNG", "optimize": True}
    dpi = image.info.get("dpi")
    if isinstance(dpi, (tuple, list)) and len(dpi) >= 2:
        try:
            dpi_x, dpi_y = float(dpi[0]), float(dpi[1])
            if 1 <= dpi_x <= 100000 and 1 <= dpi_y <= 100000:
                options["dpi"] = (dpi_x, dpi_y)
        except (TypeError, ValueError, OverflowError):
            pass
    image.save(destination, **options)


def encode_png_base64(image: Image.Image) -> str:
    buffer = io.BytesIO()
    save_png_preserving_dpi(image, buffer)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def refine_mask(
    alpha: np.ndarray,
    fill_holes: bool = True,
    remove_speckles: bool = True,
    refine_edges: bool = True,
    max_hole_ratio: float = 0.25,
    min_speckle_px: int = 120,
) -> np.ndarray:
    """Post-process alpha mask to repair internal hollows, eliminate stray noise, and smooth edges."""
    alpha = np.ascontiguousarray(alpha).copy()

    # 1. Fill enclosed holes (e.g. laptop touchpad, keyboards, screen areas)
    if fill_holes:
        binary = (alpha > 25).astype(np.uint8) * 255
        contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        if hierarchy is not None and len(hierarchy) > 0:
            total_area = alpha.shape[0] * alpha.shape[1]
            for i in range(len(contours)):
                # hierarchy[0][i][3] != -1 indicates an interior boundary (a hole)
                if hierarchy[0][i][3] != -1:
                    hole_area = cv2.contourArea(contours[i])
                    if hole_area < total_area * max_hole_ratio:
                        cv2.drawContours(alpha, contours, i, 255, -1)

    # 2. Remove tiny disconnected noise speckles
    if remove_speckles:
        binary = (alpha > 25).astype(np.uint8) * 255
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary)
        for label in range(1, num_labels):
            if stats[label, cv2.CC_STAT_AREA] < min_speckle_px:
                alpha[labels == label] = 0

    # 3. Edge smoothing & defringing
    if refine_edges:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, kernel)
        edge_zone = (alpha > 5) & (alpha < 250)
        if np.any(edge_zone):
            blurred = cv2.GaussianBlur(alpha, (3, 3), 0)
            alpha = np.where(edge_zone, blurred, alpha)

    return alpha


def inpaint_background(original: Image.Image, foreground: Image.Image) -> Image.Image:
    """Fill the foreground mask in the source image with classical OpenCV inpainting."""
    foreground = foreground.convert("RGBA")
    if foreground.size != original.size:
        foreground = foreground.resize(original.size, Image.Resampling.LANCZOS)

    alpha = np.asarray(foreground.getchannel("A"), dtype=np.uint8)
    # Mask corresponds to solid subject area
    mask = np.where(alpha > 25, 255, 0).astype(np.uint8)

    # Moderate dilation to cover anti-aliased subject border without ballooning
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.dilate(mask, kernel, iterations=1)

    rgb = np.asarray(original.convert("RGB"), dtype=np.uint8)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    cleaned_bgr = cv2.inpaint(bgr, mask, 3.0, cv2.INPAINT_TELEA)
    cleaned_rgb = cv2.cvtColor(cleaned_bgr, cv2.COLOR_BGR2RGB)
    result = Image.fromarray(cleaned_rgb, mode="RGB").convert("RGBA")
    if original.info.get("dpi"):
        result.info["dpi"] = original.info["dpi"]
    return result


def save_legacy_outputs(foreground: Image.Image | None, background: Image.Image | None) -> dict[str, str]:
    """Persist compatibility outputs for the old ExtendScript (.jsx) runner."""
    token = uuid.uuid4().hex
    paths: dict[str, str] = {}
    if foreground is not None:
        path = OUTPUT_DIR / f"{token}_foreground.png"
        save_png_preserving_dpi(foreground, path)
        paths["foreground"] = str(path)
    if background is not None:
        path = OUTPUT_DIR / f"{token}_background.png"
        save_png_preserving_dpi(background, path)
        paths["background"] = str(path)
    # Remove old legacy outputs so the temp directory does not grow indefinitely.
    cutoff = time.time() - 24 * 60 * 60
    try:
        for item in OUTPUT_DIR.glob("*.png"):
            try:
                if item.stat().st_mtime < cutoff:
                    item.unlink(missing_ok=True)
            except OSError:
                pass
    except OSError:
        pass
    return paths


@app.after_request
def add_cors_headers(response):
    # The backend binds to 127.0.0.1 only; CORS is needed by the UXP panel.
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Max-Age"] = "600"
    return response


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({"status": "error", "error": "Dữ liệu ảnh vượt giới hạn 250 MB."}), 413


@app.route("/health", methods=["GET", "OPTIONS"])
def health_check():
    if request.method == "OPTIONS":
        return ("", 204)
    return jsonify({
        "status": "ok",
        "model": current_model_name,
        "available_models": AVAILABLE_MODELS,
        "message": "AI Layer Splitter server is running",
        "api_version": 2,
        "features": ["foreground_extraction", "opencv_inpainting", "hole_filling", "edge_refinement"],
    })


@app.route("/process", methods=["POST", "OPTIONS"])
def process_image():
    if request.method == "OPTIONS":
        return ("", 204)

    started_at = time.time()
    try:
        original = decode_image_request()
        width, height = original.size
        if request.is_json:
            data = request.get_json(silent=True) or {}
            extract_subject = bool(data.get("extract_subject", True))
            do_inpaint = bool(data.get("inpaint_background", False))
            chosen_model = str(data.get("model", "isnet-general-use")).strip()
            fill_holes = bool(data.get("fill_holes", True))
            remove_speckles = bool(data.get("remove_speckles", True))
            refine_edges = bool(data.get("refine_edges", True))
            alpha_matting = bool(data.get("alpha_matting", False))
        else:
            extract_subject = True
            do_inpaint = False
            chosen_model = "isnet-general-use"
            fill_holes = True
            remove_speckles = True
            refine_edges = True
            alpha_matting = False

        if not extract_subject and not do_inpaint:
            return jsonify({"status": "error", "error": "Hãy chọn ít nhất một tác vụ xử lý."}), 400

        target_model = chosen_model if chosen_model in AVAILABLE_MODELS else "isnet-general-use"
        active_session = get_session(target_model)

        log_debug(
            f"Processing image {width}x{height} using {target_model}; "
            f"foreground={extract_subject}; inpaint={do_inpaint}; fill_holes={fill_holes}; "
            f"refine_edges={refine_edges}"
        )

        with inference_lock:
            # rembg returns an RGBA image with estimated alpha mask.
            raw_fg = remove(
                original,
                session=active_session,
                post_process_mask=True,
                alpha_matting=alpha_matting,
            ).convert("RGBA")

        if original.info.get("dpi"):
            raw_fg.info["dpi"] = original.info["dpi"]

        if raw_fg.size != original.size:
            raw_fg = raw_fg.resize(original.size, Image.Resampling.LANCZOS)

        # Apply hole filling and edge cleanup to alpha mask
        r_ch, g_ch, b_ch, a_ch = raw_fg.split()
        alpha_arr = np.array(a_ch, dtype=np.uint8)
        alpha_arr = refine_mask(
            alpha_arr,
            fill_holes=fill_holes,
            remove_speckles=remove_speckles,
            refine_edges=refine_edges,
        )
        refined_alpha = Image.fromarray(alpha_arr, mode="L")
        foreground = Image.merge("RGBA", (r_ch, g_ch, b_ch, refined_alpha))
        if original.info.get("dpi"):
            foreground.info["dpi"] = original.info["dpi"]

        background = inpaint_background(original, foreground) if do_inpaint else None
        response_data: dict[str, Any] = {
            "status": "success",
            "width": width,
            "height": height,
            "model": target_model,
            "elapsed_seconds": round(time.time() - started_at, 2),
        }

        if extract_subject:
            response_data["foreground_base64"] = encode_png_base64(foreground)
        if background is not None:
            response_data["background_base64"] = encode_png_base64(background)

        # Keep path fields for the previously supplied ExtendScript script.
        legacy_paths = save_legacy_outputs(foreground if extract_subject else None, background)
        if "foreground" in legacy_paths:
            response_data["foreground"] = legacy_paths["foreground"]
        if "background" in legacy_paths:
            response_data["background"] = legacy_paths["background"]

        log_debug(f"Finished in {response_data['elapsed_seconds']}s")
        return jsonify(response_data)
    except ValueError as exc:
        log_debug(f"Input error: {exc}")
        return jsonify({"status": "error", "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("Image processing failed")
        return jsonify({"status": "error", "error": f"Lỗi xử lý AI: {exc}"}), 500


if __name__ == "__main__":
    log_debug("Starting server on http://127.0.0.1:5000")
    if sys.stdout is not None and not getattr(sys.stdout, "closed", False):
        try:
            print("=====================================================")
            print(" [THÀNH CÔNG] AI Server đã khởi động thành công!")
            print(f" Model đang dùng: {current_model_name}")
            print(" Đang lắng nghe tại: http://127.0.0.1:5000")
            print(" Trạng thái: SẴN SÀNG kết nối với Photoshop!")
            print("=====================================================\n")
        except Exception:
            pass

    try:
        from waitress import serve
        serve(app, host="127.0.0.1", port=5000, threads=6, channel_timeout=300)
    except Exception as serve_err:
        log_debug(f"Waitress fallback to app.run: {serve_err}")
        from flask import cli
        cli.show_server_banner = lambda *_: None
        logging.getLogger("werkzeug").setLevel(logging.ERROR)
        app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)

