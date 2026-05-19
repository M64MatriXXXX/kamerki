#!/usr/bin/env python3
"""
NVR Pro — License Plate Recognition detector.
Reads RTSP stream, detects plates, outputs JSON lines to stdout.
Usage: python3 detector.py <rtsp_url> [interval_sec]
"""
import cv2
import numpy as np
import json
import sys
import time
import re
import os

# ── Suppress noisy logs ───────────────────────────────────────
os.environ.setdefault('EASYOCR_MODULE_PATH', os.path.expanduser('~/.EasyOCR'))
import warnings
warnings.filterwarnings('ignore')

def _emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)

_emit({'status': 'initializing', 'msg': 'Loading EasyOCR model (first run may take a minute)...'})

try:
    import easyocr
    reader = easyocr.Reader(['pl', 'en'], gpu=False, verbose=False, download_enabled=True)
    OCR_ENGINE = 'easyocr'
    _emit({'status': 'ready', 'engine': 'easyocr'})
except Exception as e:
    _emit({'status': 'error', 'msg': f'Failed to load EasyOCR: {e}'})
    sys.exit(1)


# ── Plate validation ──────────────────────────────────────────
# Polish plate patterns (after stripping spaces/dashes):
# Standard passenger: 2-3 letters + 4-5 alphanumeric  e.g. WA12345, KR1X234
# Total cleaned length: 5-8 chars
_PLATE_RE = re.compile(r'^[A-Z]{1,3}[A-Z0-9]{4,5}$')

def clean_text(text: str) -> str:
    # Common OCR substitutions for plates
    t = text.upper()
    t = t.replace('O', '0').replace('I', '1').replace('S', '5')  # context-sensitive
    return re.sub(r'[^A-Z0-9]', '', t)

def is_valid_plate(text: str) -> bool:
    t = re.sub(r'[^A-Z0-9]', '', text.upper())
    if not (5 <= len(t) <= 8):
        return False
    if not _PLATE_RE.match(t):
        return False
    # Must start with at least 2 letters (district code)
    if not re.match(r'^[A-Z]{2}', t):
        return False
    # Must contain at least one digit
    if not any(c.isdigit() for c in t):
        return False
    return True


# ── Plate region detection ────────────────────────────────────
def find_plate_regions(frame):
    """Return list of (x1,y1,x2,y2) candidate plate bounding boxes."""
    h, w = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # Denoise + edge detect
    blur = cv2.bilateralFilter(gray, 9, 15, 15)
    edges = cv2.Canny(blur, 30, 180)

    # Close gaps so plate rectangle forms solid contour
    kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 3))
    kernel_v = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 5))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel_h)
    closed = cv2.morphologyEx(closed, cv2.MORPH_CLOSE, kernel_v)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates = []
    min_area = (w * h) * 0.0008   # at least 0.08% of frame area
    max_area = (w * h) * 0.15     # at most 15% of frame area

    for cnt in contours:
        x, y, cw, ch = cv2.boundingRect(cnt)
        area = cw * ch
        if area < min_area or area > max_area:
            continue
        ratio = cw / max(ch, 1)
        # Typical plate: 2.5:1 to 6:1 aspect ratio
        if not (2.2 <= ratio <= 7.0):
            continue
        # Absolute minimums
        if cw < 60 or ch < 12:
            continue
        # Expand by ~8% each side
        pad_x = max(6, int(cw * 0.06))
        pad_y = max(4, int(ch * 0.12))
        x1 = max(0, x - pad_x)
        y1 = max(0, y - pad_y)
        x2 = min(w, x + cw + pad_x)
        y2 = min(h, y + ch + pad_y)
        candidates.append((x1, y1, x2, y2))

    # Deduplicate heavily overlapping candidates
    return _nms_boxes(candidates)


