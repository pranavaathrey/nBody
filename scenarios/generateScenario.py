import argparse
from pathlib import Path

import agama
import numpy as np


GALAXY_SCALE = 5.0
DEFAULT_SMBH_MASS = 100000.0
BACKEND_SOFTENING_SQ = 0.1
DEFAULT_SMBH_EXCLUSION_RADIUS = 20.0 * GALAXY_SCALE


def write_agama_binary_snapshot(output_path, positions, velocities, masses, forces):
    # Binary layout must match backend/scenarios.cpp loader.
    # [u32 magic='AGM1'][u32 count][count * (x y z vx vy vz fx fy fz mass as f32)]
    positions = np.asarray(positions, dtype=np.float32)
    velocities = np.asarray(velocities, dtype=np.float32)
    masses = np.asarray(masses, dtype=np.float32).reshape(-1, 1)
    forces = np.asarray(forces, dtype=np.float32)

    count = positions.shape[0]
    if velocities.shape[0] != count or masses.shape[0] != count or forces.shape[0] != count:
        raise ValueError("positions/velocities/masses/forces length mismatch")

    rows = np.hstack([positions, velocities, forces, masses]).astype(np.float32, copy=False)

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    magic = np.array([0x314D4741], dtype=np.uint32)  # 'AGM1' in little-endian
    n = np.array([count], dtype=np.uint32)
    with out.open("wb") as fp:
        fp.write(magic.tobytes())
        fp.write(n.tobytes())
        fp.write(rows.tobytes())

    print(f"Wrote AGAMA binary snapshot: {out} ({count} bodies)")


def component_counts(num_particles, fractions):
    # Largest-remainder assignment keeps total exact and preserves fractions closely.
    targets = np.array(fractions, dtype=np.float64) * float(num_particles)
    base = np.floor(targets).astype(np.int64)
    remainder = int(num_particles - int(base.sum()))
    if remainder > 0:
        order = np.argsort(-(targets - base))
        base[order[:remainder]] += 1
    return base


def sample_exponential_disk(n, r_scale, z_scale, rng):
    # Surface density Sigma(R) ~ exp(-R/Rd) => R follows Gamma(k=2, theta=Rd).
    r = rng.gamma(shape=2.0, scale=r_scale, size=n)
    phi = rng.uniform(0.0, 2.0 * np.pi, size=n)
    z = rng.exponential(scale=z_scale, size=n)
    z *= rng.choice(np.array([-1.0, 1.0]), size=n)

    x = r * np.cos(phi)
    y = r * np.sin(phi)
    return x, y, z, r, phi


def sample_hernquist_like(n, scale_radius, r_max, rng):
    # Inverse-transform sample for spherical profile p(r) ~ r^2 / (r+a)^3.
    u = rng.uniform(0.0, 1.0, size=n)
    sqrt_u = np.sqrt(u)
    r = scale_radius * sqrt_u / np.maximum(1.0 - sqrt_u, 1e-6)
    r = np.clip(r, 0.0, r_max)

    cos_t = rng.uniform(-1.0, 1.0, size=n)
    sin_t = np.sqrt(np.maximum(0.0, 1.0 - cos_t * cos_t))
    phi = rng.uniform(0.0, 2.0 * np.pi, size=n)

    x = r * sin_t * np.cos(phi)
    y = r * sin_t * np.sin(phi)
    z = r * cos_t
    return x, y, z, r


def circular_velocity_from_potential(potential, r):
    xyz = np.column_stack((r, np.zeros_like(r), np.zeros_like(r)))
    acc = potential.force(xyz)[:, 0]
    return np.sqrt(np.maximum(0.0, -r * acc))


def circular_velocity_from_point_mass(mass, r):
    r_safe = np.maximum(r, 1e-6)
    return np.sqrt(np.maximum(0.0, mass / r_safe))


