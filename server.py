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


def get_session(model_name: str) -> tuple[Any, str]:
    """Return both the loaded session and the model actually in use."""
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
                return SESSIONS["u2netp"], "u2netp"
        return SESSIONS[model_name], model_name


log_debug("=== AI Layer Splitter v2 server starting ===")
# Pre-warm default high-detail model
try:
    session, current_model_name = get_session("isnet-general-use")
    log_debug(f"Primary model pre-warmed successfully: {current_model_name}.")
except Exception as init_err:
    log_debug(f"Pre-warm failed: {init_err}")
    session, current_model_name = get_session("u2netp")


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



# Optional precise object segmentation (Meta Segment Anything / SAM ViT-B).
# It is loaded only when the user opens object-selection mode; the classic
# rembg workflow continues working when SAM is not installed.
SAM_CHECKPOINT_PATH = BASE_DIR / "models" / "sam_vit_b_01ec64.pth"
SAM_STATE: dict[str, Any] = {
    "predictor": None,
    "device": None,
    "image_id": None,
    "image": None,
    "mask": None,
}
SAM_LOAD_LOCK = threading.Lock()
SAM_STATE_LOCK = threading.RLock()


def get_sam_predictor():
    """Lazily load SAM once, so optional SAM dependencies never break normal startup."""
    with SAM_LOAD_LOCK:
        if SAM_STATE["predictor"] is not None:
            return SAM_STATE["predictor"], SAM_STATE["device"]

        if not SAM_CHECKPOINT_PATH.is_file():
            raise RuntimeError(
                "Chưa cài model tách vật thể chi tiết. Chạy cai_dat_sam.bat trong thư mục plugin, "
                "đợi tải model hoàn tất rồi khởi động lại AI Server."
            )
        try:
            import torch
            from segment_anything import SamPredictor, sam_model_registry
        except Exception as exc:
            raise RuntimeError(
                "Thiếu thư viện SAM/PyTorch. Chạy cai_dat_sam.bat để cài chế độ tách vật thể chi tiết."
            ) from exc

        device = "cuda" if torch.cuda.is_available() else "cpu"
        log_debug(f"Loading SAM ViT-B on {device}; this can take a while on first use.")
        try:
            sam = sam_model_registry["vit_b"](checkpoint=str(SAM_CHECKPOINT_PATH))
            sam.to(device=device)
            sam.eval()
            predictor = SamPredictor(sam)
        except Exception as exc:
            raise RuntimeError(f"Không khởi tạo được model SAM: {exc}") from exc

        SAM_STATE["predictor"] = predictor
        SAM_STATE["device"] = device
        log_debug(f"SAM ViT-B ready on {device}.")
        return predictor, device


def _mask_overlay_base64(mask: np.ndarray) -> str:
    """Make a transparent cyan overlay without changing the selected image pixels."""
    h, w = mask.shape
    overlay = np.zeros((h, w, 4), dtype=np.uint8)
    overlay[mask] = (30, 190, 255, 105)
    contour_image = overlay[:, :, :3].copy()
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        cv2.drawContours(contour_image, contours, -1, (255, 255, 255), 1)
        overlay[:, :, :3] = contour_image
    return encode_png_base64(Image.fromarray(overlay, mode="RGBA"))


@app.route("/sam_health", methods=["GET", "OPTIONS"])
def sam_health_check():
    if request.method == "OPTIONS":
        return ("", 204)
    installed = SAM_CHECKPOINT_PATH.is_file()
    return jsonify({
        "status": "ok" if installed else "not_installed",
        "feature": "click_to_segment",
        "checkpoint_found": installed,
        "model_loaded": SAM_STATE["predictor"] is not None,
        "device": SAM_STATE["device"],
        "message": "SAM sẵn sàng." if installed else "Chạy cai_dat_sam.bat để bật chế độ tách vật thể chi tiết.",
    }), (200 if installed else 503)


@app.route("/segment_init", methods=["POST", "OPTIONS"])
def segment_init():
    if request.method == "OPTIONS":
        return ("", 204)
    try:
        predictor, device = get_sam_predictor()
        original = decode_image_request()
        rgb = np.asarray(original.convert("RGB"), dtype=np.uint8)
        with SAM_STATE_LOCK, inference_lock:
            predictor.set_image(rgb)
            image_id = uuid.uuid4().hex
            SAM_STATE["image_id"] = image_id
            SAM_STATE["image"] = original.copy()
            SAM_STATE["mask"] = None
        log_debug(f"SAM image prepared: {original.width}x{original.height} on {device}.")
        return jsonify({
            "status": "success",
            "image_id": image_id,
            "width": original.width,
            "height": original.height,
            "device": device,
            "message": "Ảnh đã sẵn sàng. Bấm vào bên trong một vật thể để chọn.",
        })
    except ValueError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
    except Exception as exc:
        log_debug(f"SAM initialization failed: {exc}")
        return jsonify({"status": "error", "error": str(exc)}), 503


