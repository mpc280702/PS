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


def choose_model_name() -> str:
    model_path = Path.home() / ".u2net" / "u2net.onnx"
    try:
        if model_path.is_file() and model_path.stat().st_size > 150_000_000:
            return "u2net"
    except OSError:
        pass
    return "u2netp"


log_debug("=== AI Layer Splitter v2 server starting ===")
current_model_name = choose_model_name()
try:
    session = new_session(current_model_name)
    log_debug(f"Loaded model: {current_model_name}")
except Exception as first_error:
    log_debug(f"Could not load {current_model_name}: {first_error}; trying u2netp")
    current_model_name = "u2netp"
    session = new_session("u2netp")
    log_debug("Loaded fallback model: u2netp")


def decode_image_request() -> Image.Image:
    """Read an image from JSON Base64 (UXP) or multipart form (legacy JSX)."""
    if request.is_json:
        data = request.get_json(silent=True) or {}
        encoded = data.get("image_base64")
        if not isinstance(encoded, str) or not encoded.strip():
            raise ValueError("Không tìm thấy image_base64 trong dữ liệu gửi lên.")
        if "," in encoded and encoded.lstrip().lower().startswith("data:image/"):
            encoded = encoded.split(",", 1)[1]
        try:
            raw_bytes = base64.b64decode(encoded, validate=True)
        except Exception as exc:
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


def inpaint_background(original: Image.Image, foreground: Image.Image) -> Image.Image:
    """Fill the foreground mask in the source image with classical OpenCV inpainting."""
    foreground = foreground.convert("RGBA")
    if foreground.size != original.size:
        foreground = foreground.resize(original.size, Image.Resampling.LANCZOS)

    alpha = np.asarray(foreground.getchannel("A"), dtype=np.uint8)
    # Remove semi-transparent subject-edge pixels too, reducing the colour fringe.
    mask = np.where(alpha > 12, 255, 0).astype(np.uint8)
    max_side = max(original.size)
    kernel_size = 3 if max_side < 900 else (5 if max_side < 2200 else 7)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    mask = cv2.dilate(mask, kernel, iterations=1)

    rgb = np.asarray(original.convert("RGB"), dtype=np.uint8)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    radius = float(max(3, min(10, round(max_side / 1500))))
    cleaned_bgr = cv2.inpaint(bgr, mask, radius, cv2.INPAINT_TELEA)
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
        "message": "AI Layer Splitter server is running",
        "api_version": 2,
        "features": ["foreground_extraction", "opencv_inpainting"],
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
        else:
            # Older JSX runner only requested foreground extraction.
            extract_subject = True
            do_inpaint = False

        if not extract_subject and not do_inpaint:
            return jsonify({"status": "error", "error": "Hãy chọn ít nhất một tác vụ xử lý."}), 400

        log_debug(f"Processing image {width}x{height}; foreground={extract_subject}; inpaint={do_inpaint}")
        with inference_lock:
            # rembg returns an RGBA image with estimated alpha mask.
            foreground = remove(original, session=session, post_process_mask=True).convert("RGBA")
        if original.info.get("dpi"):
            foreground.info["dpi"] = original.info["dpi"]

        if foreground.size != original.size:
            foreground = foreground.resize(original.size, Image.Resampling.LANCZOS)

        background = inpaint_background(original, foreground) if do_inpaint else None
        response_data: dict[str, Any] = {
            "status": "success",
            "width": width,
            "height": height,
            "model": current_model_name,
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
    log_debug("Listening on http://127.0.0.1:5000")
    # Loopback-only: do not expose this image-processing server to the LAN.
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
