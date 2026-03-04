import mmap
import struct
from functools import lru_cache
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation

from nbody.FrameSample import FrameSample

ACCEL_BOOST, SPEED_BOOST, WIDTH = 30.0, 50.0, 0.003
FILE_PATH = Path(__file__).resolve().parent / "frames.fb"
SAMPLE_FRAMES_FOR_STATS = 120


def index_size_prefixed_frames(mm_data):
    offsets = []
    pos = 0
    total = len(mm_data)

    while pos + 4 <= total:
        (payload_size,) = struct.unpack_from("<I", mm_data, pos)
        frame_start = pos + 4
        frame_end = frame_start + payload_size
        if frame_end > total:
            raise ValueError(f"Corrupt frame at byte offset {pos}: size prefix exceeds file length")
        offsets.append((frame_start, payload_size))
        pos = frame_end

    if pos != total:
        raise ValueError("Corrupt frames.fb: trailing bytes after last frame")
    if not offsets:
        raise ValueError("frames.fb does not contain any frame records")
    return offsets


def decode_frame(mm_data, frame_offsets, index):
    start, size = frame_offsets[index]
    buf = memoryview(mm_data)[start:start + size]
    sample = FrameSample.GetRootAs(buf, 0)

    bodies = sample.BodiesAsNumpy()
    if isinstance(bodies, int):
        raise ValueError(f"Frame {index} has no bodies vector")
    if bodies.size % 6 != 0:
        raise ValueError(f"Frame {index} bodies vector length ({bodies.size}) is not divisible by 6")

    data = bodies.reshape((-1, 6))
    return {
        "frame_no": int(sample.Frame()),
        "x": data[:, 0],
        "y": data[:, 1],
        "vx": data[:, 3],
        "vy": data[:, 4],
    }


if not FILE_PATH.exists():
    raise FileNotFoundError(
        f"Missing FlatBuffer file: {FILE_PATH}\n"
        f"Please run the built .exe to generate the simulation data."
    )

file_handle = FILE_PATH.open("rb")
mm_data = mmap.mmap(file_handle.fileno(), 0, access=mmap.ACCESS_READ)
frame_offsets = index_size_prefixed_frames(mm_data)


@lru_cache(maxsize=8)
def load_frame(index):
    return decode_frame(mm_data, frame_offsets, index)


sample_indices = np.unique(
    np.linspace(0, len(frame_offsets) - 1, num=min(SAMPLE_FRAMES_FOR_STATS, len(frame_offsets)), dtype=int)
)

sample_speeds = []

for i in sample_indices:
    frame = load_frame(int(i))
    speed = np.hypot(frame["vx"], frame["vy"]) * SPEED_BOOST
    sample_speeds.append(speed)

all_sample_speeds = np.concatenate(sample_speeds)
norm = plt.Normalize(*np.percentile(all_sample_speeds, [5, 95]))

first = load_frame(0)
first_speed = np.hypot(first["vx"], first["vy"]) * SPEED_BOOST
first_ax = np.zeros_like(first["vx"])
first_ay = np.zeros_like(first["vy"])

# ---- plot setup ----
plt.style.use("dark_background")
fig, ax = plt.subplots(figsize=(10, 8))
fig.patch.set_facecolor("#050505")

qv = ax.quiver(
    first["x"],
    first["y"],
    first_ax * ACCEL_BOOST,
    first_ay * ACCEL_BOOST,
    first_speed,
    cmap="turbo",
    norm=norm,
    angles="xy",
    scale_units="xy",
    scale=1,
    width=WIDTH,
)

ax.set(aspect="equal", xlim=(-2000, 2000), ylim=(-2000, 2000))
plt.colorbar(qv, label="Speed", extend="both")
title = ax.set_title(f"Frame {first['frame_no']} (index 0/{len(frame_offsets) - 1})")


def update(frame_index):
    cur = load_frame(frame_index)
    speed = np.hypot(cur["vx"], cur["vy"]) * SPEED_BOOST

    if frame_index == 0:
        ax_vals = np.zeros_like(cur["vx"])
        ay_vals = np.zeros_like(cur["vy"])
    else:
        prev = load_frame(frame_index - 1)
        dt = max(1, cur["frame_no"] - prev["frame_no"])
        ax_vals = (cur["vx"] - prev["vx"]) / dt
        ay_vals = (cur["vy"] - prev["vy"]) / dt

    qv.set_offsets(np.column_stack((cur["x"], cur["y"])))
    qv.set_UVC(ax_vals * ACCEL_BOOST, ay_vals * ACCEL_BOOST, speed)
    title.set_text(f"Frame {cur['frame_no']} (index {frame_index}/{len(frame_offsets) - 1})")
    return qv, title


ani = FuncAnimation(fig, update, frames=range(len(frame_offsets)), interval=20, blit=False)
plt.show()