@app.route("/segment_point", methods=["POST", "OPTIONS"])
def segment_point():
    if request.method == "OPTIONS":
        return ("", 204)
    data = request.get_json(silent=True) or {}
    image_id = data.get("image_id")
    points = data.get("points")
    if not isinstance(points, list) or not points or len(points) > 16:
        return jsonify({"status": "error", "error": "Hãy chọn ít nhất một điểm; hỗ trợ tối đa 16 điểm mỗi vật thể."}), 400

    try:
        point_coords = []
        point_labels = []
        for item in points:
            if not isinstance(item, dict):
                raise ValueError("Danh sách điểm không hợp lệ.")
            x, y, label = float(item["x"]), float(item["y"]), int(item["label"])
            if label not in (0, 1):
                raise ValueError("Nhãn điểm chỉ được là 1 (giữ) hoặc 0 (loại trừ).")
            point_coords.append([x, y])
            point_labels.append(label)
        if not any(label == 1 for label in point_labels):
            raise ValueError("Hãy thêm ít nhất một điểm dương (+) bên trong vật thể trước.")
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        return jsonify({"status": "error", "error": f"Điểm chọn không hợp lệ: {exc}"}), 400

    with SAM_STATE_LOCK:
        if not image_id or image_id != SAM_STATE["image_id"] or SAM_STATE["image"] is None:
            return jsonify({"status": "error", "error": "Phiên ảnh đã hết hạn. Hãy nạp lại ảnh Photoshop."}), 409
        image = SAM_STATE["image"]
        if any(x < 0 or y < 0 or x >= image.width or y >= image.height for x, y in point_coords):
            return jsonify({"status": "error", "error": "Điểm chọn nằm ngoài ảnh."}), 400

        try:
            predictor, _device = get_sam_predictor()
            with inference_lock:
                masks, scores, _logits = predictor.predict(
                    point_coords=np.asarray(point_coords, dtype=np.float32),
                    point_labels=np.asarray(point_labels, dtype=np.int32),
                    multimask_output=True,
                )
            best = int(np.argmax(scores))
            mask = np.asarray(masks[best], dtype=bool)
            if mask.shape != (image.height, image.width) or not mask.any():
                raise RuntimeError("Model không tạo được vùng chọn hợp lệ. Hãy thử điểm khác.")
            SAM_STATE["mask"] = mask.copy()
            ys, xs = np.where(mask)
            bbox = {
                "x": int(xs.min()),
                "y": int(ys.min()),
                "width": int(xs.max() - xs.min() + 1),
                "height": int(ys.max() - ys.min() + 1),
            }
            overlay_base64 = _mask_overlay_base64(mask)
            area_px = int(mask.sum())
            return jsonify({
                "status": "success",
                "score": round(float(scores[best]), 4),
                "area_px": area_px,
                "area_percent": round(area_px * 100.0 / (image.width * image.height), 2),
                "bbox": bbox,
                "overlay_base64": overlay_base64,
                "message": "Đã cập nhật vùng chọn. Thêm điểm (+) để mở rộng hoặc (−) để loại trừ vùng không mong muốn.",
            })
        except Exception as exc:
            log_debug(f"SAM point prediction failed: {exc}")
            return jsonify({"status": "error", "error": f"Không tách được vật thể: {exc}"}), 500