def _iou(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0
    ua = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / max(ua, 1)


def _nms_boxes(boxes, iou_thresh=0.4):
    if not boxes:
        return []
    boxes = sorted(boxes, key=lambda b: (b[2]-b[0])*(b[3]-b[1]), reverse=True)
    kept = []
    used = set()
    for i, b in enumerate(boxes):
        if i in used:
            continue
        kept.append(b)
        for j, c in enumerate(boxes[i+1:], i+1):
            if _iou(b, c) > iou_thresh:
                used.add(j)
    return kept


# ── OCR on region ─────────────────────────────────────────────
def ocr_region(roi_bgr):
    """Return list of (text, confidence) from EasyOCR."""
    # Pre-process: upscale + sharpen + threshold
    h, w = roi_bgr.shape[:2]
    scale = max(1, min(4, int(120 / max(h, 1))))
    up = cv2.resize(roi_bgr, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    img3 = cv2.cvtColor(thresh, cv2.COLOR_GRAY2BGR)

    results = reader.readtext(
        img3,
        detail=1,
        paragraph=False,
        allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -',
        batch_size=4
    )
    return [(text, float(conf)) for (_, text, conf) in results]


# ── Main frame processing ─────────────────────────────────────
def process_frame(frame):
    """Detect plates in frame, return list of detections (no frame encoding)."""
    regions = find_plate_regions(frame)
    detections = []
    seen = set()

    for (x1, y1, x2, y2) in regions:
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            continue
        for (text, conf) in ocr_region(roi):
            raw = re.sub(r'[^A-Z0-9]', '', text.upper())
            if not raw or raw in seen:
                continue
            if is_valid_plate(raw) and conf >= 0.45:
                seen.add(raw)
                detections.append({
                    'text': raw,
                    'confidence': round(conf, 3),
                    'rect': [int(x1), int(y1), int(x2 - x1), int(y2 - y1)]
                })

    return detections


# ── Main loop ─────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        _emit({'status': 'error', 'msg': 'Usage: detector.py <rtsp_url> [interval_sec]'})
        sys.exit(1)

    rtsp_url = sys.argv[1]

    cap = None
    consecutive_fail = 0
    connect_attempts = 0
    MAX_CONNECT_ATTEMPTS = 10
    last_heartbeat = 0.0
    HEARTBEAT_SEC = 5.0

    while True:
        # (Re)open stream
        if cap is None or not cap.isOpened():
            connect_attempts += 1
            if connect_attempts > MAX_CONNECT_ATTEMPTS:
                _emit({'status': 'error', 'msg': f'Stream unavailable after {MAX_CONNECT_ATTEMPTS} attempts, giving up'})
                sys.exit(1)

            backoff = min(30, 3 * connect_attempts)
            _emit({'status': 'connecting', 'msg': f'Attempt {connect_attempts}/{MAX_CONNECT_ATTEMPTS}'})
            cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000)
            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 8000)
            if not cap.isOpened():
                cap.release()
                cap = None
                _emit({'status': 'error', 'msg': f'Cannot open RTSP stream (attempt {connect_attempts})'})
                time.sleep(backoff)
                continue
            _emit({'status': 'connected'})
            consecutive_fail = 0
            connect_attempts = 0

        # Drain buffer: grab several frames so we always process a fresh one
        for _ in range(3):
            cap.grab()
        ret, frame = cap.retrieve()
        if not ret:
            ret, frame = cap.read()

        if not ret or frame is None:
            consecutive_fail += 1
            if consecutive_fail >= 5:
                cap.release()
                cap = None
                _emit({'status': 'reconnecting'})
                time.sleep(5)
            continue

        consecutive_fail = 0
        now = time.time()

        # Resize for consistent processing speed
        h, w = frame.shape[:2]
        if w > 1280:
            scale = 1280 / w
            frame = cv2.resize(frame, (1280, int(h * scale)), interpolation=cv2.INTER_AREA)

        try:
            detections = process_frame(frame)
            if detections:
                _emit({'status': 'running', 'ts': now, 'detections': detections})
            elif now - last_heartbeat >= HEARTBEAT_SEC:
                # Periodic heartbeat so Node.js knows detector is alive
                _emit({'status': 'running', 'ts': now, 'detections': []})
                last_heartbeat = now
            else:
                last_heartbeat = last_heartbeat  # keep as is
        except Exception as exc:
            _emit({'status': 'error', 'msg': str(exc)})

    if cap:
        cap.release()


if __name__ == '__main__':
    main()