def circular_velocity_from_softened_point_mass(mass, r, softening_sq):
    r2 = np.maximum(r * r, 1e-12)
    denom = np.power(r2 + softening_sq, 1.5)
    return np.sqrt(np.maximum(0.0, mass * r2 / denom))


def circular_velocity_total(potential, r, smbh_mass):
    v_c = circular_velocity_from_potential(potential, r)
    if smbh_mass > 0.0:
        v_c_smbh = circular_velocity_from_softened_point_mass(
            smbh_mass,
            r,
            BACKEND_SOFTENING_SQ,
        )
        v_c = np.sqrt(v_c * v_c + v_c_smbh * v_c_smbh)
    return v_c


def sample_bound_orbital_velocities(
    x,
    y,
    z,
    potential,
    smbh_mass,
    rng,
    tangential_support,
    tangential_scatter,
    radial_scatter,
):
    pos = np.column_stack((x, y, z)).astype(np.float64, copy=False)
    r = np.linalg.norm(pos, axis=1)
    r_safe = np.maximum(r, 1e-6)

    radial_hat = pos / r_safe[:, None]
    random_vec = rng.normal(0.0, 1.0, size=pos.shape)
    tangent = random_vec - radial_hat * np.sum(random_vec * radial_hat, axis=1, keepdims=True)
    tangent_norm = np.linalg.norm(tangent, axis=1)

    fallback = np.cross(radial_hat, np.array([0.0, 0.0, 1.0], dtype=np.float64))
    fallback_norm = np.linalg.norm(fallback, axis=1)
    second_fallback = np.cross(radial_hat, np.array([0.0, 1.0, 0.0], dtype=np.float64))
    second_fallback_norm = np.linalg.norm(second_fallback, axis=1)

    bad = tangent_norm < 1e-10
    tangent[bad] = fallback[bad]
    tangent_norm[bad] = fallback_norm[bad]

    still_bad = tangent_norm < 1e-10
    tangent[still_bad] = second_fallback[still_bad]
    tangent_norm[still_bad] = second_fallback_norm[still_bad]

    tangent = tangent / np.maximum(tangent_norm[:, None], 1e-12)

    v_c = circular_velocity_total(potential, r_safe, smbh_mass)
    v_t = tangential_support * v_c + rng.normal(0.0, tangential_scatter * v_c, size=r.size)
    v_r = rng.normal(0.0, radial_scatter * v_c, size=r.size)

    vel = tangent * v_t[:, None] + radial_hat * v_r[:, None]

    speed = np.linalg.norm(vel, axis=1)
    # Keep particles bound with a conservative cap under local escape estimate.
    v_cap = 0.92 * np.sqrt(2.0) * np.maximum(v_c, 1e-6)
    scale = np.minimum(1.0, v_cap / np.maximum(speed, 1e-12))
    vel *= scale[:, None]

    return vel[:, 0], vel[:, 1], vel[:, 2]