@app.route("/segment_export", methods=["POST", "OPTIONS"])
def segment_export():
    if request.method == "OPTIONS":
        return ("", 204)
    data = request.get_json(silent=True) or {}
    image_id = data.get("image_id")
    with SAM_STATE_LOCK:
        if not image_id or image_id != SAM_STATE["image_id"] or SAM_STATE["image"] is None:
            return jsonify({"status": "error", "error": "Phiên ảnh đã hết hạn. Hãy nạp lại ảnh Photoshop."}), 409
        if SAM_STATE["mask"] is None:
            return jsonify({"status": "error", "error": "Chưa có vùng chọn. Hãy bấm vào một vật thể trước."}), 400
        original = SAM_STATE["image"].convert("RGBA")
        mask = SAM_STATE["mask"].astype(bool, copy=True)
        ys, xs = np.where(mask)
        if xs.size == 0 or ys.size == 0:
            return jsonify({"status": "error", "error": "Vùng chọn rỗng. Hãy chọn lại vật thể."}), 422

        # Export only the tight pixel bounds. Full-canvas transparent PNGs for
        # every selected object create avoidable Photoshop scratch-disk usage.
        crop_x, crop_y = int(xs.min()), int(ys.min())
        crop_right, crop_bottom = int(xs.max()) + 1, int(ys.max()) + 1
        crop_mask = mask[crop_y:crop_bottom, crop_x:crop_right]
        crop_image = original.crop((crop_x, crop_y, crop_right, crop_bottom))
        rgba = np.asarray(crop_image, dtype=np.uint8).copy()
        original_alpha = rgba[:, :, 3].copy()
        rgba[:, :, 3] = np.minimum(original_alpha, crop_mask.astype(np.uint8) * 255)
        rgba[~crop_mask, :3] = 0
        layer = Image.fromarray(rgba, mode="RGBA")
        if original.info.get("dpi"):
            layer.info["dpi"] = original.info["dpi"]

        return jsonify({
            "status": "success",
            "width": layer.width,
            "height": layer.height,
            "crop_x": crop_x,
            "crop_y": crop_y,
            "foreground_base64": encode_png_base64(layer),
            "message": "Đã xuất PNG trong suốt cắt sát vùng chọn để tiết kiệm scratch disk.",
        })


@app.route("/segment_close", methods=["POST", "OPTIONS"])
def segment_close():
    if request.method == "OPTIONS":
        return ("", 204)
    data = request.get_json(silent=True) or {}
    with SAM_STATE_LOCK:
        if data.get("image_id") == SAM_STATE["image_id"]:
            SAM_STATE["image_id"] = None
            SAM_STATE["image"] = None
            SAM_STATE["mask"] = None
            predictor = SAM_STATE["predictor"]
            if predictor is not None:
                try:
                    predictor.reset_image()
                except Exception:
                    pass
    return jsonify({"status": "success"})



# Automatic banner decomposition: discover multiple masks, then let the user
# choose which ones should become independent Photoshop layers.
AUTO_STATE: dict[str, Any] = {
    "image_id": None,
    "image": None,
    "work_image": None,
    "scale_x": 1.0,
    "scale_y": 1.0,
    "objects": {},
}
AUTO_STATE_LOCK = threading.RLock()



def _group_nearby_banner_parts(items: list[dict[str, Any]], width: int, height: int) -> list[list[int]]:
    """Group top-level masks that overlap or sit close enough to form one visual component."""
    count = len(items)
    if count <= 1:
        return [[i] for i in range(count)]

    parent = list(range(count))
    bounds = []
    for item in items:
        x, y, w, h = item["bbox"]
        bounds.append([x, y, x + w, y + h])

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    component_bounds = [b[:] for b in bounds]
    max_group_width = width * 0.78
    max_group_height = height * 0.82
    horizontal_gap_limit = max(8, width * 0.026)
    vertical_gap_limit = max(8, height * 0.022)

    for i in range(count):
        ax1, ay1, ax2, ay2 = bounds[i]
        aw, ah = ax2 - ax1, ay2 - ay1
        a_ratio = items[i]["area"] / max(1, width * height)
        a_broad = a_ratio >= 0.62 and aw / max(1, width) >= 0.78 and ah / max(1, height) >= 0.78
        for j in range(i + 1, count):
            bx1, by1, bx2, by2 = bounds[j]
            bw, bh = bx2 - bx1, by2 - by1
            b_ratio = items[j]["area"] / max(1, width * height)
            b_broad = b_ratio >= 0.62 and bw / max(1, width) >= 0.78 and bh / max(1, height) >= 0.78
            if a_broad or b_broad:
                continue

            gap_x = max(0, max(ax1, bx1) - min(ax2, bx2))
            gap_y = max(0, max(ay1, by1) - min(ay2, by2))
            overlap_x = max(0, min(ax2, bx2) - max(ax1, bx1)) / max(1, min(aw, bw))
            overlap_y = max(0, min(ay2, by2) - max(ay1, by1)) / max(1, min(ah, bh))
            close_horizontal = gap_x <= horizontal_gap_limit and overlap_y >= 0.24
            close_vertical = gap_y <= vertical_gap_limit and overlap_x >= 0.24
            overlap_bbox = gap_x == 0 and gap_y == 0 and overlap_x * overlap_y >= 0.18
            if not (close_horizontal or close_vertical or overlap_bbox):
                continue

            root_a, root_b = find(i), find(j)
            if root_a == root_b:
                continue
            a_bounds, b_bounds = component_bounds[root_a], component_bounds[root_b]
            merged = [
                min(a_bounds[0], b_bounds[0]),
                min(a_bounds[1], b_bounds[1]),
                max(a_bounds[2], b_bounds[2]),
                max(a_bounds[3], b_bounds[3]),
            ]
            if merged[2] - merged[0] > max_group_width or merged[3] - merged[1] > max_group_height:
                continue
            parent[root_b] = root_a
            component_bounds[root_a] = merged

    groups: dict[int, list[int]] = {}
    for index in range(count):
        groups.setdefault(find(index), []).append(index)
    return sorted(groups.values(), key=lambda group: max(items[i]["area"] for i in group), reverse=True)


