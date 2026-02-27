import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
import sys

filename = "frames.csv"

try:
    df = pd.read_csv(filename)
except FileNotFoundError:
    print(f"Error: '{filename}' not found.")
    print("Please run the .exe first to generate the data file.")
    sys.exit()

frames = sorted(df["frame"].unique())

fig, ax = plt.subplots()
sc = ax.scatter([], [], s=2)
ax.set_aspect("equal", adjustable="box")

# Setting limits based on data range
xmin, xmax = df["x"].min(), df["x"].max()
ymin, ymax = df["y"].min(), df["y"].max()
ax.set_xlim(xmin, xmax)
ax.set_ylim(ymax, ymin) 

def update(f):
    d = df[df["frame"] == f]
    sc.set_offsets(d[["x","y"]].to_numpy())
    ax.set_title(f"Frame {f}")
    return sc,

ani = FuncAnimation(fig, update, frames=frames, interval=40, blit=True)
plt.show()