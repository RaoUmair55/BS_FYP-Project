# IntegrityFlow file overview
# Purpose: Deterministic regression checks for monitoring decisions.
# How it works: Uses synthetic inputs and mocked operations to exercise
#  head-turn, object, voice, USB, file-rule and related failure handling.
# Connection: A developer check rather than a live monitoring loop;
#  it avoids real camera recording and process termination.
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
    def test_biased_neutral_cannot_label_frontal_pose_left(self):
        monitor, events = self.camera()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        monitor.neutral_pose = np.array([-8., 0.])
        # Current supplied screenshot estimates about +10.5 degrees. Relative to
        # a biased -8 baseline this looks like +18.5, but is still nearly frontal.
        for i in range(20):
            with patch('ai_monitor.time.monotonic', return_value=100 + i * .085):
                monitor._observe_head_pose(10.5, 0, frame)
        self.assertEqual(events, [])
        self.assertIsNone(monitor.head_direction)
        for i in range(14):
            with patch('ai_monitor.time.monotonic', return_value=103 + i * .085):
                monitor._observe_head_pose(35, 0, frame)
        self.assertEqual(events[0][1]['details']['direction'], 'left')
        # Returning frontal must clear the direction, rather than hold it through
        # the relative-angle hysteresis and repeatedly flag the same forward pose.
        for i in range(50):
            with patch('ai_monitor.time.monotonic', return_value=104.3 + i * .085):
                monitor._observe_head_pose(10.5, 0, frame)
        self.assertEqual(len(events), 1)
        self.assertIsNone(monitor.head_direction)

    def test_occlusion_handles_bright_cover_and_normal_exposure(self):
        from services.lighting_occlusion_detector import CameraOcclusionDetector
        detector = CameraOcclusionDetector()
        white_cover = np.full((480, 640), 245, dtype=np.uint8)
        with patch('services.lighting_occlusion_detector.time.monotonic', side_effect=[100, 100.3, 101.3]):
            self.assertFalse(detector.analyze_frame(white_cover)[0])
            self.assertFalse(detector.analyze_frame(white_cover)[0])
            self.assertTrue(detector.analyze_frame(white_cover)[0])
        gradient = np.tile(np.linspace(50, 220, 640, dtype=np.uint8), (480, 1))
        self.assertFalse(detector.analyze_frame(gradient)[0])
        self.assertIsNone(detector.occlusion_start_time)

    def test_usb_query_covers_uasp_and_reports_storage_only(self):
        monitor = USBMonitor('check-session', lambda event: None)
        result = SimpleNamespace(returncode=0, stdout='[{"DeviceID":"USB1","Model":"External SSD","Size":100}]')
        with patch('subprocess.run', return_value=result) as run:
            drives = monitor.get_removable_drives()
        self.assertEqual(drives[0]['label'], 'External SSD')
        query = run.call_args.args[0][-1]
        self.assertIn("BusType -eq 7", query)
        self.assertIn('$usbNumbers -contains $_.Index', query)

    def test_voice_invalid_segments_reset_mismatch_and_capture_recovers(self):
        monitor = VoiceMonitor.__new__(VoiceMonitor)
        monitor.is_self_check = False
        monitor.sample_rate = 16000
        monitor.reference_embedding = np.eye(1, 256, 0, dtype=np.float32)[0]
        monitor.thresholds = {}
        monitor.mismatch_count = 1
        monitor._get_encoder = lambda: object()
        audio = np.full(32000, 1000, dtype=np.int16).tobytes()
        with patch('resemblyzer.preprocess_wav', return_value=np.zeros(100)):
            monitor._verify_speaker_segment(audio, 2)
        self.assertEqual(monitor.mismatch_count, 0)
        monitor.mismatch_count = 1
        monitor._verify_speaker_segment(np.full(32000, 32767, dtype=np.int16).tobytes(), 2)
        self.assertEqual(monitor.mismatch_count, 0)
        monitor.running = True
        monitor.capture_error = None
        attempts = []
        def capture():
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError('device disconnected')
            monitor.running = False
        monitor._capture_loop = capture
        with patch('voice_monitor.time.sleep'):
            monitor._monitor_loop()
        self.assertEqual(len(attempts), 2)
        self.assertIn('device disconnected', monitor.capture_error)

    def test_phone_book_track_separately_and_reject_spatial_jumps(self):
        monitor, events = self.camera()
        tensor = np.array([[[20, 110, 120, 210, .9, 67], [300, 130, 440, 290, .8, 73]]], dtype=np.float32)
        inputs = []
        def infer(_, data):
            inputs.append(data['images'])
            return [tensor]
        monitor.ort_session = SimpleNamespace(get_inputs=lambda: [SimpleNamespace(name='images')], run=infer)
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        with patch('ai_monitor.time.monotonic', side_effect=[100, 100.3, 100.6]):
            for _ in range(3):
                monitor._check_objects(frame)
                tensor[0, 0, 4], tensor[0, 1, 4] = tensor[0, 1, 4], tensor[0, 0, 4]
        self.assertEqual({event[0][0] for event in events}, {'cell_phone', 'unauthorized_object'})
        self.assertTrue(np.allclose(inputs[0][0, :, :80, :], 114 / 255))
        self.assertTrue(np.all(inputs[0][0, :, 80:560, :] == 0))
        events.clear()
        monitor._reset_temporal_state()
        with patch('ai_monitor.time.monotonic', side_effect=[110, 110.3, 110.6]):
            for x in (20, 250, 450):
                tensor = np.array([[[x, 110, x+100, 210, .9, 67]]], dtype=np.float32)
                monitor._check_objects(frame)
        self.assertEqual(events, [])

    def test_old_file_policy_permits_exact_path_and_targets_only_owner(self):
        monitor = WhitelistEnforcer.__new__(WhitelistEnforcer)
        monitor.session_id = 'file-check'
        monitor.SAFETY_LIST = set()
        monitor.protected_pids = set()
        monitor.violation_counts = {}
        approved = os.path.abspath('approved.docx')
        old = os.path.abspath('notes.docx')
        monitor.permitted_files = {os.path.normcase(os.path.realpath(approved))}
        events, closed = [], []
        monitor.on_violation_callback = events.append
        proc = SimpleNamespace(pid=123, name=lambda: 'winword.exe',
                               open_files=lambda: [SimpleNamespace(path=old)],
                               terminate=lambda: closed.append(123), wait=lambda **kw: None)
        with patch('whitelist_enforcer.capture_screenshot', return_value=None), \
             patch('whitelist_enforcer.psutil.process_iter', side_effect=AssertionError('Must not close other app instances')):
            monitor._handle_file_violation(proc, 'winword.exe', 'old approved file', approved)
            self.assertEqual(events, [])
            self.assertEqual(closed, [])
            monitor._handle_file_violation(proc, 'winword.exe', 'old unauthorized file', old)
            self.assertEqual(closed, [123])
            self.assertEqual(events[0]['details']['processId'], 123)
            monitor.violation_counts.clear()
            monitor._handle_file_violation(None, 'winword.exe', 'recent shortcut only', old)
            self.assertEqual(closed, [123])
            self.assertEqual(events[-1]['details']['action'], 'file_access_review_required')
        self.assertFalse(monitor._is_permitted_file(approved + '.other.docx'))

    def test_durable_python_delivery_retries_preserve_identity(self):
        from services.violation_delivery import enqueue, deliver_one
        import sqlite3
        payload = {'sessionId': 'check-session', 'type': 'head_turn_away',
                   'timestamp': '2026-10-03T00:00:00+00:00'}
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'pending.sqlite3')
            enqueue(payload, path)
            event_id = payload['eventId']
            enqueue(payload, path)
            with patch('services.violation_delivery.requests.post', side_effect=RuntimeError('lost ack')):
                with self.assertRaises(RuntimeError):
                    deliver_one('http://127.0.0.1/violation', path)
            connection = sqlite3.connect(path)
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM alerts').fetchone()[0], 1)
            connection.close()
            response = SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'status': 'accepted'})
            with patch('services.violation_delivery.requests.post', return_value=response) as post:
                self.assertTrue(deliver_one('http://127.0.0.1/violation', path))
                self.assertEqual(post.call_args.kwargs['json']['eventId'], event_id)
                self.assertEqual(post.call_args.kwargs['json']['timestamp'], payload['timestamp'])
            self.assertFalse(deliver_one('http://127.0.0.1/violation', path))

    def camera(self):
        # Use real initialization/model loading, but feed controlled frames/inference results.
        monitor = AIMonitor('check-session', on_violation=lambda event: None)
        if monitor.face_landmarker is not None:
            self.addCleanup(monitor.face_landmarker.close)
        self.assertIsNotNone(monitor.face_cascade)
        self.assertIsNotNone(monitor.ort_session)
        events = []
        monitor._emit_violation = lambda *args, **kwargs: events.append((args, kwargs))
        return monitor, events

    def test_calibration_wraparound_jitter_and_real_turn(self):
        monitor, events = self.camera()
        frame = np.full((480, 640, 3), 100, dtype=np.uint8)
        with patch('ai_monitor.time.monotonic', return_value=100):
            for i in range(20):
                monitor._observe_head_pose(8, 179 if i % 2 else -179, frame)
        self.assertIsNotNone(monitor.neutral_pose)
        for i in range(30):
            with patch('ai_monitor.time.monotonic', return_value=101 + i * .085):
                monitor._observe_head_pose(8 + (i % 3 - 1), 180, frame)
        self.assertEqual(events, [])
        for i in range(14):
            with patch('ai_monitor.time.monotonic', return_value=104 + i * .085):
                monitor._observe_head_pose(33, 180, frame)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0][1]['details']['direction'], 'left')

    def test_unstable_calibration_and_nonfinite_pose_do_not_alert(self):
        monitor, events = self.camera()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        for i in range(30):
            monitor._observe_head_pose(25 if i % 2 else -25, 0, frame)
        self.assertIsNone(monitor.neutral_pose)
        monitor._observe_head_pose(float('nan'), 0, frame)
        self.assertEqual(events, [])
        self.assertEqual(monitor.pose_baseline_samples, [])

    def test_direction_changes_and_downward_duration(self):
        monitor, events = self.camera()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        for stamp, direction in [(100, 'left'), (100.4, 'right'), (100.8, 'left'), (101, None),
                                 (102, 'down'), (102.9, 'down'), (103.9, 'down')]:
            with patch('ai_monitor.time.monotonic', return_value=stamp):
                monitor._track_head_direction(direction, frame, {})
        self.assertEqual(events, [])
        with patch('ai_monitor.time.monotonic', return_value=104.1):
            monitor._track_head_direction('down', frame, {})
        self.assertEqual(events[0][1]['details']['direction'], 'down')

    def test_real_landmarker_blank_frame_and_missing_model_fallback(self):
        monitor, events = self.camera()
        self.assertIsNotNone(monitor.face_landmarker)
        monitor._check_head_pose(np.full((480, 640, 3), 100, dtype=np.uint8))
        self.assertEqual(events, [])
        with patch('ai_monitor.os.path.exists', return_value=False):
            fallback = AIMonitor('fallback-check')
        self.assertIsNone(fallback.face_landmarker)
        self.assertIsNotNone(fallback.face_cascade)
        self.assertTrue(fallback.is_active)

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
            self.assertEqual(len(events), 1)
            monitor._check_objects(frame)
        self.assertEqual(events[0][0][0], 'cell_phone')
        monitor.exam_rules['detectCellPhone'] = False
        with patch('ai_monitor.time.monotonic', return_value=110):
            for _ in range(4):
                monitor._check_objects(frame)
        self.assertEqual(len(events), 1)

    def test_weak_phone_still_needs_three_hits_and_miss_resets_confirmation(self):
        monitor, events = self.camera()
        tensor = np.array([[[20, 110, 120, 210, .4, 67]]], dtype=np.float32)
        monitor.ort_session = SimpleNamespace(get_inputs=lambda: [SimpleNamespace(name='images')],
                                             run=lambda *a: [tensor])
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        with patch('ai_monitor.time.monotonic', return_value=100):
            monitor._check_objects(frame)
            monitor._check_objects(frame)
            self.assertEqual(events, [])
            monitor._check_objects(frame)
            self.assertEqual(len(events), 1)
        monitor._reset_temporal_state()
        events.clear()
        with patch('ai_monitor.time.monotonic', return_value=110):
            tensor[0, 0, 4] = .9
            monitor._check_objects(frame)
            tensor = np.empty((1, 0, 6), dtype=np.float32)
            monitor._check_objects(frame)
            tensor = np.array([[[20, 110, 120, 210, .9, 67]]], dtype=np.float32)
            monitor._check_objects(frame)
            self.assertEqual(events, [])
            tensor[0, 0, 4] = .4
            monitor._check_objects(frame)
            self.assertEqual(events, [])

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
        self.assertEqual(monitor.object_candidates, {})

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
