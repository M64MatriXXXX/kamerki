#!/usr/bin/env python3
"""
NVR Pro — License Plate Recognition using fast-alpr.
YOLOv9 plate detection + European ViT OCR model.
Sends annotated JPEG frames with bounding boxes back to Node.js via stdout.
Usage: python3 detector.py <rtsp_url>
"""
import cv2
import base64
import json
import sys
import time
import re
import os
import threading
import queue
import numpy as np

os.environ.setdefault('ALPR_MODELS_DIR', os.path.expanduser('~/.fast_alpr'))

def _emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)

_emit({'status': 'initializing', 'msg': 'Loading ALPR models (first run downloads ~50 MB)...'})

try:
    from fast_alpr import ALPR
    alpr = ALPR(
        detector_model="yolo-v9-t-384-license-plate-end2end",
        ocr_model="european-plates-mobile-vit-v2-model",
    )
    _emit({'status': 'ready', 'engine': 'fast-alpr'})
except Exception as e:
    _emit({'status': 'error', 'msg': f'Failed to load ALPR models: {e}'})
    sys.exit(1)


# ── Plate validation ──────────────────────────────────────────
_PLATE_RE = re.compile(r'^[A-Z]{2,3}[A-Z0-9]{4,5}$')

def is_valid_plate(t: str) -> bool:
    t = re.sub(r'[^A-Z0-9]', '', t.upper())
    if not (5 <= len(t) <= 8):
        return False
    if not _PLATE_RE.match(t):
        return False
    if not re.match(r'^[A-Z]{2}', t):
        return False
    if sum(c.isdigit() for c in t) < 2:
        return False
    return True


def annotate_frame(frame, results, h):
    """Draw ALPR bounding boxes and plate text onto frame (BGR)."""
    y_min = int(h * 0.04)
    y_max = int(h * 0.88)
    ann = frame.copy()

    for result in results:
        bb   = result.detection.bounding_box
        x1, y1, x2, y2 = int(bb.x1), int(bb.y1), int(bb.x2), int(bb.y2)

        # Skip watermark zones
        if y1 < y_min or y2 > y_max:
            continue

        ocr_text = result.ocr.text if result.ocr else ''
        ocr_conf = float(result.ocr.confidence) if result.ocr else 0.0
        plate    = re.sub(r'[^A-Z0-9]', '', ocr_text.upper())

        # Green box for valid plates, yellow for detected but not validated
        color = (0, 220, 0) if (plate and is_valid_plate(plate)) else (0, 200, 220)

        cv2.rectangle(ann, (x1, y1), (x2, y2), color, 2)

        if ocr_text:
            label  = f"{plate or ocr_text}  {ocr_conf:.0%}"
            fs     = 0.65
            thick  = 2
            (tw, th), bl = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, fs, thick)
            ly = max(y1 - 6, th + 6)
            cv2.rectangle(ann, (x1, ly - th - bl - 4), (x1 + tw + 8, ly + 2), (0, 0, 0), -1)
            cv2.rectangle(ann, (x1, ly - th - bl - 4), (x1 + tw + 8, ly + 2), color, 1)
            cv2.putText(ann, label, (x1 + 4, ly - bl),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, color, thick, cv2.LINE_AA)

    # Timestamp watermark
    ts_str = time.strftime('%Y-%m-%d %H:%M:%S')
    cv2.putText(ann, f'NVR AI  {ts_str}', (8, ann.shape[0] - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1, cv2.LINE_AA)
    return ann


def encode_frame(frame):
    _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 72])
    return base64.b64encode(buf.tobytes()).decode('ascii')


# ── Thread 1: RTSP reader ─────────────────────────────────────
def reader_thread(rtsp_url, frame_queue, stop_event):
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

        h, w = frame.shape[:2]
        if w > 1280:
            scale = 1280 / w
            frame = cv2.resize(frame, (1280, int(h * scale)), interpolation=cv2.INTER_AREA)

        try:
            frame_queue.put_nowait((frame, time.time()))
        except queue.Full:
            pass

    if cap:
        cap.release()


# ── Main / Thread 2: ALPR + frame annotator ──────────────────
def main():
    if len(sys.argv) < 2:
        _emit({'status': 'error', 'msg': 'Usage: detector.py <rtsp_url>'})
        sys.exit(1)

    rtsp_url    = sys.argv[1]
    frame_queue = queue.Queue(maxsize=2)
    stop_event  = threading.Event()

    t = threading.Thread(target=reader_thread,
                         args=(rtsp_url, frame_queue, stop_event), daemon=True)
    t.start()

    last_frame_emit = 0.0
    FRAME_INTERVAL  = 0.5   # max 2 FPS for live view (JPEG over WebSocket)
    HEARTBEAT_SEC   = 5.0

    while not stop_event.is_set():
        try:
            frame, ts = frame_queue.get(timeout=HEARTBEAT_SEC)
        except queue.Empty:
            _emit({'status': 'running', 'ts': time.time(), 'detections': []})
            last_frame_emit = time.time()
            continue

        h, w = frame.shape[:2]
        y_min = int(h * 0.04)
        y_max = int(h * 0.88)

        try:
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results   = alpr.predict(frame_rgb)
        except Exception as exc:
            _emit({'status': 'error', 'msg': str(exc)})
            continue

        # Collect valid detections
        detections = []
        seen = set()
        for result in results:
            bb = result.detection.bounding_box
            if bb.y1 < y_min or bb.y2 > y_max:
                continue
            if result.ocr is None or float(result.ocr.confidence) < 0.40:
                continue
            plate = re.sub(r'[^A-Z0-9]', '', result.ocr.text.upper())
            if not plate or plate in seen:
                continue
            if not is_valid_plate(plate):
                continue
            seen.add(plate)
            detections.append({
                'text':       plate,
                'confidence': round(float(result.ocr.confidence), 3),
                'rect':       [int(bb.x1), int(bb.y1),
                               int(bb.x2 - bb.x1), int(bb.y2 - bb.y1)]
            })

        now = time.time()
        # Emit annotated frame at controlled rate or immediately when plates found
        if detections or (now - last_frame_emit >= FRAME_INTERVAL):
            ann   = annotate_frame(frame, results, h)
            b64   = encode_frame(ann)
            _emit({
                'status':     'running',
                'ts':         ts,
                'detections': detections,
                'frame':      b64
            })
            last_frame_emit = now


if __name__ == '__main__':
    main()