def generate_milky_way_snapshot(
    num_particles=10000,
    seed=42,
    smbh_mass=DEFAULT_SMBH_MASS,
    smbh_exclusion_radius=DEFAULT_SMBH_EXCLUSION_RADIUS,
):
    rng = np.random.default_rng(seed)

    if num_particles < 1:
        raise ValueError("num_particles must be >= 1")

    # Dimensionless toy units (matches backend G=1 setup).
    agama.setUnits(length=1, velocity=1, mass=1)

    # Toy multi-component model tuned for visual stability at 10k particles.
    disk_mass = 8.0
    bulge_mass = 1.0
    halo_mass = 1.5

    disk_rd = 90.0 * GALAXY_SCALE
    disk_zh = 8.0 * GALAXY_SCALE
    bulge_a = 20.0 * GALAXY_SCALE
    halo_rs = 180.0 * GALAXY_SCALE
    bulge_cutoff = 120.0 * GALAXY_SCALE
    halo_rmax = 600.0 * GALAXY_SCALE

    # Build a composite potential for force evaluation and circular speed curve.
    potential = agama.Potential(
        agama.Potential(type="MiyamotoNagai", mass=disk_mass, scaleRadius=disk_rd, scaleHeight=disk_zh),
        agama.Potential(type="Spheroid", mass=bulge_mass, scaleRadius=bulge_a, outerCutoffRadius=bulge_cutoff),
        agama.Potential(type="NFW", mass=halo_mass, scaleRadius=halo_rs),
    )

    # Reserve index 0 for an optional central SMBH so stars orbit around a dominant center.
    has_smbh = smbh_mass > 0.0
    sampled_particles = num_particles - 1 if has_smbh else num_particles
    if sampled_particles < 1:
        raise ValueError("num_particles must be >= 2 when smbh_mass > 0")

    # Allocate particles across components.
    n_disk, n_bulge, n_halo = component_counts(sampled_particles, fractions=(0.88, 0.09, 0.03))

    # Sample spatial distribution.
    xd, yd, zd, rd, phid = sample_exponential_disk(n_disk, r_scale=disk_rd, z_scale=disk_zh, rng=rng)
    xb, yb, zb, rb = sample_hernquist_like(n_bulge, scale_radius=bulge_a, r_max=bulge_cutoff, rng=rng)
    xh, yh, zh, rh = sample_hernquist_like(n_halo, scale_radius=halo_rs, r_max=halo_rmax, rng=rng)

    if has_smbh and smbh_exclusion_radius > 0.0:
        # Avoid immediate plunges near the SMBH that cause large slingshots/ejections.
        rd = np.maximum(rd, smbh_exclusion_radius)
        xd = rd * np.cos(phid)
        yd = rd * np.sin(phid)

        rb = np.maximum(rb, smbh_exclusion_radius)
        bulge_dir_norm = np.sqrt(np.maximum(xb * xb + yb * yb + zb * zb, 1e-12))
        xb = xb / bulge_dir_norm * rb
        yb = yb / bulge_dir_norm * rb
        zb = zb / bulge_dir_norm * rb

        rh = np.maximum(rh, smbh_exclusion_radius)
        halo_dir_norm = np.sqrt(np.maximum(xh * xh + yh * yh + zh * zh, 1e-12))
        xh = xh / halo_dir_norm * rh
        yh = yh / halo_dir_norm * rh
        zh = zh / halo_dir_norm * rh

    # Disk kinematics: near-circular rotation with anisotropic dispersions.
    rd_safe = np.maximum(rd, 5.0 * GALAXY_SCALE)
    v_c = circular_velocity_total(potential, rd_safe, smbh_mass if has_smbh else 0.0)
    sigma_r = 0.20 * np.exp(-rd_safe / (180.0 * GALAXY_SCALE)) + 0.06
    sigma_z = 0.12 * np.exp(-rd_safe / (180.0 * GALAXY_SCALE)) + 0.04
    sigma_phi = sigma_r / np.sqrt(2.0)

    v_phi = v_c + rng.normal(0.0, sigma_phi, size=n_disk)
    v_r = rng.normal(0.0, sigma_r, size=n_disk)
    v_z = rng.normal(0.0, sigma_z, size=n_disk)

    cos_p = np.cos(phid)
    sin_p = np.sin(phid)
    vxd = v_r * cos_p - v_phi * sin_p
    vyd = v_r * sin_p + v_phi * cos_p
    vzd = v_z

    # Bulge/halo: orbitalized initialization instead of free-fall prone isotropic random kicks.
    vxb, vyb, vzb = sample_bound_orbital_velocities(
        xb,
        yb,
        zb,
        potential=potential,
        smbh_mass=smbh_mass if has_smbh else 0.0,
        rng=rng,
        tangential_support=0.92,
        tangential_scatter=0.08,
        radial_scatter=0.06,
    )

    vxh, vyh, vzh = sample_bound_orbital_velocities(
        xh,
        yh,
        zh,
        potential=potential,
        smbh_mass=smbh_mass if has_smbh else 0.0,
        rng=rng,
        tangential_support=0.82,
        tangential_scatter=0.14,
        radial_scatter=0.10,
    )

    position_parts = []
    velocity_parts = []
    mass_parts = []

    if has_smbh:
        position_parts.append(np.array([[0.0, 0.0, 0.0]], dtype=np.float32))
        velocity_parts.append(np.array([[0.0, 0.0, 0.0]], dtype=np.float32))
        mass_parts.append(np.array([smbh_mass], dtype=np.float32))

    position_parts.extend(
        [
            np.column_stack((xd, yd, zd)),
            np.column_stack((xb, yb, zb)),
            np.column_stack((xh, yh, zh)),
        ]
    )
    velocity_parts.extend(
        [
            np.column_stack((vxd, vyd, vzd)),
            np.column_stack((vxb, vyb, vzb)),
            np.column_stack((vxh, vyh, vzh)),
        ]
    )
    mass_parts.extend(
        [
            np.full(n_disk, disk_mass / max(n_disk, 1), dtype=np.float32),
            np.full(n_bulge, bulge_mass / max(n_bulge, 1), dtype=np.float32),
            np.full(n_halo, halo_mass / max(n_halo, 1), dtype=np.float32),
        ]
    )

    positions = np.vstack(position_parts).astype(np.float32, copy=False)
    velocities = np.vstack(velocity_parts).astype(np.float32, copy=False)
    masses = np.concatenate(mass_parts)

    forces = potential.force(positions).astype(np.float32, copy=False)

    print("--- Milky Way Snapshot Generation Complete ---")
    print(f"Particles total:  {num_particles}")
    print(f"Disk/Bulge/Halo:  {n_disk}/{n_bulge}/{n_halo}")
    print(f"SMBH mass:        {smbh_mass:.3f}")
    print(f"SMBH exclusion R: {smbh_exclusion_radius:.3f}")
    print(f"Galaxy scale:     {GALAXY_SCALE}x")
    print("Length unit:      toy (dimensionless)")
    print(f"Positions shape:  {positions.shape}")
    print(f"Velocities shape: {velocities.shape}")
    print(f"Masses shape:     {masses.shape}")
    print(f"Forces shape:     {forces.shape}")

    return positions, velocities, masses, forces


