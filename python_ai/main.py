import cv2
import time
import math
import random
import numpy as np
from ultralytics import YOLO

# ──────────────────────────────────────────────────────────
#  SOFTWARE-ONLY SIMULATION MODE
#  No camera or ESP32 hardware required.
#  Generates synthetic sky frames with an animated drone
#  flying a figure-8 path, simulates environmental sensor
#  data, and runs the full YOLO + compensation pipeline.
# ──────────────────────────────────────────────────────────

FRAME_W, FRAME_H = 1280, 720


def generate_sky_background(frame_idx: int) -> np.ndarray:
    """Create a gradient sky with slowly drifting cloud patches."""
    frame = np.zeros((FRAME_H, FRAME_W, 3), dtype=np.uint8)
    for y in range(FRAME_H):
        t = y / FRAME_H
        r = int(50  + t * 80)
        g = int(100 + t * 80)
        b = int(180 + t * 60)
        frame[y, :] = (b, g, r)          # OpenCV BGR

    rng = random.Random(42)
    for i in range(6):
        cx = int((rng.randint(50, FRAME_W - 50) + frame_idx * (i * 0.3 + 0.2)) % FRAME_W)
        cy = rng.randint(40, FRAME_H // 2)
        axes = (rng.randint(60, 180), rng.randint(20, 50))
        cv2.ellipse(frame, (cx, cy), axes, 0, 0, 360, (220, 220, 210), -1)
        cv2.ellipse(frame, (cx + 40, cy - 10),
                    (max(1, axes[0] - 20), max(1, axes[1] - 5)),
                    0, 0, 360, (235, 235, 225), -1)
    return frame


def draw_drone_sprite(frame: np.ndarray, cx: int, cy: int, size: int = 38):
    """Draw a quadcopter silhouette; return its bounding box."""
    arm = size
    body_color = (30, 30, 30)

    for ox, oy in [(-arm, -arm), (arm, -arm), (-arm, arm), (arm, arm)]:
        cv2.line(frame, (cx, cy), (cx + ox, cy + oy), body_color, 3)
        cv2.circle(frame, (cx + ox, cy + oy), arm // 3, body_color, -1)
        cv2.ellipse(frame, (cx + ox, cy + oy),
                    (arm // 2, arm // 6), 0, 0, 360, (80, 80, 80), 1)

    cv2.rectangle(frame, (cx - 12, cy - 8), (cx + 12, cy + 8), (20, 20, 20), -1)
    cv2.circle(frame, (cx, cy + 4), 5, (0, 100, 200), -1)
    cv2.circle(frame, (cx - arm, cy - arm), 4, (0, 255,   0), -1)   # green LED
    cv2.circle(frame, (cx + arm, cy - arm), 4, (0,   0, 255), -1)   # red LED

    x1 = max(0, cx - arm - arm // 3)
    y1 = max(0, cy - arm - arm // 3)
    x2 = min(FRAME_W, cx + arm + arm // 3)
    y2 = min(FRAME_H, cy + arm + arm // 3)
    return x1, y1, x2, y2


def simulate_telemetry(frame_idx: int) -> dict:
    """Slowly wandering simulated sensor values."""
    t = frame_idx / 30.0
    return dict(
        temp     = round(-5  + 3  * math.sin(t * 0.07), 1),
        humidity = round(75  + 10 * math.sin(t * 0.05), 1),
        pressure = round(900 + 80 * math.sin(t * 0.03), 1),   # dips < 800 → high-alt mode
        wind     = round(20  + 15 * abs(math.sin(t * 0.11)), 1),
        imu_roll = round(2.0 * math.sin(t * 0.40), 2),
        imu_pitch= round(1.5 * math.cos(t * 0.35), 2),
    )


def main():
    print("=" * 58)
    print("  Anti-Drone AI  |  SOFTWARE SIMULATION MODE")
    print("  No camera / ESP32 hardware required.")
    print("=" * 58)

    # 1. Load YOLOv8 Nano
    try:
        model = YOLO('yolov8n.pt')
        print("[OK] YOLOv8 Nano loaded.")
    except Exception as e:
        print(f"[ERROR] {e}")
        return

    print("[OK] Serial  — skipped (simulation mode).")
    print("[OK] Camera  — replaced by synthetic frame generator.")
    print("     Press Q in the window to quit.\n")

    cam_cx, cam_cy = FRAME_W // 2, FRAME_H // 2
    pan = tilt = 0.0
    frame_idx  = 0
    base_conf_threshold = 0.60

    while True:
        t = frame_idx / 30.0

        # ── Drone position: smooth figure-8 (lemniscate) path ─────────
        drone_x = int(cam_cx + 350 * math.sin(t * 0.4))
        drone_y = int(cam_cy + 180 * math.sin(t * 0.8) * 0.5)
        drone_x = max(90, min(FRAME_W - 90, drone_x))
        drone_y = max(90, min(FRAME_H - 90, drone_y))

        # ── Synthetic frame ────────────────────────────────────────────
        frame = generate_sky_background(frame_idx)
        bbox  = draw_drone_sprite(frame, drone_x, drone_y)

        # ── Simulated telemetry ────────────────────────────────────────
        env = simulate_telemetry(frame_idx)
        current_temp     = env['temp']
        current_humidity = env['humidity']
        current_pressure = env['pressure']
        current_wind     = env['wind']
        imu_roll         = env['imu_roll']
        imu_pitch        = env['imu_pitch']

        active_threshold = 0.75 if current_pressure < 800 else base_conf_threshold

        # ── YOLO Detection ─────────────────────────────────────────────
        results = model(frame, stream=True, verbose=False)
        drone_detected = False
        target_x, target_y = drone_x, drone_y
        best_conf = 0.0

        for r in results:
            for box in r.boxes:
                conf = box.conf[0].item()
                if conf > active_threshold:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
                    target_x = (x1 + x2) // 2
                    target_y = (y1 + y2) // 2
                    best_conf = conf
                    drone_detected = True
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(frame, f"DRONE  conf:{conf:.2f}",
                                (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX,
                                0.55, (0, 255, 0), 2)

        # Fallback: always show simulated bbox even if YOLO misses
        if not drone_detected:
            x1, y1, x2, y2 = bbox
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 200, 255), 2)
            cv2.putText(frame, "SIM-DRONE",
                        (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX,
                        0.55, (0, 200, 255), 2)

        # ── Compensation Algorithm ─────────────────────────────────────
        pan_error  = (target_x - cam_cx) + imu_roll  * 5.0
        tilt_error = (target_y - cam_cy) + imu_pitch * 5.0
        pan_angle  = int(pan_error  * 0.05)
        tilt_angle = int(tilt_error * 0.05)

        # Smooth simulated servo response
        pan  += (pan_angle  - pan)  * 0.15
        tilt += (tilt_angle - tilt) * 0.15

        # ── Tracking reticle ───────────────────────────────────────────
        cv2.circle(frame, (cam_cx, cam_cy), 6, (0, 0, 255), -1)
        rx = int(cam_cx + pan  / 0.05)
        ry = int(cam_cy + tilt / 0.05)
        cv2.drawMarker(frame, (rx, ry), (0, 255, 255), cv2.MARKER_CROSS, 30, 2)

        # ── HUD Overlay ────────────────────────────────────────────────
        lock_status = "LOCKED" if abs(pan_error) < 20 and abs(tilt_error) < 20 else "TRACKING"
        mode_label  = "HIGH-ALTITUDE MODE" if current_pressure < 800 else "NORMAL MODE"
        hud = [
            f"Temp:{current_temp}C  Humidity:{current_humidity}%  Pressure:{current_pressure}hPa",
            f"Wind:{current_wind}km/h  Roll:{imu_roll}deg  Pitch:{imu_pitch}deg",
            f"PAN:{pan:.1f}deg  TILT:{tilt:.1f}deg  Status:{lock_status}",
            f"Mode:{mode_label}  Threshold:{active_threshold:.2f}  Conf:{best_conf:.2f}",
        ]
        for i, line in enumerate(hud):
            cv2.putText(frame, line, (10, 30 + i * 28),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 2)

        cv2.putText(frame, "[ SOFTWARE SIMULATION ]",
                    (FRAME_W - 340, FRAME_H - 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2)

        cv2.imshow("Anti-Drone AI  |  Software Simulation", frame)

        if cv2.waitKey(33) & 0xFF == ord('q'):   # ~30 fps
            break

        frame_idx += 1

    cv2.destroyAllWindows()
    print("Simulation stopped.")


if __name__ == "__main__":
    main()
