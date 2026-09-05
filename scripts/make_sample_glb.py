#!/usr/bin/env python3
"""Build a tiny self-contained sample.glb for glTF Stage (no extra deps)."""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path


def pad4(data: bytes, pad: bytes) -> bytes:
    n = (4 - (len(data) % 4)) % 4
    return data + pad * n


class Bin:
    def __init__(self) -> None:
        self.buf = bytearray()
        self.views: list[dict] = []
        self.accessors: list[dict] = []

    def add(self, data: bytes, target: int | None = None) -> int:
        while len(self.buf) % 4:
            self.buf.append(0)
        offset = len(self.buf)
        self.buf.extend(data)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        self.views.append(view)
        return len(self.views) - 1

    def add_f32(self, values: list[float], typ: str, extra: dict | None = None) -> int:
        data = struct.pack("<" + "f" * len(values), *values)
        view = self.add(data, 34962)
        acc = {
            "bufferView": view,
            "componentType": 5126,
            "count": len(values) // {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[typ],
            "type": typ,
        }
        if extra:
            acc.update(extra)
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def add_u16(self, values: list[int]) -> int:
        data = struct.pack("<" + "H" * len(values), *values)
        view = self.add(data, 34963)
        self.accessors.append(
            {
                "bufferView": view,
                "componentType": 5123,
                "count": len(values),
                "type": "SCALAR",
            }
        )
        return len(self.accessors) - 1


def bounds(vecs: list[tuple[float, ...]]) -> tuple[list[float], list[float]]:
    mins = [min(v[i] for v in vecs) for i in range(len(vecs[0]))]
    maxs = [max(v[i] for v in vecs) for i in range(len(vecs[0]))]
    return mins, maxs


def mesh_from_faces(
    binbuf: Bin,
    positions: list[tuple[float, float, float]],
    normals: list[tuple[float, float, float]],
    indices: list[int],
    material: int,
) -> dict:
    pmin, pmax = bounds(positions)
    nmin, nmax = bounds(normals)
    pos_acc = binbuf.add_f32(
        [c for p in positions for c in p],
        "VEC3",
        {"min": pmin, "max": pmax},
    )
    nrm_acc = binbuf.add_f32(
        [c for n in normals for c in n],
        "VEC3",
        {"min": nmin, "max": nmax},
    )
    idx_acc = binbuf.add_u16(indices)
    return {
        "primitives": [
            {
                "attributes": {"POSITION": pos_acc, "NORMAL": nrm_acc},
                "indices": idx_acc,
                "material": material,
            }
        ]
    }


def cube(size: float = 0.7) -> tuple[list, list, list]:
    h = size / 2
    faces = [
        ((0, 0, 1), [(-h, -h, h), (h, -h, h), (h, h, h), (-h, h, h)]),
        ((0, 0, -1), [(h, -h, -h), (-h, -h, -h), (-h, h, -h), (h, h, -h)]),
        ((1, 0, 0), [(h, -h, h), (h, -h, -h), (h, h, -h), (h, h, h)]),
        ((-1, 0, 0), [(-h, -h, -h), (-h, -h, h), (-h, h, h), (-h, h, -h)]),
        ((0, 1, 0), [(-h, h, h), (h, h, h), (h, h, -h), (-h, h, -h)]),
        ((0, -1, 0), [(-h, -h, -h), (h, -h, -h), (h, -h, h), (-h, -h, h)]),
    ]
    positions, normals, indices = [], [], []
    for normal, verts in faces:
        base = len(positions)
        positions.extend(verts)
        normals.extend([normal] * 4)
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    return positions, normals, indices


def cylinder(radius: float, height: float, segs: int = 20) -> tuple[list, list, list]:
    positions, normals, indices = [], [], []
    hy = height / 2
    ring_top, ring_bot = [], []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        x, z = math.cos(a) * radius, math.sin(a) * radius
        nx, nz = math.cos(a), math.sin(a)
        ring_top.append(len(positions))
        positions.append((x, hy, z))
        normals.append((nx, 0.0, nz))
        ring_bot.append(len(positions))
        positions.append((x, -hy, z))
        normals.append((nx, 0.0, nz))
    for i in range(segs):
        t0, b0 = ring_top[i], ring_bot[i]
        t1, b1 = ring_top[(i + 1) % segs], ring_bot[(i + 1) % segs]
        indices.extend([t0, b0, t1, t1, b0, b1])

    def cap(y: float, normal: tuple[float, float, float], reverse: bool) -> None:
        center = len(positions)
        positions.append((0.0, y, 0.0))
        normals.append(normal)
        rim = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            rim.append(len(positions))
            positions.append((math.cos(a) * radius, y, math.sin(a) * radius))
            normals.append(normal)
        for i in range(segs):
            a, b = rim[i], rim[(i + 1) % segs]
            indices.extend([center, b, a] if reverse else [center, a, b])

    cap(hy, (0.0, 1.0, 0.0), False)
    cap(-hy, (0.0, -1.0, 0.0), True)
    return positions, normals, indices