def parse_args():
    parser = argparse.ArgumentParser(description="Generate Milky Way-like AGAMA initial conditions")
    parser.add_argument("--n", type=int, default=10000, help="number of bodies")
    parser.add_argument("--seed", type=int, default=42, help="random seed")
    parser.add_argument(
        "--smbh-mass",
        type=float,
        default=DEFAULT_SMBH_MASS,
        help="central supermassive black hole mass in toy units (set 0 to disable)",
    )
    parser.add_argument(
        "--smbh-exclusion-radius",
        type=float,
        default=DEFAULT_SMBH_EXCLUSION_RADIUS,
        help="minimum spawn radius around SMBH to reduce plunging/ejections",
    )
    parser.add_argument(
        "--out",
        type=str,
        default="/mnt/c/Users/Pranav/Code/C & C++/projects/nBody/scenarios/initial_conditions_agama.bin",
        help="output binary snapshot path",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    pos, vel, mass, frc = generate_milky_way_snapshot(
        num_particles=args.n,
        seed=args.seed,
        smbh_mass=args.smbh_mass,
        smbh_exclusion_radius=args.smbh_exclusion_radius,
    )
    write_agama_binary_snapshot(
        output_path=args.out,
        positions=pos,
        velocities=vel,
        masses=mass,
        forces=frc,
    )


# run this in the WSL terminal first:
# source /mnt/c/Users/Pranav/Code/repos/agama/.venv/bin/activate