import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
import numpy as np
from pathlib import Path

ACCEL_BOOST, SPEED_BOOST, WIDTH = 30.0, 50.0, 0.003
file_path = Path(__file__).resolve().parent / "frames.csv"

df = pd.read_csv(file_path).sort_values(["id", "frame"])
grouped = df.groupby("id")

# calculate acceleration based on frame delta
dt = grouped["frame"].diff().fillna(1.0)
df["ax"] = grouped["vx"].diff() / dt
df["ay"] = grouped["vy"].diff() / dt
df["speed"] = np.hypot(df.vx, df.vy) * SPEED_BOOST

# ---- plot Setup ----
plt.style.use('dark_background')
fig, ax = plt.subplots(figsize=(10, 8))
fig.patch.set_facecolor('#050505')

frames = sorted(df["frame"].unique())
initial_data = df[df.frame == frames[0]].sort_values("id")

# normalize colors based on speed percentiles
norm = plt.Normalize(*np.percentile(df.speed.dropna(), [5, 95]))

qv = ax.quiver(
    initial_data.x, initial_data.y, 
    initial_data.ax * ACCEL_BOOST, initial_data.ay * ACCEL_BOOST, 
    initial_data.speed, 
    cmap="turbo", norm=norm, angles="xy", scale_units="xy", scale=1, width=WIDTH
)

ax.set(aspect="equal", xlim=(df.x.min(), df.x.max()), ylim=(df.y.max(), df.y.min()))
plt.colorbar(qv, label="Speed", extend='both')
title = ax.set_title(f"Frame {frames[0]}")

def update(frame_val):
    data = df[df.frame == frame_val].sort_values("id")
    
    qv.set_offsets(data[["x", "y"]])
    qv.set_UVC(data.ax * ACCEL_BOOST, data.ay * ACCEL_BOOST, data.speed)
    
    title.set_text(f"Frame {frame_val}")
    return qv, title

ani = FuncAnimation(fig, update, frames=frames, interval=30, blit=True)
plt.show()