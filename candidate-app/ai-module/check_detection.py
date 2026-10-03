"""Deterministic regressions; no camera, microphone, screenshot or process termination."""
import os
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from ai_monitor import AIMonitor
from usb_monitor import USBMonitor
from voice_monitor import VoiceMonitor
from whitelist_enforcer import WhitelistEnforcer
import server


class DetectionChecks(unittest.TestCase):
    def camera(self):
        # Use real initialization/model loading, but feed controlled frames/inference results.
        monitor = AIMonitor('check-session', on_violation=lambda event: None)
        self.assertIsNotNone(monitor.face_cascade)
        self.assertIsNotNone(monitor.ort_session)
        events = []
        monitor._emit_violation = lambda *args, **kwargs: events.append((args, kwargs))
        return monitor, events

    def test_normal_high_camera_position_does_not_mean_looking_up(self):
        monitor, events = self.camera()
        monitor.occlusion_detector = SimpleNamespace(analyze_frame=lambda frame: (False, '', {}))
        monitor.face_cascade = SimpleNamespace(detectMultiScale=lambda *a, **k: [(60, 20, 60, 60)])
        monitor.eye_cascade = SimpleNamespace(detectMultiScale=lambda *a, **k: [(20, 25, 12, 12), (70, 25, 12, 12)])
        monitor.eye_tree_cascade = None
        frame = np.full((480, 640, 3), 100, dtype=np.uint8)
        with patch('ai_monitor.time.monotonic', side_effect=range(100, 150)):
            for _ in range(25):
                monitor._check_faces_opencv(frame)
        self.assertEqual(events, [])
        self.assertIsNotNone(monitor.neutral_eye_y)

    def test_moderate_lateral_turn_uses_shorter_sustained_window(self):
        monitor, events = self.camera()
        monitor.occlusion_detector = SimpleNamespace(analyze_frame=lambda frame: (False, '', {}))
        monitor.face_cascade = SimpleNamespace(detectMultiScale=lambda *a, **k: [(60, 20, 60, 60)])
        monitor.eye_cascade = SimpleNamespace(detectMultiScale=lambda *a, **k: [(20, 25, 12, 12), (52, 25, 12, 12)])
        monitor.eye_tree_cascade = None
        monitor.neutral_eye_offset = 0.0
        monitor.neutral_eye_y = 31 / 120
        frame = np.full((480, 640, 3), 100, dtype=np.uint8)
        with patch('ai_monitor.time.monotonic', return_value=100):
            monitor._check_faces_opencv(frame)
        self.assertEqual(events, [])
        with patch('ai_monitor.time.monotonic', return_value=100.9):
            monitor._check_faces_opencv(frame)
        self.assertEqual(events[0][0][0], 'head_turn_away')
        self.assertEqual(events[0][1]['details']['direction'], 'left')

    def test_phone_needs_repeated_hits_and_respects_disabled_rule(self):
        monitor, events = self.camera()
        tensor = np.array([[[20, 30, 120, 180, 0.9, 67]]], dtype=np.float32)
        monitor.ort_session = SimpleNamespace(get_inputs=lambda: [SimpleNamespace(name='images')],
                                             run=lambda *a: [tensor])
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        with patch('ai_monitor.time.monotonic', side_effect=[100, 100.3, 100.6]):
            monitor._check_objects(frame)
            self.assertEqual(events, [])
            monitor._check_objects(frame)
            self.assertEqual(events, [])
            monitor._check_objects(frame)
        self.assertEqual(events[0][0][0], 'cell_phone')
        monitor.exam_rules['detectCellPhone'] = False
        with patch('ai_monitor.time.monotonic', return_value=110):
            for _ in range(4):
                monitor._check_objects(frame)
        self.assertEqual(len(events), 1)

    def test_real_model_accepts_blank_frame_without_phone_alert(self):
        monitor, events = self.camera()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        for _ in range(3):
            monitor._check_objects(frame)
        self.assertEqual(events, [])

    def test_other_winning_class_does_not_get_relabelled_phone(self):
        monitor, events = self.camera()
        tensor = np.zeros((1, 84, 1), dtype=np.float32)
        tensor[0, 4 + 67, 0] = 0.6
        tensor[0, 4 + 66, 0] = 0.95  # Keyboard is the actual highest-probability class.
        monitor.ort_session = SimpleNamespace(get_inputs=lambda: [SimpleNamespace(name='images')],
                                             run=lambda *a: [tensor])
        with patch('ai_monitor.time.monotonic', return_value=100):
            for _ in range(4):
                monitor._check_objects(np.zeros((480, 640, 3), dtype=np.uint8))
        self.assertEqual(events, [])

    def test_multiple_faces_need_sustained_time_and_reset_after_gap(self):
        monitor, events = self.camera()
        with patch('ai_monitor.time.monotonic', side_effect=[100, 100.1, 101.2]):
            monitor._record_face_count(2, None)
            monitor._record_face_count(2, None)
            self.assertEqual(events, [])
            monitor._record_face_count(2, None)
        self.assertEqual(events[0][0][0], 'second_person_detected')
        monitor._reset_temporal_state()
        self.assertIsNone(monitor.second_person_start)
        self.assertEqual(monitor.object_candidate_count, 0)

    def test_usb_reported_once_until_disconnected(self):
        events = []
        monitor = USBMonitor('check-session', events.append)
        monitor._handle_violation = events.append
        drive = {'device': 'USB1', 'label': 'test'}
        monitor._report_connected_drives([drive])
        monitor._report_connected_drives([drive])
        self.assertEqual(len(events), 1)
        monitor._report_connected_drives([])
        monitor._report_connected_drives([drive])
        self.assertEqual(len(events), 2)
        with patch('subprocess.run', return_value=SimpleNamespace(returncode=1, stdout='')):
            self.assertEqual(monitor.get_removable_drives(), [])
        self.assertIsNotNone(monitor.last_error)

    def test_unverified_window_title_does_not_terminate_new_answer(self):
        monitor = WhitelistEnforcer.__new__(WhitelistEnforcer)
        monitor.IGNORE_DIRS = ()
        monitor.DOC_EXTENSIONS = {'.docx'}
        monitor.exam_start_time = time.time()
        monitor._find_user_file_on_disk = lambda name: None
        events = []
        monitor._handle_file_violation = lambda *a, **k: events.append((a, k))
        proc = SimpleNamespace(pid=123, open_files=lambda: [])
        def set_pid(hwnd, pointer):
            pointer._obj.value = 123
        def set_title(hwnd, buffer, count):
            buffer.value = 'answers.docx - Word'
        ui = SimpleNamespace(GetForegroundWindow=lambda: 1, GetWindowThreadProcessId=set_pid,
                             GetWindowTextLengthW=lambda hwnd: 30, GetWindowTextW=set_title)
        with patch('ctypes.windll', SimpleNamespace(user32=ui), create=True):
            monitor._inspect_allowed_app(proc, 'winword.exe')
        self.assertEqual(events, [])
        with tempfile.TemporaryDirectory(dir=os.path.dirname(__file__), prefix='check-') as directory:
            file = os.path.join(directory, 'notes.docx')
            with open(file, 'w') as handle:
                handle.write('old notes')
            os.utime(file, (monitor.exam_start_time - 60,) * 2)
            proc.open_files = lambda: [SimpleNamespace(path=file)]
            monitor._inspect_allowed_app(proc, 'winword.exe')
        self.assertEqual(len(events), 1)  # Verified old files remain blocked.

    def test_distant_voice_mismatches_are_not_consecutive(self):
        monitor = VoiceMonitor.__new__(VoiceMonitor)
        monitor.is_self_check = False
        monitor.sample_rate = 16000
        monitor.reference_embedding = np.eye(1, 256, 0, dtype=np.float32)[0]
        monitor.thresholds = {'voice_similarity_threshold': 0.75, 'consecutive_mismatches_threshold': 2}
        monitor.mismatch_count = 0
        monitor.last_verified_at = 0
        monitor._get_encoder = lambda: SimpleNamespace(embed_utterance=lambda wav: np.eye(1, 256, 1)[0])
        monitor._save_audio_clip = lambda audio: "check-evidence.wav"
        events = []
        monitor._emit_violation = lambda **event: events.append(event)
        audio = np.full(32000, 1000, dtype=np.int16).tobytes()
        with patch('resemblyzer.preprocess_wav', side_effect=lambda wav, **kw: wav), \
             patch('voice_monitor.time.monotonic', side_effect=[100, 200, 205, 210, 215, 216]):
            monitor._verify_speaker_segment(audio, 2)
            monitor._verify_speaker_segment(audio, 2)
            self.assertEqual(events, [])
            monitor._verify_speaker_segment(audio, 2)
            monitor._verify_speaker_segment(audio, 2)
            monitor._verify_speaker_segment(audio, 2)
            self.assertEqual(len(events), 1)  # Cooldown suppresses repeat penalties.
            monitor._get_encoder = lambda: SimpleNamespace(embed_utterance=lambda wav: (_ for _ in ()).throw(RuntimeError('broken encoder')))
            monitor._verify_speaker_segment(audio, 2)
            self.assertIsNotNone(monitor.verification_error)
        self.assertEqual(len(events), 1)

    def test_voice_evidence_has_real_duration_and_rejects_empty(self):
        import wave
        monitor = VoiceMonitor.__new__(VoiceMonitor)
        monitor.sample_rate = 16000
        monitor.session_id = 'check-voice'
        with tempfile.TemporaryDirectory(dir=os.path.dirname(__file__), prefix='check-') as directory:
            with patch('voice_monitor.os.path.dirname', return_value=directory):
                self.assertIsNone(monitor._save_audio_clip(b''))
                audio = np.full(48000, 1000, dtype=np.int16).tobytes()
                path = monitor._save_audio_clip(audio)
                with wave.open(path, 'rb') as clip:
                    self.assertEqual(clip.getnframes() / clip.getframerate(), 3.0)

    def test_voice_analysis_queue_is_bounded(self):
        import queue
        monitor = VoiceMonitor.__new__(VoiceMonitor)
        monitor.verification_queue = queue.Queue(maxsize=2)
        monitor.verification_error = None
        for _ in range(3):
            monitor._queue_voice_segment(b'check', 3)
        self.assertEqual(monitor.verification_queue.qsize(), 2)
        self.assertIsNotNone(monitor.verification_error)

    def test_voice_enrollment_confirmation_and_quality(self):
        monitor = VoiceMonitor.__new__(VoiceMonitor)
        monitor.sample_rate = 16000
        monitor.session_id = 'voice-check'
        monitor.thresholds = {'voice_similarity_threshold': 0.75}
        monitor.reference_embedding = None
        embedding = np.eye(1, 256, 0, dtype=np.float32)[0]
        monitor._get_encoder = lambda: SimpleNamespace(embed_utterance=lambda wav: embedding)
        audio = np.full(16000 * 8, 0.1, dtype=np.float32)
        with tempfile.TemporaryDirectory(dir=os.path.dirname(__file__), prefix='check-') as directory:
            monitor.storage_dir = directory
            with patch('resemblyzer.preprocess_wav', side_effect=lambda wav, **kw: wav):
                self.assertFalse(monitor.set_reference_voice(audio)['success'])
                self.assertFalse(monitor.set_reference_voice(np.ones(16000 * 8), confirmation_audio=audio)['success'])
                self.assertFalse(monitor.set_reference_voice(audio, confirmation_audio=np.zeros(100))['success'])
                self.assertTrue(monitor.set_reference_voice(audio, confirmation_audio=audio)['success'])
                # A mismatching confirmation must not replace the saved reference.
                encoder = SimpleNamespace(embed_utterance=lambda wav: np.eye(1, 256, 1)[0] if len(wav) < 100000 else embedding)
                monitor._get_encoder = lambda: encoder
                self.assertFalse(monitor.set_reference_voice(audio, confirmation_audio=audio[:64000])['success'])
                np.testing.assert_array_equal(monitor.reference_embedding, embedding)

    def test_health_does_not_claim_dead_camera_is_monitoring(self):
        camera = SimpleNamespace(camera_ready=False, ort_session=object(),
                                 detector_errors={}, mp_face_mesh=None, face_cascade=object())
        voice = SimpleNamespace(vad=object(), encoder=object(), running=True,
                                stream=object(), reference_embedding=object())
        with patch.dict(os.environ, {'EXAM_TYPE': 'online', 'IS_SELF_CHECK': 'false', 'EXAM_RULES': '{}'}), \
             patch.object(server, 'ai_monitor', camera, create=True), \
             patch.object(server, 'voice_monitor', voice, create=True):
            health = server.health_check()
        self.assertEqual(health['status'], 'degraded')
        self.assertTrue(any('Camera' in error for error in health['errors']))


if __name__ == '__main__':
    unittest.main()
