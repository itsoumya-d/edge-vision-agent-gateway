import unittest
from vision_worker.robotic_arm_perception import (
    CameraIntrinsics,
    Pose6DoF,
    RoboticArmPerceptionPipeline,
)


class TestRoboticArmPerception(unittest.TestCase):
    def setUp(self):
        # 640x480 resolution camera intrinsics
        self.intrinsics = CameraIntrinsics(fx=525.0, fy=525.0, cx=320.0, cy=240.0)

    def test_camera_projection_and_backprojection(self):
        # 3D point in front of camera (x=0.5m, y=-0.25m, z=2.0m)
        x, y, z = 0.5, -0.25, 2.0
        u, v = self.intrinsics.project_3d_to_pixel(x, y, z)

        self.assertAlmostEqual(u, (525.0 * 0.5 / 2.0) + 320.0, places=4)
        self.assertAlmostEqual(v, (525.0 * -0.25 / 2.0) + 240.0, places=4)

        # Backprojection recovers original 3D point
        recovered_x, recovered_y, recovered_z = self.intrinsics.backproject_pixel_to_3d(u, v, z)
        self.assertAlmostEqual(recovered_x, x, places=4)
        self.assertAlmostEqual(recovered_y, y, places=4)
        self.assertAlmostEqual(recovered_z, z, places=4)

    def test_voxel_grid_downsample(self):
        # Dense cluster of 10 points within a single 0.05m voxel box
        cluster = [(0.01 * i, 0.01 * i, 1.0) for i in range(10)]
        downsampled = RoboticArmPerceptionPipeline.voxel_grid_downsample(cluster, voxel_size=0.10)

        # Should be compressed into a single voxel centroid
        self.assertEqual(len(downsampled), 1)
        centroid = downsampled[0]
        self.assertAlmostEqual(centroid[2], 1.0, places=3)

    def test_statistical_outlier_removal(self):
        # 5 dense points clustered around (0, 0, 1.0) and 1 extreme outlier at (5.0, 5.0, 10.0)
        points = [
            (0.01, 0.01, 1.0),
            (0.02, 0.01, 1.0),
            (-0.01, 0.02, 1.0),
            (0.00, -0.01, 1.0),
            (0.01, 0.00, 1.0),
            (5.0, 5.0, 10.0),  # outlier
        ]
        filtered = RoboticArmPerceptionPipeline.statistical_outlier_removal(points, mean_dist_threshold=2.0)
        self.assertEqual(len(filtered), 5)
        self.assertNotIn((5.0, 5.0, 10.0), filtered)

    def test_estimate_grasp_pose_in_base_frame(self):
        identity_rot = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
        # Object detected at 0.5m in front of camera
        object_pose = Pose6DoF(
            translation=(0.1, 0.0, 0.5),
            rotation_matrix=identity_rot,
            confidence=0.95,
        )

        # Camera mounted 1.0m above robot base with 0.2m offset
        camera_extrinsics = Pose6DoF(
            translation=(0.2, 0.0, 1.0),
            rotation_matrix=identity_rot,
            confidence=0.98,
        )

        grasp_base = RoboticArmPerceptionPipeline.estimate_grasp_pose_in_base_frame(
            object_camera_pose=object_pose,
            camera_to_base_extrinsics=camera_extrinsics,
            target_grasp_offset=(0.0, 0.0, 0.05),
        )

        self.assertIsInstance(grasp_base, Pose6DoF)
        # Expected base position = camera_t + object_t + offset
        # x = 0.2 + 0.1 = 0.3
        # y = 0.0
        # z = 1.0 + 0.5 + 0.05 = 1.55
        self.assertAlmostEqual(grasp_base.translation[0], 0.3, places=3)
        self.assertAlmostEqual(grasp_base.translation[1], 0.0, places=3)
        self.assertAlmostEqual(grasp_base.translation[2], 1.55, places=3)
        self.assertGreater(grasp_base.confidence, 0.90)


if __name__ == "__main__":
    unittest.main()