def _auto_object_name(index: int, bbox: tuple[int, int, int, int], image_size: tuple[int, int]) -> str:
    x, y, width, height = bbox
    canvas_w, canvas_h = image_size
    cx = (x + width / 2) / max(1, canvas_w)
    cy = (y + height / 2) / max(1, canvas_h)
    col = "trái" if cx < 0.34 else ("phải" if cx > 0.66 else "giữa")
    row = "trên" if cy < 0.30 else ("dưới" if cy > 0.70 else "trung tâm")
    if width / max(1, canvas_w) > 0.75 and height / max(1, canvas_h) > 0.65:
        row, col = "toàn", "khung"
    return f"Phần {index:02d} · {row} {col}"


def _auto_thumbnail(image: Image.Image, mask: np.ndarray, bbox: tuple[int, int, int, int]) -> str:
    x, y, width, height = bbox
    rgba = np.asarray(image.convert("RGBA").crop((x, y, x + width, y + height)), dtype=np.uint8).copy()
    cropped_mask = mask[y:y + height, x:x + width]
    if rgba.shape[:2] != cropped_mask.shape:
        cropped_mask = cv2.resize(
            cropped_mask.astype(np.uint8),
            (rgba.shape[1], rgba.shape[0]),
            interpolation=cv2.INTER_NEAREST,
        ).astype(bool)
    rgba[:, :, 3] = np.minimum(rgba[:, :, 3], cropped_mask.astype(np.uint8) * 255)
    rgba[~cropped_mask, :3] = 0
    thumbnail = Image.fromarray(rgba, mode="RGBA")
    thumbnail.thumbnail((136, 108), Image.Resampling.LANCZOS)
    return encode_png_base64(thumbnail)



def _diversify_banner_candidates(candidates: list[dict[str, Any]], limit: int, width: int, height: int) -> list[dict[str, Any]]:
    """Choose masks from different size bands and image regions, not only largest masks."""
    buckets: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
    for item in candidates:
        x, y, bw, bh = item["bbox"]
        cx = (x + bw / 2) / max(1, width)
        cy = (y + bh / 2) / max(1, height)
        area_ratio = item["area"] / max(1, width * height)
        if area_ratio >= 0.10:
            band = 0  # broad visual component
        elif area_ratio >= 0.025:
            band = 1  # main object / text block
        elif area_ratio >= 0.005:
            band = 2  # medium-sized ornament or label
        else:
            band = 3  # lettering / fine detail
        grid_x = min(2, max(0, int(cx * 3)))
        grid_y = min(2, max(0, int(cy * 3)))
        key = (band, grid_y, grid_x)
        item["selection_score"] = 0.62 * item["quality"] + 0.38 * item["stability"]
        buckets.setdefault(key, []).append(item)

    for bucket in buckets.values():
        bucket.sort(key=lambda item: item["selection_score"], reverse=True)

    ordered_keys = sorted(buckets)
    selected: list[dict[str, Any]] = []
    # Round-robin across spatial and scale buckets to protect smaller regions
    # in side columns, headers and corners from being crowded out by mountains
    # or large decorative clusters.
    while len(selected) < limit:
        changed = False
        for key in ordered_keys:
            if buckets[key]:
                selected.append(buckets[key].pop(0))
                changed = True
                if len(selected) >= limit:
                    break
        if not changed:
            break
    return selected


