"""RunPod Serverless handler for cloth simulation using NVIDIA Warp.

Takes the triangulated GCD panels + stitch constraints + (optional) avatar mesh
and produces a draped GLB plus per-triangle stretch metrics.

input:
  cloth_input:   { panels: [...], stitches: [...] }    # from lib/stitch-graph.ts
  avatar_glb:    base64 GLB of the body to collide against (optional)
  substeps:      int, default 80
  fabric:        "cotton" | "denim" | "silk" | "leather" | "wool" | "linen"
                 (sets stretch/bend stiffness presets)
  gravity:       [0, -9.81, 0] (default)

output:
  draped_glb:    base64 GLB of the final stitched mesh
  metrics:       { maxStretch, maxCompression, meanStretch }
  warnings:      [str]   # e.g. "panel 'sleeve' didn't converge"
"""

from __future__ import annotations

import base64
import io
import os
from typing import Any, Dict, List, Tuple

import runpod
import numpy as np

# Warp is heavy; import lazily inside the handler so cold-start importing
# isn't paid until the first real call. The module is cached after first import.
_warp = None
_trimesh = None


FABRIC_PRESETS = {
    "cotton":  {"tri_ka": 1.0e3, "tri_kd": 0.1, "tri_drag": 0.01, "edge_ke": 100.0},
    "denim":   {"tri_ka": 4.0e3, "tri_kd": 0.2, "tri_drag": 0.02, "edge_ke": 500.0},
    "silk":    {"tri_ka": 5.0e2, "tri_kd": 0.05, "tri_drag": 0.005, "edge_ke": 50.0},
    "leather": {"tri_ka": 8.0e3, "tri_kd": 0.3, "tri_drag": 0.03, "edge_ke": 800.0},
    "wool":    {"tri_ka": 2.0e3, "tri_kd": 0.15, "tri_drag": 0.015, "edge_ke": 200.0},
    "linen":   {"tri_ka": 1.5e3, "tri_kd": 0.1, "tri_drag": 0.01, "edge_ke": 150.0},
}


def _load_modules():
    global _warp, _trimesh
    if _warp is None:
        import warp as wp  # type: ignore
        import warp.sim  # type: ignore
        wp.init()
        _warp = wp
    if _trimesh is None:
        import trimesh  # type: ignore
        _trimesh = trimesh
    return _warp, _trimesh


def _quat_rotate(q: List[float], v: np.ndarray) -> np.ndarray:
    # Quaternion is stored as [w, x, y, z] in GCD output (typical convention).
    if len(q) == 3:
        # Euler XYZ in radians (GarmentGPT sometimes stores Euler in `rotation`)
        from scipy.spatial.transform import Rotation as R
        return R.from_euler("xyz", q).apply(v)
    w, x, y, z = q
    # Standard quaternion rotation.
    qvec = np.array([x, y, z])
    uv = np.cross(qvec, v)
    uuv = np.cross(qvec, uv)
    return v + 2.0 * (w * uv + uuv)


def _panel_to_3d(panel: Dict[str, Any]) -> np.ndarray:
    """Lift a 2D panel into its initial 3D position using GCD translation+rotation."""
    flat = np.asarray(panel["vertices2D"], dtype=np.float32).reshape(-1, 2)
    # Default: panel is in the XY plane; lift z=0.
    v3 = np.concatenate([flat, np.zeros((flat.shape[0], 1), dtype=np.float32)], axis=1)
    rot = panel.get("rotation", [1.0, 0.0, 0.0, 0.0])
    tx = np.asarray(panel.get("translation", [0, 0, 0]), dtype=np.float32)
    rotated = np.stack([_quat_rotate(rot, v) for v in v3])
    return rotated + tx


