#!/usr/bin/env python3
"""
NVR Pro — License Plate Recognition using fast-alpr.
Uses YOLOv9 for plate detection + european ViT model for OCR.
Much more accurate than general-purpose EasyOCR.
Usage: python3 detector.py <rtsp_url>
"""
import cv2
import json
import sys
import time
import re
import os
import threading
import queue

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


# ── Plate validation (post-filter) ───────────────────────────
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


def clean_plate(text: str) -> str:
    """Strip non-alphanumeric and uppercase."""
    return re.sub(r'[^A-Z0-9]', '', text.upper())


# ── Thread 1: RTSP frame reader ───────────────────────────────
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

        # Always drain buffer — grab without decode, then decode latest
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

        # Resize to 1280px wide max — YOLO works well at this resolution
        h, w = frame.shape[:2]
        if w > 1280:
            scale = 1280 / w
            frame = cv2.resize(frame, (1280, int(h * scale)), interpolation=cv2.INTER_AREA)

        # Push frame to OCR queue; drop if ALPR thread is busy
        try:
            frame_queue.put_nowait((frame, time.time()))
        except queue.Full:
            pass

    if cap:
        cap.release()


# ── Main / Thread 2: ALPR processor ──────────────────────────
def main():
    if len(sys.argv) < 2:
        _emit({'status': 'error', 'msg': 'Usage: detector.py <rtsp_url>'})
        sys.exit(1)

    rtsp_url   = sys.argv[1]
    frame_queue = queue.Queue(maxsize=2)
    stop_event  = threading.Event()

    t = threading.Thread(target=reader_thread,
                         args=(rtsp_url, frame_queue, stop_event), daemon=True)
    t.start()

    last_heartbeat = 0.0
    HEARTBEAT_SEC  = 5.0

    while not stop_event.is_set():
        try:
            frame, ts = frame_queue.get(timeout=HEARTBEAT_SEC)
        except queue.Empty:
            _emit({'status': 'running', 'ts': time.time(), 'detections': []})
            last_heartbeat = time.time()
            continue

        h, w = frame.shape[:2]
        # Exclude watermark zones at top (4%) and bottom (12%)
        y_min = int(h * 0.04)
        y_max = int(h * 0.88)

        try:
            # fast-alpr expects RGB
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results   = alpr.predict(frame_rgb)
        except Exception as exc:
            _emit({'status': 'error', 'msg': str(exc)})
            continue

        detections = []
        seen = set()

        for result in results:
            if result.ocr is None:
                continue

            bb   = result.detection.bounding_box
            conf = float(result.ocr.confidence)

            # Skip watermark zones
            if bb.y1 < y_min or bb.y2 > y_max:
                continue

            if conf < 0.45:
                continue

            text = clean_plate(result.ocr.text)
            if not text or text in seen:
                continue

            # Validate as Polish plate; skip obvious garbage
            if not is_valid_plate(text):
                continue

            seen.add(text)
            detections.append({
                'text':       text,
                'confidence': round(conf, 3),
                'rect':       [int(bb.x1), int(bb.y1),
                               int(bb.x2 - bb.x1), int(bb.y2 - bb.y1)]
            })

        now = time.time()
        if detections:
            _emit({'status': 'running', 'ts': ts, 'detections': detections})
            last_heartbeat = now
        elif now - last_heartbeat >= HEARTBEAT_SEC:
            _emit({'status': 'running', 'ts': now, 'detections': []})
            last_heartbeat = now


if __name__ == '__main__':
    main()