@app.route("/segment_auto", methods=["POST", "OPTIONS"])
def segment_auto():
    if request.method == "OPTIONS":
        return ("", 204)
    started_at = time.time()
    try:
        import torch
        from segment_anything import SamAutomaticMaskGenerator

        original = decode_image_request()
        width, height = original.size
        profile = str((request.get_json(silent=True) or {}).get("quality", "balanced")).lower()
        # The balanced/detail profiles scan one crop layer as well as the full
        # image. This recovers smaller lettering and ornament masks that are
        # commonly missed when SAM only samples the whole banner at once.
        profiles = {
            "coarse": {"points_per_side": 12, "pred_iou_thresh": 0.86, "stability_score_thresh": 0.90, "limit": 36, "crop_layers": 0},
            "balanced": {"points_per_side": 20, "pred_iou_thresh": 0.84, "stability_score_thresh": 0.88, "limit": 72, "crop_layers": 1},
            "detail": {"points_per_side": 28, "pred_iou_thresh": 0.82, "stability_score_thresh": 0.86, "limit": 120, "crop_layers": 1},
        }
        config = profiles.get(profile, profiles["balanced"])
        predictor, device = get_sam_predictor()
        model = predictor.model

        max_side = 2048
        scale = min(1.0, max_side / max(width, height))
        work_w = max(1, int(round(width * scale)))
        work_h = max(1, int(round(height * scale)))
        if scale < 1:
            work_image = original.resize((work_w, work_h), Image.Resampling.LANCZOS)
        else:
            work_image = original.copy()
        rgb = np.asarray(work_image.convert("RGB"), dtype=np.uint8)

        # Use a lock because the local models share memory with other endpoints.
        with inference_lock:
            generator = SamAutomaticMaskGenerator(
                model=model,
                points_per_side=config["points_per_side"],
                pred_iou_thresh=config["pred_iou_thresh"],
                stability_score_thresh=config["stability_score_thresh"],
                box_nms_thresh=0.72,
                crop_n_layers=config["crop_layers"],
                crop_n_points_downscale_factor=2,
                crop_overlap_ratio=0.32,
                min_mask_region_area=max(12, int(work_w * work_h * 0.00012)),
                output_mode="binary_mask",
            )
            generated = generator.generate(rgb)

        total = work_w * work_h
        if profile == "coarse":
            min_area_ratio, max_area_ratio = 0.0025, 0.76
        elif profile == "detail":
            min_area_ratio, max_area_ratio = 0.00018, 0.78
        else:
            min_area_ratio, max_area_ratio = 0.00065, 0.76
        min_area = max(30, int(total * min_area_ratio))
        candidates = []
        for item in generated:
            mask = np.asarray(item.get("segmentation"), dtype=bool)
            area = int(item.get("area", int(mask.sum())))
            ratio = area / max(1, total)
            quality = float(item.get("predicted_iou", 0.0))
            stability = float(item.get("stability_score", 0.0))
            if mask.shape != (work_h, work_w) or area < min_area or ratio > max_area_ratio:
                continue
            if quality < config["pred_iou_thresh"] - 0.06 or stability < config["stability_score_thresh"] - 0.06:
                continue
            bbox_values = item.get("bbox", [0, 0, 0, 0])
            bx, by, bw, bh = [int(round(float(v))) for v in bbox_values]
            if bw < 1 or bh < 1:
                continue
            candidates.append({
                "mask": mask,
                "area": area,
                "quality": quality,
                "stability": stability,
                "bbox": (bx, by, bw, bh),
            })

        # Drop near-identical masks, while keeping nested masks that represent
        # different-sized pieces of text, illustrations, or decorative clusters.
        candidates.sort(
            key=lambda item: (
                0.62 * item["quality"] + 0.38 * item["stability"],
                item["area"],
            ),
            reverse=True,
        )
        unique = []
        for candidate in candidates:
            bx, by, bw, bh = candidate["bbox"]
            duplicate = False
            for kept in unique:
                kx, ky, kw, kh = kept["bbox"]
                inter_x1, inter_y1 = max(bx, kx), max(by, ky)
                inter_x2, inter_y2 = min(bx + bw, kx + kw), min(by + bh, ky + kh)
                if inter_x2 <= inter_x1 or inter_y2 <= inter_y1:
                    continue
                # Cheap bbox test first; pixel IoU only for close candidates.
                inter = np.logical_and(
                    candidate["mask"][inter_y1:inter_y2, inter_x1:inter_x2],
                    kept["mask"][inter_y1:inter_y2, inter_x1:inter_x2],
                ).sum()
                union = candidate["area"] + kept["area"] - int(inter)
                if union and int(inter) / union > 0.93:
                    duplicate = True
                    break
            if not duplicate:
                unique.append(candidate)

        # First remove near-exact duplicates, then choose a size- and position-
        # balanced set. The previous version took only the largest masks, which
        # crowded out small title lettering, labels and decorative flourishes.
        if not unique:
            return jsonify({
                "status": "error",
                "error": "SAM chưa tìm được vùng đủ rõ. Hãy thử mức Chi tiết hoặc dùng chế độ bấm chọn vật thể.",
            }), 422

        selected = _diversify_banner_candidates(unique, config["limit"], work_w, work_h)
        selected.sort(key=lambda item: item["area"], reverse=True)

        # Mark masks almost fully contained in another candidate as detail layers.
        parent_indices: list[int | None] = []
        for child_index, child in enumerate(selected):
            child_parent = None
            cx, cy, cw, ch = child["bbox"]
            for parent_index in range(child_index - 1, -1, -1):
                parent = selected[parent_index]
                if child["area"] >= parent["area"] * 0.78:
                    continue
                px, py, pw, ph = parent["bbox"]
                x1, y1 = max(cx, px), max(cy, py)
                x2, y2 = min(cx + cw, px + pw), min(cy + ch, py + ph)
                if x2 <= x1 or y2 <= y1:
                    continue
                child_crop = child["mask"][y1:y2, x1:x2]
                parent_crop = parent["mask"][y1:y2, x1:x2]
                overlap = int(np.logical_and(child_crop, parent_crop).sum())
                if overlap / max(1, child["area"]) >= 0.92:
                    child_parent = parent_index
                    break
            parent_indices.append(child_parent)

        # Build coherent spatial clusters from top-level SAM masks. This is a
        # visual grouping heuristic, not semantic recognition: close/overlapping
        # fragments can be exported as one banner component, while the individual
        # fragments remain available as optional detail layers.
        main_indices = [i for i, parent in enumerate(parent_indices) if parent is None]
        main_candidates = [selected[i] for i in main_indices]
        main_groups = _group_nearby_banner_parts(main_candidates, work_w, work_h)

        objects = {}
        response_objects = []
        scale_x = width / max(1, work_w)
        scale_y = height / max(1, work_h)
        main_index_to_group: dict[int, str] = {}
        group_sizes: dict[str, int] = {}

        def pack_mask(mask: np.ndarray, quality: float, stability: float, object_id: str,
                      name: str, category: str, parent_id: str | None,
                      default_selected: bool) -> None:
            mask = np.asarray(mask, dtype=bool)
            ys, xs = np.where(mask)
            if xs.size == 0 or ys.size == 0:
                return
            bx, by = int(xs.min()), int(ys.min())
            right, bottom = int(xs.max()) + 1, int(ys.max()) + 1
            bw, bh = right - bx, bottom - by
            scaled_bbox = (
                int(round(bx * scale_x)),
                int(round(by * scale_y)),
                max(1, int(round(bw * scale_x))),
                max(1, int(round(bh * scale_y))),
            )
            area = int(mask.sum())
            preview = _auto_thumbnail(work_image, mask, (bx, by, bw, bh))
            objects[object_id] = {
                "mask": mask,
                "bbox": scaled_bbox,
                "area": area,
                "quality": quality,
                "stability": stability,
                "parent_id": parent_id,
                "default_selected": default_selected,
                "name": name,
            }
            response_objects.append({
                "id": object_id,
                "name": name,
                "category": category,
                "parent_id": parent_id,
                "default_selected": default_selected,
                "bbox": {
                    "x": scaled_bbox[0],
                    "y": scaled_bbox[1],
                    "width": scaled_bbox[2],
                    "height": scaled_bbox[3],
                },
                "area_percent": round(area * 100.0 / max(1, total), 3),
                "score": round(float(quality), 3),
                "thumbnail_base64": preview,
            })

        # Export groups first and choose those by default. Very broad masks
        # covering nearly the entire composition are treated as optional backdrop
        # candidates so they do not swallow the actual individual components.
        for group_number, local_members in enumerate(main_groups, start=1):
            member_indices = [main_indices[local] for local in local_members]
            group_id = f"group-{group_number:03d}"
            for selected_index in member_indices:
                main_index_to_group[selected_index] = group_id
            group_sizes[group_id] = len(member_indices)

            group_mask = np.zeros((work_h, work_w), dtype=bool)
            for selected_index in member_indices:
                group_mask |= np.asarray(selected[selected_index]["mask"], dtype=bool)
            group_area_ratio = float(group_mask.sum()) / max(1, total)
            group_y, group_x = np.where(group_mask)
            group_bbox = (
                int(group_x.min()),
                int(group_y.min()),
                int(group_x.max() - group_x.min() + 1),
                int(group_y.max() - group_y.min() + 1),
            )
            broad_scene_mask = (
                group_area_ratio >= 0.62
                and group_bbox[2] / max(1, work_w) >= 0.78
                and group_bbox[3] / max(1, work_h) >= 0.78
            )
            scaled_group_bbox = (
                int(round(group_bbox[0] * scale_x)),
                int(round(group_bbox[1] * scale_y)),
                max(1, int(round(group_bbox[2] * scale_x))),
                max(1, int(round(group_bbox[3] * scale_y))),
            )
            group_name = _auto_object_name(group_number, scaled_group_bbox, (width, height))
            if len(member_indices) > 1:
                group_name = f"Cụm {group_number:02d} · " + group_name.split("·", 1)[-1].strip()
            else:
                group_name = f"Phần {group_number:02d} · " + group_name.split("·", 1)[-1].strip()
            category = "Vùng bao cảnh" if broad_scene_mask else ("Cụm chính" if len(member_indices) > 1 else "Phần chính")
            mean_quality = float(np.mean([selected[i]["quality"] for i in member_indices]))
            mean_stability = float(np.mean([selected[i]["stability"] for i in member_indices]))
            pack_mask(
                group_mask, mean_quality, mean_stability, group_id, group_name,
                category, None, not broad_scene_mask,
            )

        # Return individual masks as opt-in details. A singleton group needs no
        # duplicate detail row, but split/overlapping groups expose their member
        # masks so designers can refine a component at finer granularity.
        for index, item in enumerate(selected, start=1):
            is_main = parent_indices[index - 1] is None
            root_index = index - 1
            seen_roots = set()
            while parent_indices[root_index] is not None and root_index not in seen_roots:
                seen_roots.add(root_index)
                root_index = int(parent_indices[root_index])
            parent_group_id = main_index_to_group.get(root_index)

            if is_main and parent_group_id and group_sizes.get(parent_group_id, 1) == 1:
                continue

            bx, by, bw, bh = item["bbox"]
            scaled_bbox = (
                int(round(bx * scale_x)),
                int(round(by * scale_y)),
                max(1, int(round(bw * scale_x))),
                max(1, int(round(bh * scale_y))),
            )
            name = _auto_object_name(index, scaled_bbox, (width, height))
            object_id = f"auto-{index:03d}"
            pack_mask(
                np.asarray(item["mask"], dtype=bool),
                float(item["quality"]),
                float(item["stability"]),
                object_id,
                f"Chi tiết {index:02d} · " + name.split("·", 1)[-1].strip(),
                "Chi tiết",
                parent_group_id,
                False,
            )

        image_id = uuid.uuid4().hex
        with AUTO_STATE_LOCK:
            AUTO_STATE.update({
                "image_id": image_id,
                "image": original.copy(),
                "work_image": work_image.copy(),
                "scale_x": width / max(1, work_w),
                "scale_y": height / max(1, work_h),
                "objects": objects,
            })
        log_debug(
            f"Auto banner segmentation produced {len(response_objects)} candidates "
            f"from {width}x{height} image, profile={profile}, device={device}, "
            f"elapsed={round(time.time() - started_at, 2)}s"
        )
        return jsonify({
            "status": "success",
            "image_id": image_id,
            "width": width,
            "height": height,
            "device": device,
            "quality": profile,
            "count": len(response_objects),
            "elapsed_seconds": round(time.time() - started_at, 2),
            "objects": response_objects,
            "message": "Đã phân tích banner. Chọn các vùng cần tách thành layer riêng.",
        })
    except ValueError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
    except Exception as exc:
        log_debug(f"Automatic banner segmentation failed: {exc}")
        return jsonify({"status": "error", "error": f"Không phân tích được banner tự động: {exc}"}), 500