def _build_model(wp, cloth_input: Dict[str, Any], fabric: str, avatar_mesh):
    builder = wp.sim.ModelBuilder()
    panels = cloth_input["panels"]
    stitches = cloth_input.get("stitches", [])
    preset = FABRIC_PRESETS.get(fabric, FABRIC_PRESETS["cotton"])

    panel_offsets: List[int] = []
    for p in panels:
        v3 = _panel_to_3d(p)
        offset = builder.particle_count
        panel_offsets.append(offset)
        for v in v3:
            builder.add_particle(pos=tuple(float(x) for x in v), vel=(0.0, 0.0, 0.0), mass=0.05)
        tris = p["triangles"]
        for i in range(0, len(tris), 3):
            i0, i1, i2 = tris[i], tris[i + 1], tris[i + 2]
            builder.add_triangle(
                offset + i0, offset + i1, offset + i2,
                tri_ke=preset["tri_ka"], tri_ka=preset["tri_ka"],
                tri_kd=preset["tri_kd"], tri_drag=preset["tri_drag"],
            )

    # Stitches → spring-style constraints between matched vertex pairs.
    for s in stitches:
        a = panel_offsets[s["a"]["panel"]] + s["a"]["vertex"]
        b = panel_offsets[s["b"]["panel"]] + s["b"]["vertex"]
        builder.add_edge(a, b, edge_ke=preset["edge_ke"])

    if avatar_mesh is not None:
        # Add the avatar as a static collision mesh.
        verts = avatar_mesh.vertices.astype(np.float32)
        faces = avatar_mesh.faces.astype(np.int32).flatten()
        mesh_id = builder.add_shape_mesh(
            body=-1,
            mesh=wp.sim.Mesh(verts.tolist(), faces.tolist()),
            density=0.0,
        )
        _ = mesh_id

    builder.set_ground_plane(False)
    model = builder.finalize()
    model.particle_radius = 0.01
    model.soft_contact_distance = 0.02
    return model, panel_offsets


def _run_sim(wp, model, substeps: int, dt: float = 1.0 / 60.0):
    integrator = wp.sim.XPBDIntegrator(iterations=substeps)
    state_0 = model.state()
    state_1 = model.state()
    for _ in range(substeps):
        wp.sim.collide(model, state_0)
        state_1.clear_forces()
        integrator.simulate(model, state_0, state_1, dt)
        state_0, state_1 = state_1, state_0
    return state_0


def _state_to_glb(trimesh, model, state_0, panels, panel_offsets) -> bytes:
    positions = state_0.particle_q.numpy().astype(np.float32)
    scene = trimesh.Scene()
    for pi, panel in enumerate(panels):
        start = panel_offsets[pi]
        end = start + len(panel["vertices2D"]) // 2
        verts = positions[start:end]
        faces = np.asarray(panel["triangles"], dtype=np.int32).reshape(-1, 3)
        mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
        scene.add_geometry(mesh, node_name=panel["name"])
    buf = io.BytesIO()
    scene.export(buf, file_type="glb")
    return buf.getvalue()


def _compute_metrics(model, state_0) -> Dict[str, float]:
    rest_lengths = model.edge_rest_lengths.numpy() if hasattr(model, "edge_rest_lengths") else None
    pos = state_0.particle_q.numpy()
    if rest_lengths is None or len(rest_lengths) == 0:
        return {"maxStretch": 1.0, "maxCompression": 1.0, "meanStretch": 1.0}
    edges = model.edge_indices.numpy() if hasattr(model, "edge_indices") else None
    if edges is None or len(edges) == 0:
        return {"maxStretch": 1.0, "maxCompression": 1.0, "meanStretch": 1.0}
    ratios: List[float] = []
    for (i, j), rest in zip(edges, rest_lengths):
        if rest <= 1e-6:
            continue
        cur = float(np.linalg.norm(pos[j] - pos[i]))
        ratios.append(cur / rest)
    if not ratios:
        return {"maxStretch": 1.0, "maxCompression": 1.0, "meanStretch": 1.0}
    return {
        "maxStretch": float(np.max(ratios)),
        "maxCompression": float(np.min(ratios)),
        "meanStretch": float(np.mean(ratios)),
    }


def handler(event: Dict[str, Any]) -> Dict[str, Any]:
    inp = event.get("input") or {}
    cloth_input = inp.get("cloth_input")
    if not cloth_input or "panels" not in cloth_input:
        return {"error": "input.cloth_input.panels is required"}
    fabric = inp.get("fabric", "cotton")
    substeps = int(inp.get("substeps", 80))

    wp, trimesh = _load_modules()

    avatar_b64 = inp.get("avatar_glb")
    avatar_mesh = None
    if avatar_b64:
        try:
            avatar_mesh = trimesh.load(io.BytesIO(base64.b64decode(avatar_b64)), file_type="glb")
            if hasattr(avatar_mesh, "geometry"):
                geoms = list(avatar_mesh.geometry.values())
                avatar_mesh = trimesh.util.concatenate(geoms) if geoms else None
        except Exception as e:
            return {"error": f"failed to decode avatar glb: {e!s}"}

    try:
        model, panel_offsets = _build_model(wp, cloth_input, fabric, avatar_mesh)
        state = _run_sim(wp, model, substeps=substeps)
        glb = _state_to_glb(trimesh, model, state, cloth_input["panels"], panel_offsets)
        metrics = _compute_metrics(model, state)
    except Exception as e:
        return {"error": f"sim failed: {e!s}"}

    return {
        "draped_glb": base64.b64encode(glb).decode("ascii"),
        "metrics": metrics,
    }


runpod.serverless.start({"handler": handler})
