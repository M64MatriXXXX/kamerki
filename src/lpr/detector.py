#!/usr/bin/env python3
"""
NVR Pro — License Plate Recognition detector.
Two-threaded pipeline:
  Thread 1 (reader)  — reads RTSP frames, runs fast OpenCV plate-region detector,
                       pushes candidate (frame, regions) into a queue.
  Thread 2 (main)    — pops from queue, runs EasyOCR on each region, emits JSON.
Usage: python3 detector.py <rtsp_url>
"""
import cv2
import numpy as np
import json
import sys
import time
import re
import os
import threading
import queue

os.environ.setdefault('EASYOCR_MODULE_PATH', os.path.expanduser('~/.EasyOCR'))
import warnings
warnings.filterwarnings('ignore')

def _emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)

_emit({'status': 'initializing', 'msg': 'Loading EasyOCR model (first run may take a minute)...'})

try:
    import easyocr
    reader = easyocr.Reader(['pl', 'en'], gpu=False, verbose=False, download_enabled=True)
    _emit({'status': 'ready', 'engine': 'easyocr'})
except Exception as e:
    _emit({'status': 'error', 'msg': f'Failed to load EasyOCR: {e}'})
    sys.exit(1)


# ── Plate validation ──────────────────────────────────────────
_PLATE_RE = re.compile(r'^[A-Z]{1,3}[A-Z0-9]{4,5}$')

def is_valid_plate(text: str) -> bool:
    t = re.sub(r'[^A-Z0-9]', '', text.upper())
    if not (5 <= len(t) <= 8):
        return False
    if not _PLATE_RE.match(t):
        return False
    # Must start with exactly 2-3 letters (district code)
    if not re.match(r'^[A-Z]{2}', t):
        return False
    # Must contain at least 2 digits (real plates always have multiple digits)
    if sum(c.isdigit() for c in t) < 2:
        return False
    # Reject if more than 5 consecutive letters (watermark text, not a plate)
    if re.search(r'[A-Z]{6,}', t):
        return False
    return True


# ── Fast plate region detector (OpenCV only, no OCR) ─────────
def find_plate_regions(frame):
    """Return list of (x1,y1,x2,y2) candidate bounding boxes. Very fast (~5 ms)."""
    h, w = frame.shape[:2]

    # Ignore bottom 12% and top 4% — watermark/timestamp zones
    y_min = int(h * 0.04)
    y_max = int(h * 0.88)

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blur = cv2.bilateralFilter(gray, 9, 15, 15)
    edges = cv2.Canny(blur, 30, 180)
    kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 3))
    kernel_v = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 5))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel_h)
    closed = cv2.morphologyEx(closed, cv2.MORPH_CLOSE, kernel_v)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates = []
    min_area = (w * h) * 0.0008
    max_area = (w * h) * 0.15

    for cnt in contours:
        x, y, cw, ch = cv2.boundingRect(cnt)
        area = cw * ch
        if area < min_area or area > max_area:
            continue
        ratio = cw / max(ch, 1)
        if not (2.2 <= ratio <= 7.0):
            continue
        if cw < 60 or ch < 12:
            continue
        pad_x = max(6, int(cw * 0.06))
        pad_y = max(4, int(ch * 0.12))
        x1 = max(0, x - pad_x)
        y1 = max(0, y - pad_y)
        x2 = min(w, x + cw + pad_x)
        y2 = min(h, y + ch + pad_y)
        # Skip watermark zones at top and bottom of frame
        if y1 < y_min or y2 > y_max:
            continue
        candidates.append((x1, y1, x2, y2))

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


# ── OCR on a single candidate region ─────────────────────────
def ocr_region(roi_bgr):
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