@app.route("/segment_auto_export", methods=["POST", "OPTIONS"])
def segment_auto_export():
    if request.method == "OPTIONS":
        return ("", 204)
    data = request.get_json(silent=True) or {}
    image_id = data.get("image_id")
    object_id = data.get("object_id")
    with AUTO_STATE_LOCK:
        if not image_id or image_id != AUTO_STATE["image_id"] or AUTO_STATE["image"] is None:
            return jsonify({"status": "error", "error": "Phiên phân tích đã hết hạn. Hãy phân tích banner lại."}), 409
        original = AUTO_STATE["image"].convert("RGBA")

        # Special export mode: make a complementary "remaining artwork" layer
        # from all pixels not covered by the exact masks the user chose to import.
        # This is not an inpainted background; it preserves every source pixel so
        # the visible layer stack can reconstruct the original banner without
        # checkerboard holes when the source layers are hidden.
        if object_id == "__remainder__":
            selected_ids = data.get("object_ids")
            if not isinstance(selected_ids, list) or not selected_ids:
                return jsonify({"status": "error", "error": "Thiếu danh sách vùng đã chọn để tạo layer phần còn lại."}), 400
            if len(selected_ids) > 160:
                return jsonify({"status": "error", "error": "Có quá nhiều vùng được chọn. Hãy tách thành vài nhóm."}), 400
            work_image = AUTO_STATE["work_image"]
            if work_image is None:
                return jsonify({"status": "error", "error": "Phiên phân tích đã hết hạn. Hãy phân tích banner lại."}), 409
            union_mask = np.zeros((work_image.height, work_image.width), dtype=bool)
            for selected_id in selected_ids:
                selected_item = AUTO_STATE["objects"].get(selected_id)
                if selected_item is None:
                    return jsonify({"status": "error", "error": f"Không tìm thấy vùng {selected_id}."}), 404
                union_mask |= np.asarray(selected_item["mask"], dtype=bool)
            full_union = cv2.resize(
                union_mask.astype(np.uint8),
                (original.width, original.height),
                interpolation=cv2.INTER_NEAREST,
            ).astype(bool)
            full_mask = ~full_union
            export_name = "AI - Phần còn lại (giữ nguyên pixel banner)"
        else:
            item = AUTO_STATE["objects"].get(object_id)
            if item is None:
                return jsonify({"status": "error", "error": "Không tìm thấy vùng được chọn. Hãy phân tích banner lại."}), 404
            work_mask = np.asarray(item["mask"], dtype=np.uint8)
            full_mask = cv2.resize(
                work_mask,
                (original.width, original.height),
                interpolation=cv2.INTER_NEAREST,
            ).astype(bool)
            export_name = str(item.get("name") or object_id)

        ys, xs = np.where(full_mask)
        if xs.size == 0 or ys.size == 0:
            return jsonify({"status": "error", "error": "Mặt nạ vùng chọn rỗng. Hãy phân tích banner lại."}), 422

        crop_x, crop_y = int(xs.min()), int(ys.min())
        crop_right, crop_bottom = int(xs.max()) + 1, int(ys.max()) + 1
        crop_mask = full_mask[crop_y:crop_bottom, crop_x:crop_right]
        crop_image = original.crop((crop_x, crop_y, crop_right, crop_bottom))
        rgba = np.asarray(crop_image, dtype=np.uint8).copy()
        original_alpha = rgba[:, :, 3].copy()
        rgba[:, :, 3] = np.minimum(original_alpha, crop_mask.astype(np.uint8) * 255)
        rgba[~crop_mask, :3] = 0
        layer = Image.fromarray(rgba, mode="RGBA")
        if original.info.get("dpi"):
            layer.info["dpi"] = original.info["dpi"]

        return jsonify({
            "status": "success",
            "object_id": object_id,
            "name": export_name,
            "width": layer.width,
            "height": layer.height,
            "crop_x": crop_x,
            "crop_y": crop_y,
            "canvas_width": original.width,
            "canvas_height": original.height,
            "foreground_base64": encode_png_base64(layer),
            "message": "Đã xuất PNG cắt sát vùng chọn để giảm bộ nhớ và scratch-disk sử dụng.",
        })


@app.route("/segment_auto_close", methods=["POST", "OPTIONS"])
def segment_auto_close():
    if request.method == "OPTIONS":
        return ("", 204)
    data = request.get_json(silent=True) or {}
    with AUTO_STATE_LOCK:
        if data.get("image_id") == AUTO_STATE["image_id"]:
            AUTO_STATE.update({
                "image_id": None,
                "image": None,
                "work_image": None,
                "objects": {},
                "scale_x": 1.0,
                "scale_y": 1.0,
            })
    return jsonify({"status": "success"})


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
        active_session, actual_model_name = get_session(target_model)

        log_debug(
            f"Processing image {width}x{height} using {actual_model_name}; "
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
            "model": actual_model_name,
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

