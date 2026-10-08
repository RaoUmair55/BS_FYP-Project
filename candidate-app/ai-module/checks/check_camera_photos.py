import sys
from pathlib import Path

# Keep production modules importable when this developer check is run directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import os
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
import cv2
import base64
import server

class CameraPhotoChecks(unittest.TestCase):
    # Function purpose: Checks that recent monitor frame encodes without opening camera using controlled test inputs.
    def test_recent_monitor_frame_encodes_without_opening_camera(self):
        with patch.object(server, 'ai_monitor', SimpleNamespace(latest_identity_frame=np.zeros((48,64,3),dtype=np.uint8),last_frame_at=time.monotonic()), create=True), patch.dict(os.environ, {'EXAM_TYPE':'online'}), patch('cv2.VideoCapture', side_effect=AssertionError('Must reuse monitor camera')):
            result=server.identity_photo()
            self.assertTrue(result['success'])
            image=cv2.imdecode(np.frombuffer(base64.b64decode(result['photoBase64'].split(',')[1]),dtype=np.uint8),cv2.IMREAD_COLOR)
            self.assertEqual(image.shape,(48,64,3))
    # Function purpose: Checks that stale missing and physical lab frames are rejected using controlled test inputs.
    def test_stale_missing_and_physical_lab_frames_are_rejected(self):
        for frame,stamp,mode in [(None,time.monotonic(),'online'),(np.zeros((48,64,3),dtype=np.uint8),0,'online'),(np.zeros((48,64,3),dtype=np.uint8),time.monotonic(),'physical_lab')]:
            with patch.object(server,'ai_monitor',SimpleNamespace(latest_identity_frame=frame,last_frame_at=stamp),create=True),patch.dict(os.environ,{'EXAM_TYPE':mode}):
                self.assertFalse(server.identity_photo()['success'])

if __name__=='__main__':unittest.main()