def sphere(radius: float, slices: int = 14, stacks: int = 10) -> tuple[list, list, list]:
    positions, normals, indices = [], [], []
    for stack in range(stacks + 1):
        v = stack / stacks
        phi = math.pi * v
        for sl in range(slices + 1):
            u = sl / slices
            th = 2 * math.pi * u
            x = math.sin(phi) * math.cos(th)
            y = math.cos(phi)
            z = math.sin(phi) * math.sin(th)
            positions.append((x * radius, y * radius, z * radius))
            normals.append((x, y, z))
    for stack in range(stacks):
        for sl in range(slices):
            a = stack * (slices + 1) + sl
            b = a + slices + 1
            indices.extend([a, b, a + 1, a + 1, b, b + 1])
    return positions, normals, indices


def quat_y(degrees: float) -> tuple[float, float, float, float]:
    half = math.radians(degrees) * 0.5
    return (0.0, math.sin(half), 0.0, math.cos(half))


def build() -> bytes:
    binbuf = Bin()

    materials = [
        {
            "name": "PedestalMat",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.52, 0.55, 0.60, 1.0],
                "metallicFactor": 0.15,
                "roughnessFactor": 0.55,
            },
        },
        {
            "name": "CubeMat",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.90, 0.42, 0.18, 1.0],
                "metallicFactor": 0.05,
                "roughnessFactor": 0.45,
            },
        },
        {
            "name": "SphereMat",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.18, 0.68, 0.72, 1.0],
                "metallicFactor": 0.25,
                "roughnessFactor": 0.35,
            },
        },
    ]

    meshes = [
        mesh_from_faces(binbuf, *cylinder(0.46, 0.82), 0),
        mesh_from_faces(binbuf, *cube(0.72), 1),
        mesh_from_faces(binbuf, *sphere(0.22), 2),
    ]
    meshes[0]["name"] = "PedestalMesh"
    meshes[1]["name"] = "CubeMesh"
    meshes[2]["name"] = "SphereMesh"

    times = [0.0, 1.0, 2.0]
    rots = [quat_y(0.0), quat_y(180.0), quat_y(360.0)]
    time_acc = binbuf.add_f32(times, "SCALAR", {"min": [0.0], "max": [2.0]})
    rot_acc = binbuf.add_f32([c for q in rots for c in q], "VEC4")

    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "gltf-stage/scripts/make_sample_glb.py",
        },
        "scene": 0,
        "scenes": [{"name": "Scene", "nodes": [0]}],
        "nodes": [
            {"name": "Sample", "children": [1, 2, 3]},
            {
                "name": "Pedestal",
                "mesh": 0,
                "translation": [0.0, 0.41, 0.0],
            },
            {
                "name": "Cube",
                "mesh": 1,
                "translation": [0.0, 1.18, 0.0],
            },
            {
                "name": "Sphere",
                "mesh": 2,
                "translation": [0.86, 0.34, 0.62],
            },
        ],
        "meshes": meshes,
        "materials": materials,
        "animations": [
            {
                "name": "Spin",
                "samplers": [
                    {"input": time_acc, "interpolation": "LINEAR", "output": rot_acc}
                ],
                "channels": [{"sampler": 0, "target": {"node": 2, "path": "rotation"}}],
            }
        ],
        "accessors": binbuf.accessors,
        "bufferViews": binbuf.views,
        "buffers": [{"byteLength": len(pad4(bytes(binbuf.buf), b"\x00"))}],
    }

    json_bytes = pad4(
        json.dumps(gltf, separators=(",", ":")).encode("utf-8"),
        b" ",
    )
    bin_bytes = pad4(bytes(binbuf.buf), b"\x00")
    json_chunk = struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
    bin_chunk = struct.pack("<I4s", len(bin_bytes), b"BIN\x00") + bin_bytes
    total = 12 + len(json_chunk) + len(bin_chunk)
    header = struct.pack("<4sII", b"glTF", 2, total)
    return header + json_chunk + bin_chunk


def main() -> None:
    out = Path(__file__).resolve().parents[1] / "models" / "sample.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    data = build()
    out.write_bytes(data)
    print(f"wrote {out} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