# ── Thread 1: RTSP reader + fast region detector ─────────────
def reader_thread(rtsp_url, ocr_queue, stop_event):
    """
    Continuously reads frames, runs fast OpenCV detector.
    Pushes (frame, regions) into ocr_queue only when plate candidates found.
    Queue is bounded (maxsize=2) so OCR thread always gets a fresh frame;
    old unprocessed frames are dropped automatically.
    """
    cap = None
    consecutive_fail = 0
    connect_attempts = 0
    MAX_CONNECT_ATTEMPTS = 10

    while not stop_event.is_set():
        if cap is None or not cap.isOpened():
            connect_attempts += 1
            if connect_attempts > MAX_CONNECT_ATTEMPTS:
                _emit({'status': 'error',
                       'msg': f'Stream unavailable after {MAX_CONNECT_ATTEMPTS} attempts'})
                stop_event.set()
                break

            backoff = min(30, 3 * connect_attempts)
            _emit({'status': 'connecting',
                   'msg': f'Attempt {connect_attempts}/{MAX_CONNECT_ATTEMPTS}'})
            cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000)
            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 8000)
            if not cap.isOpened():
                cap.release()
                cap = None
                _emit({'status': 'error',
                       'msg': f'Cannot open RTSP stream (attempt {connect_attempts})'})
                time.sleep(backoff)
                continue
            _emit({'status': 'connected'})
            consecutive_fail = 0
            connect_attempts = 0

        # Always grab to drain buffer, decode only the latest frame
        cap.grab()
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

        # Resize for speed
        h, w = frame.shape[:2]
        if w > 1280:
            scale = 1280 / w
            frame = cv2.resize(frame, (1280, int(h * scale)), interpolation=cv2.INTER_AREA)

        # Fast plate region check — only send to OCR if candidates found
        regions = find_plate_regions(frame)
        if regions:
            try:
                # Non-blocking put; drop if OCR is still busy (car will likely still be in next frame)
                ocr_queue.put_nowait((frame, regions, time.time()))
            except queue.Full:
                pass  # OCR busy, skip this frame — next one coming shortly

    if cap:
        cap.release()


# ── Main / Thread 2: EasyOCR processor ───────────────────────
def main():
    if len(sys.argv) < 2:
        _emit({'status': 'error', 'msg': 'Usage: detector.py <rtsp_url>'})
        sys.exit(1)

    rtsp_url = sys.argv[1]

    # Queue size 3: reader can queue up to 3 frames ahead of OCR
    ocr_queue = queue.Queue(maxsize=3)
    stop_event = threading.Event()

    t = threading.Thread(target=reader_thread, args=(rtsp_url, ocr_queue, stop_event), daemon=True)
    t.start()

    last_heartbeat = 0.0
    HEARTBEAT_SEC  = 5.0

    while not stop_event.is_set():
        try:
            frame, regions, ts = ocr_queue.get(timeout=HEARTBEAT_SEC)
        except queue.Empty:
            # No plate candidates seen for HEARTBEAT_SEC seconds — emit heartbeat
            _emit({'status': 'running', 'ts': time.time(), 'detections': []})
            last_heartbeat = time.time()
            continue

        detections = []
        seen = set()

        for (x1, y1, x2, y2) in regions:
            roi = frame[y1:y2, x1:x2]
            if roi.size == 0:
                continue
            try:
                for (text, conf) in ocr_region(roi):
                    raw = re.sub(r'[^A-Z0-9]', '', text.upper())
                    if not raw or raw in seen:
                        continue
                    if is_valid_plate(raw) and conf >= 0.60:
                        seen.add(raw)
                        detections.append({
                            'text':       raw,
                            'confidence': round(conf, 3),
                            'rect':       [int(x1), int(y1), int(x2-x1), int(y2-y1)]
                        })
            except Exception as exc:
                _emit({'status': 'error', 'msg': str(exc)})

        now = time.time()
        if detections:
            _emit({'status': 'running', 'ts': ts, 'detections': detections})
            last_heartbeat = now
        elif now - last_heartbeat >= HEARTBEAT_SEC:
            _emit({'status': 'running', 'ts': now, 'detections': []})
            last_heartbeat = now


if __name__ == '__main__':
    main()
