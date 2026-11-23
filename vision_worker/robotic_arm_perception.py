from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class CameraIntrinsics:
    fx: float
    fy: float
    cx: float
    cy: float

    def project_3d_to_pixel(self, x: float, y: float, z: float) -> Tuple[float, float]:
        if z <= 0:
            raise ValueError("Z coordinate must be strictly positive in front of camera")
        u = (self.fx * x / z) + self.cx
        v = (self.fy * y / z) + self.cy
        return (u, v)

    def backproject_pixel_to_3d(self, u: float, v: float, depth: float) -> Tuple[float, float, float]:
        if depth <= 0:
            raise ValueError("Depth must be strictly positive")
        x = (u - self.cx) * depth / self.fx
        y = (v - self.cy) * depth / self.fy
        return (x, y, depth)


@dataclass(frozen=True)
class Pose6DoF:
    translation: Tuple[float, float, float]  # (x, y, z) in meters
    rotation_matrix: Tuple[Tuple[float, float, float], ...]  # 3x3 orthonormal rotation
    confidence: float

    def transform_point(self, point: Tuple[float, float, float]) -> Tuple[float, float, float]:
        r = self.rotation_matrix
        t = self.translation
        px, py, pz = point
        tx = r[0][0] * px + r[0][1] * py + r[0][2] * pz + t[0]
        ty = r[1][0] * px + r[1][1] * py + r[1][2] * pz + t[1]
        tz = r[2][0] * px + r[2][1] * py + r[2][2] * pz + t[2]
        return (round(tx, 4), round(ty, 4), round(tz, 4))


@dataclass(frozen=True)
class PointCloudFilterStats:
    original_points: int
    filtered_points: int
    compression_ratio: float
    mean_residual_error: float


class RoboticArmPerceptionPipeline:
    """
    Perception engine for robotic manipulation arms:
    - RGBD depth backprojection and spatial voxel-grid downsampling
    - Camera extrinsics rigid-body transformation into arm base coordinates
    - 6DoF object pose estimation verification and grasp frame coordinate mapping
    """

    @staticmethod
    def voxel_grid_downsample(
        points: Sequence[Tuple[float, float, float]],
        voxel_size: float = 0.05,
    ) -> List[Tuple[float, float, float]]:
        if voxel_size <= 0:
            raise ValueError("Voxel size must be positive")

        grid: Dict[Tuple[int, int, int], List[Tuple[float, float, float]]] = {}
        for p in points:
            vx = int(math.floor(p[0] / voxel_size))
            vy = int(math.floor(p[1] / voxel_size))
            vz = int(math.floor(p[2] / voxel_size))
            key = (vx, vy, vz)
            grid.setdefault(key, []).append(p)

        centroid_cloud: List[Tuple[float, float, float]] = []
        for voxel_pts in grid.values():
            n = len(voxel_pts)
            mean_x = sum(pt[0] for pt in voxel_pts) / n
            mean_y = sum(pt[1] for pt in voxel_pts) / n
            mean_z = sum(pt[2] for pt in voxel_pts) / n
            centroid_cloud.append((round(mean_x, 4), round(mean_y, 4), round(mean_z, 4)))

        return centroid_cloud

    @staticmethod
    def statistical_outlier_removal(
        points: Sequence[Tuple[float, float, float]],
        mean_dist_threshold: float = 0.15,
    ) -> List[Tuple[float, float, float]]:
        if not points:
            return []

        # Remove points located far from median point density
        n = len(points)
        cx = sum(p[0] for p in points) / n
        cy = sum(p[1] for p in points) / n
        cz = sum(p[2] for p in points) / n

        filtered: List[Tuple[float, float, float]] = []
        for p in points:
            dist = math.sqrt((p[0] - cx) ** 2 + (p[1] - cy) ** 2 + (p[2] - cz) ** 2)
            if dist <= mean_dist_threshold:
                filtered.append(p)

        return filtered

    @classmethod
    def estimate_grasp_pose_in_base_frame(
        cls,
        object_camera_pose: Pose6DoF,
        camera_to_base_extrinsics: Pose6DoF,
        target_grasp_offset: Tuple[float, float, float] = (0.0, 0.0, 0.05),
    ) -> Pose6DoF:
        # Step 1: Compute grasp location in camera frame
        grasp_cam = object_camera_pose.transform_point(target_grasp_offset)

        # Step 2: Transform grasp location into robotic arm base coordinates
        grasp_base = camera_to_base_extrinsics.transform_point(grasp_cam)

        # Step 3: Combine rotation: R_base = R_extrinsic * R_obj
        r_ext = camera_to_base_extrinsics.rotation_matrix
        r_obj = object_camera_pose.rotation_matrix

        r_base = [
            [
                round(sum(r_ext[i][k] * r_obj[k][j] for k in range(3)), 4)
                for j in range(3)
            ]
            for i in range(3)
        ]

        composite_conf = round(object_camera_pose.confidence * camera_to_base_extrinsics.confidence, 4)

        return Pose6DoF(
            translation=grasp_base,
            rotation_matrix=(tuple(r_base[0]), tuple(r_base[1]), tuple(r_base[2])),
            confidence=composite_conf,
        )
