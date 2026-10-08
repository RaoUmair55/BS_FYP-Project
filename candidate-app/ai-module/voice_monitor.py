# IntegrityFlow file overview
# Purpose: Microphone speech and speaker-reference monitoring.
# How it works: Uses WebRTC VAD to select speech and Resemblyzer
# to compare normalized speaker vectors with the candidate reference
# using cosine similarity. Requires repeated valid mismatches before
# emitting a second-voice alert and saves the associated audio clip.
# Connection: Reference enrollment happens during online self-check;
# results are review signals, not proof of who spoke.
import os
import time
import json
import threading
import numpy as np
from datetime import datetime, timezone
from typing import Callable, Optional
import webrtcvad
import sounddevice as sd
import io
import wave
import queue

class VoiceMonitor:
    """
    Voice-Based Second-Person Detection Monitor.
    
    Operates as a two-stage pipeline:
    - STAGE 1 (VAD Gate): Runs continuously, processing short (30ms) audio frames via WebRTC VAD
      at 16kHz mono. Very lightweight (<1% CPU). Only triggers Stage 2 if sustained speech
      is detected for more than vad_sustained_seconds (default 2.0s).
    - STAGE 2 (Speaker Verification): Runs ONLY when gated in by Stage 1. Extracts a 256-d
      Resemblyzer speaker embedding and computes cosine similarity against the candidate's
      reference voice captured during self-check. Emits a 'second_voice_detected' violation
      if similarity is below voice_similarity_threshold for 2+ consecutive gated segments.
    """

    # Function purpose: Initializes this component’s configuration, state and dependencies.
    def __init__(
        self,
        session_id: str,
        on_violation: Optional[Callable] = None,
        on_violation_callback: Optional[Callable] = None,
        is_self_check: bool = False
    ):
        self.session_id = session_id
        self.on_violation = on_violation or on_violation_callback
        self.is_self_check = is_self_check
        self.running = False
        self.monitor_thread = None
        self.stream = None
        self.mismatch_count = 0
        self.last_verified_at = 0
        self.last_audio_at = 0
        self.verification_error = None
        self.capture_error = None
        self.last_alert_at = float("-inf")
        self.verification_queue = queue.Queue(maxsize=2)
        self.reference_embedding = None
        
        # Audio configuration (WebRTC VAD standard requirements)
        self.sample_rate = 16000  # 16kHz mono
        self.frame_duration_ms = 30  # 30ms frames
        self.frame_size = int(self.sample_rate * (self.frame_duration_ms / 1000.0))  # 480 samples
        self.frame_bytes = self.frame_size * 2  # 16-bit PCM = 960 bytes per frame

        # Load thresholds
        base_dir = os.path.dirname(os.path.abspath(__file__))
        config_path = os.path.join(base_dir, "config", "thresholds.json")
        self.thresholds = {
            "vad_sustained_seconds": 2.0,
            "voice_similarity_threshold": 0.75,
            "consecutive_mismatches_threshold": 2,
            "voice_alert_cooldown_seconds": 60,
            "voice_segment_seconds": 3.0,
            "voice_min_rms": 0.003
        }
        if os.path.exists(config_path):
            try:
                with open(config_path, "r") as f:
                    loaded = json.load(f)
                    self.thresholds.update({k: v for k, v in loaded.items() if k in self.thresholds})
            except Exception as e:
                print(f"[VoiceMonitor Warning] Failed to load thresholds: {e}")

        # Initialize WebRTC VAD (Mode 2: Aggressive speech filtering)
        try:
            self.vad = webrtcvad.Vad(2)
        except Exception as e:
            print(f"[VoiceMonitor Error] Could not initialize WebRTC VAD: {e}")
            self.vad = None

        # Resemblyzer VoiceEncoder initialized lazily / in background
        self.encoder = None
        self._encoder_lock = threading.Lock()
        threading.Thread(target=self._get_encoder, daemon=True).start()

        # Persistence directory for reference embeddings
        self.storage_dir = os.path.join(base_dir, "config", "voice_profiles")
        os.makedirs(self.storage_dir, exist_ok=True)
        self._load_persisted_reference()

    # Function purpose: Thread-safe lazy initializer for VoiceEncoder.
    def _get_encoder(self):
        """Thread-safe lazy initializer for VoiceEncoder."""
        if self.encoder is None:
            with self._encoder_lock:
                if self.encoder is None:
                    try:
                        print("[VoiceMonitor] Initializing Resemblyzer VoiceEncoder model...")
                        from resemblyzer import VoiceEncoder
                        self.encoder = VoiceEncoder(device="cpu")
                        print("[VoiceMonitor] Resemblyzer VoiceEncoder loaded successfully.")
                    except Exception as e:
                        print(f"[VoiceMonitor Error] Could not load VoiceEncoder: {e}")
                        self.encoder = None
        return self.encoder

    # Function purpose: Finds the persisted speaker-reference file for the current candidate session.
    def _get_reference_path(self, session_id: Optional[str] = None) -> str:
        """Returns the file path for storing the session's reference embedding."""
        sid = session_id or self.session_id or "default"
        safe_session_id = "".join(c for c in str(sid) if c.isalnum() or c in ("-", "_"))
        if not safe_session_id:
            safe_session_id = "default"
        return os.path.join(self.storage_dir, f"voice_reference_{safe_session_id}.npy")

    # Function purpose: Attempts to load a previously captured reference embedding from disk.
    def _load_persisted_reference(self):
        """Attempts to load a previously captured reference embedding from disk."""
        candidates = []
        if self.session_id and str(self.session_id).lower() not in ("unknown-session", "null", "undefined", "none"):
            candidates.append(self._get_reference_path(self.session_id))
        # A missing session profile must not silently reuse another candidate's voice.
        
        # Check specific candidates first
        for path in candidates:
            if os.path.exists(path):
                try:
                    embedding = np.load(path, allow_pickle=False)
                    norm = np.linalg.norm(embedding)
                    if embedding.shape != (256,) or not np.all(np.isfinite(embedding)) or norm <= 0:
                        raise ValueError('Invalid saved voice profile. Please re-record your voice.')
                    self.reference_embedding = embedding / norm
                    print(f"[VoiceMonitor] Loaded reference voice embedding from: {path}")
                    return
                except Exception as e:
                    print(f"[VoiceMonitor Warning] Could not load persisted reference voice from {path}: {e}")


    # Function purpose: Creates and stores the candidate's reference voice embedding from a 3-5 second sample.
    def set_reference_voice(self, audio_data, session_id: Optional[str] = None, confirmation_audio=None, microphone_label=None) -> dict:
        """
        Creates and stores the candidate's reference voice embedding from a 3-5 second sample.
        
        Args:
            audio_data: Can be:
              - numpy array of float32 or int16 samples
              - raw bytes (16kHz 16-bit PCM or WAV file bytes)
            session_id: Optional active session ID string
        Returns:
            dict with success status and embedding information.
        """
        encoder = self._get_encoder()
        if encoder is None:
            return {"success": False, "error": "VoiceEncoder not initialized"}

        if session_id and str(session_id).lower() not in ("null", "undefined", "none"):
            self.session_id = session_id

        try:
            from resemblyzer import preprocess_wav
            wav_float = self._convert_to_float_wav(audio_data)
            if wav_float is None or wav_float.ndim != 1 or not np.all(np.isfinite(wav_float)) or len(wav_float) < self.sample_rate * 1.2:
                return {
                    "success": False,
                    "error": "Audio sample too short. Please speak clearly for at least 2-3 seconds."
                }

            if np.mean(np.abs(wav_float) >= 0.99) > 0.01:
                return {"success": False, "error": "Microphone is clipping. Reduce input volume and retry."}
            if microphone_label:
                device_name = sd.query_devices(kind="input")["name"].casefold()
                browser_name = microphone_label.casefold().removeprefix("default - ").removeprefix("communications - ")
                if device_name not in browser_name and browser_name not in device_name:
                    return {"success": False, "error": "Calibration and monitoring microphones differ. Set the same default input in Windows and retry."}
            processed = preprocess_wav(wav_float, source_sr=self.sample_rate)
            if len(processed) < self.sample_rate * 3 or not np.all(np.isfinite(processed)):
                return {'success': False, 'error': 'Not enough clear speech. Re-record in a quiet room.'}
            embedding = encoder.embed_utterance(processed)
            # Normalize embedding for fast cosine similarity via dot product
            norm = np.linalg.norm(embedding)
            if not np.isfinite(norm) or norm <= 0 or not np.all(np.isfinite(embedding)):
                return {'success': False, 'error': 'Invalid voice sample. Please re-record.'}
            embedding = embedding / norm

            if confirmation_audio is None:
                return {"success": False, "error": "A separate confirmation recording is required."}
            confirm = self._convert_to_float_wav(confirmation_audio)
            if confirm is None or not np.all(np.isfinite(confirm)) or np.mean(np.abs(confirm) >= 0.99) > 0.01:
                return {"success": False, "error": "Invalid confirmation audio. Please retry."}
            confirm = preprocess_wav(confirm, source_sr=self.sample_rate)
            if len(confirm) < self.sample_rate * 2:
                return {"success": False, "error": "Please speak clearly throughout the confirmation recording."}
            check = encoder.embed_utterance(confirm)
            check_norm = np.linalg.norm(check)
            if not np.isfinite(check_norm) or check_norm <= 0 or not np.all(np.isfinite(check)):
                return {"success": False, "error": "Invalid confirmation voice. Please retry."}
            if float(np.dot(embedding, check / check_norm)) < self.thresholds["voice_similarity_threshold"]:
                return {"success": False, "error": "The two recordings do not match reliably. Use the same microphone and speak naturally in a quiet room."}
            ref_path = self._get_reference_path(self.session_id)
            temp_path = ref_path + '.tmp'
            with open(temp_path, 'wb') as handle:
                np.save(handle, embedding, allow_pickle=False)
            os.replace(temp_path, ref_path)
            self.reference_embedding = embedding
            self.mismatch_count = 0
            print(f"[VoiceMonitor] Reference voice calibrated & saved to {ref_path}")

            return {
                "success": True,
                "message": "Reference voice profile calibrated successfully",
                "embedding_dim": len(embedding)
            }
        except Exception as e:
            print(f"[VoiceMonitor Error] Failed to set reference voice: {e}")
            return {"success": False, "error": str(e)}

    # Function purpose: Converts diverse audio formats into a 16kHz float32 numpy array in [-1.0, 1.0].
    def _convert_to_float_wav(self, audio_data) -> Optional[np.ndarray]:
        """Converts diverse audio formats into a 16kHz float32 numpy array in [-1.0, 1.0]."""
        if isinstance(audio_data, np.ndarray):
            if audio_data.dtype == np.int16:
                return audio_data.astype(np.float32) / 32768.0
            return audio_data.astype(np.float32)

        if isinstance(audio_data, (bytes, bytearray)):
            # Check if it's a WAV container (starts with RIFF)
            if audio_data[:4] == b'RIFF':
                try:
                    with wave.open(io.BytesIO(audio_data), 'rb') as wf:
                        channels = wf.getnchannels()
                        sampwidth = wf.getsampwidth()
                        framerate = wf.getframerate()
                        frames = wf.readframes(wf.getnframes())

                        if sampwidth == 2:  # 16-bit
                            audio_np = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
                        elif sampwidth == 1:  # 8-bit
                            audio_np = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
                        else:
                            raise ValueError('Unsupported WAV bit depth. Use 16-bit PCM.')

                        if channels > 1:
                            audio_np = audio_np[::channels]  # Use first channel

                        # Resample if needed
                        if framerate != self.sample_rate and len(audio_np) > 0:
                            num_target = int(len(audio_np) * self.sample_rate / framerate)
                            audio_np = np.interp(
                                np.linspace(0, len(audio_np), num_target, endpoint=False),
                                np.arange(len(audio_np)),
                                audio_np
                            ).astype(np.float32)
                        return audio_np
                except Exception as e:
                    print(f"[VoiceMonitor] Invalid WAV: {e}")
                    return None

            # Treat as raw 16-bit 16kHz PCM
            return np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0

        return None

    # Function purpose: Starts the background microphone audio stream and monitoring thread.
    def start(self):
        """Starts the background microphone audio stream and monitoring thread."""
        if self.running:
            return
        
        self.running = True
        threading.Thread(target=self._verification_loop, daemon=True).start()
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        print("[VoiceMonitor] Two-Stage Voice Monitor started.")

    # Function purpose: Stops the audio monitoring loop and releases audio streams.
    def stop(self):
        """Stops the audio monitoring loop and releases audio streams."""
        self.running = False
        if self.stream is not None:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None
        print("[VoiceMonitor] Voice Monitor stopped.")

    # Function purpose: Repeatedly checks the monitored resource until this component is stopped.
    def _monitor_loop(self):
        while self.running:
            try:
                self._capture_loop()
            except Exception as exc:
                self.capture_error = f'Microphone capture failed; retrying: {exc}'
                self.mismatch_count = 0
                print(f'[VoiceMonitor Error] {self.capture_error}')
            if self.running:
                time.sleep(1)

    # Function purpose: Reads microphone frames, identifies sustained speech and queues usable segments for comparison.
    def _capture_loop(self):
        """
        Main audio capture loop.
        Processes 30ms frames from microphone stream via sounddevice.
        """
        sustained_speech_frames = []
        voiced_frame_count = 0
        consecutive_silent_frames = 0
        min_speech_frames = int(self.thresholds.get("vad_sustained_seconds", 2.0) / (self.frame_duration_ms / 1000.0))
        max_silent_gap_frames = int(0.4 / (self.frame_duration_ms / 1000.0))  # Allow 400ms pause between words

        try:
            # Test default input device availability
            default_input = sd.default.device[0]
            print(f"[VoiceMonitor] Opening audio input stream (Device ID: {default_input})...")
        except Exception as e:
            raise RuntimeError(f'No audio input device available: {e}') from e

        try:
            with sd.RawInputStream(
                samplerate=self.sample_rate,
                blocksize=self.frame_size,
                channels=1,
                dtype='int16'
            ) as stream:
                self.stream = stream
                while self.running:
                    try:
                        raw_frame, overflowed = stream.read(self.frame_size)
                        if overflowed:
                            sustained_speech_frames = []
                            voiced_frame_count = 0
                            consecutive_silent_frames = 0
                            self.mismatch_count = 0
                            continue  # Do not score a frame from an overflowed stream.
                        if not raw_frame or len(raw_frame) != self.frame_bytes:
                            raise RuntimeError('Microphone returned an incomplete audio frame')
                        self.last_audio_at = time.monotonic()
                        self.capture_error = None

                        # -------------------------------------------------------------
                        # STAGE 1: Lightweight VAD Gate (<1% CPU)
                        # -------------------------------------------------------------
                        is_speech = False
                        if self.vad is not None:
                            try:
                                is_speech = self.vad.is_speech(bytes(raw_frame), self.sample_rate)
                            except Exception as vad_error:
                                self.verification_error = f"Speech detection failed: {vad_error}"
                                is_speech = False

                        if is_speech:
                            voiced_frame_count += 1
                            sustained_speech_frames.append(bytes(raw_frame))
                            consecutive_silent_frames = 0
                        else:
                            if len(sustained_speech_frames) > 0:
                                consecutive_silent_frames += 1
                                # If silence is brief, keep collecting the phrase
                                if consecutive_silent_frames <= max_silent_gap_frames:
                                    sustained_speech_frames.append(bytes(raw_frame))
                                else:
                                    # Phrase ended. Check if speech sustained past threshold (> 2.0s)
                                    speech_count = voiced_frame_count
                                    if speech_count >= min_speech_frames:
                                        # Stage 1 Gated In -> Trigger Stage 2
                                        audio_segment_bytes = b"".join(sustained_speech_frames)
                                        duration = len(audio_segment_bytes) / (self.sample_rate * 2)
                                        self._queue_voice_segment(audio_segment_bytes, duration)
                                    else:
                                        # Brief sound (cough, click, single word) -> Discarded
                                        pass
                                    
                                    sustained_speech_frames = []
                                    voiced_frame_count = 0
                                    consecutive_silent_frames = 0
                        # Bound continuous speech as well as phrases that end in silence.
                        if len(sustained_speech_frames) >= int(self.thresholds.get("voice_segment_seconds", 3.0) * self.sample_rate / self.frame_size):
                            if voiced_frame_count >= min_speech_frames:
                                segment = b''.join(sustained_speech_frames)
                                self._queue_voice_segment(segment, len(segment) / (self.sample_rate * 2))
                            sustained_speech_frames = []
                            voiced_frame_count = 0
                            consecutive_silent_frames = 0
                    except Exception as loop_err:
                        raise RuntimeError(f'Audio read failed: {loop_err}') from loop_err

        except Exception as stream_err:
            raise RuntimeError(f'Microphone stream failed: {stream_err}') from stream_err
        finally:
            self.stream = None

    # Function purpose: Adds a speech segment to the bounded analysis queue.
    def _queue_voice_segment(self, audio, duration):
        try:
            self.verification_queue.put_nowait((audio, duration))
        except queue.Full:
            self.mismatch_count = 0
            self.verification_error = 'Voice analysis cannot keep up. Notify the examiner.'

    # Function purpose: Processes queued speech segments without blocking microphone capture.
    def _verification_loop(self):
        while self.running:
            try:
                audio, duration = self.verification_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                self._verify_speaker_segment(audio, duration)
            finally:
                self.verification_queue.task_done()

    # Function purpose: Saves suspicious audio speech segment as a WAV file for evidence review.
    def _save_audio_clip(self, audio_bytes: bytes) -> Optional[str]:
        """Saves suspicious audio speech segment as a WAV file for evidence review."""
        try:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            clips_dir = os.path.join(base_dir, "audio_evidence")
            os.makedirs(clips_dir, exist_ok=True)
            
            if not audio_bytes or len(audio_bytes) < self.sample_rate * 2 or len(audio_bytes) % 2:
                raise ValueError("Audio evidence is empty or too short")
            sid = self.session_id or "default"
            safe_sid = "".join(c for c in str(sid) if c.isalnum() or c in ("-", "_"))
            timestamp = int(time.time() * 1000)
            filename = f"voice_evidence_{safe_sid}_{timestamp}.wav"
            filepath = os.path.join(clips_dir, filename)
            
            with wave.open(filepath, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2) # 16-bit PCM
                wf.setframerate(self.sample_rate)
                wf.writeframes(audio_bytes)
                
            print(f"[VoiceMonitor] Audio evidence clip saved to: {filepath}")
            return filepath
        except Exception as e:
            print(f"[VoiceMonitor Warning] Could not save audio clip: {e}")
            return None

    # Function purpose: Compares usable speech with the candidate reference and requires repeated mismatches before an alert.
    def _verify_speaker_segment(self, audio_bytes: bytes, duration: float):
        """
        STAGE 2: Speaker Verification (Runs ONLY when gated in by Stage 1).
        Extracts Resemblyzer embedding and tests similarity against student's reference.
        """
        if self.is_self_check:
            return
        if self.reference_embedding is None:
            print("[VoiceMonitor] Sustained speech detected, but no reference voice calibrated. Skipping comparison.")
            return

        encoder = self._get_encoder()
        if encoder is None:
            return

        try:
            from resemblyzer import preprocess_wav
            # Convert raw 16-bit PCM bytes to float32 wav
            audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            if len(audio_np) < self.sample_rate or not np.all(np.isfinite(audio_np)) or float(np.sqrt(np.mean(audio_np ** 2))) < self.thresholds.get('voice_min_rms', 0.003):
                self.mismatch_count = 0
                return
            if np.mean(np.abs(audio_np) >= 0.99) > 0.01:
                self.mismatch_count = 0
                return  # Clipped speech cannot support a reliable speaker comparison.
            # The capture VAD can mistake steady background noise for speech.
            # Independently validate the complete raw segment before preprocessing
            # normalizes quiet noise and turns it into a misleading voice vector.
            if not self._has_clear_speech(audio_bytes):
                self.mismatch_count = 0
                return
            wav = preprocess_wav(audio_np, source_sr=self.sample_rate)
            
            if len(wav) < self.sample_rate * 1.0:
                self.mismatch_count = 0
                return

            embedding = encoder.embed_utterance(wav)
            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm

            if not np.isfinite(norm) or not np.all(np.isfinite(embedding)) or norm <= 0:
                self.mismatch_count = 0
                return
            now = time.monotonic()
            if now - self.last_verified_at > 60.0:
                self.mismatch_count = 0
            self.last_verified_at = now
            # Cosine similarity
            self.verification_error = None
            similarity = float(np.dot(self.reference_embedding, embedding))
            similarity_thresh = float(self.thresholds.get("voice_similarity_threshold", 0.75))
            mismatch_thresh = int(self.thresholds.get("consecutive_mismatches_threshold", 2))

            print(f"[VoiceMonitor Stage 2] Sustained speech ({duration:.1f}s) analyzed: Similarity = {similarity:.3f} (Threshold = {similarity_thresh})")

            if similarity < similarity_thresh:
                self.mismatch_count += 1
                print(f"[VoiceMonitor Warning] Voice mismatch detected! Consecutive mismatch count: {self.mismatch_count}/{mismatch_thresh}")
                
                if self.mismatch_count >= mismatch_thresh:
                    if now - getattr(self, "last_alert_at", float("-inf")) < self.thresholds.get("voice_alert_cooldown_seconds", 60):
                        self.mismatch_count = 0
                        return
                    # Save suspicious audio clip for evidence playback
                    audio_clip_path = self._save_audio_clip(audio_bytes)
                    if not audio_clip_path:
                        self.verification_error = "Voice evidence could not be saved. Notify the examiner."
                        self.mismatch_count = 0
                        return
                    self.last_alert_at = now
                    
                    # Fire second_voice_detected violation
                    self._emit_violation(
                        violation_type="second_voice_detected",
                        severity=3,
                        details={
                            "similarity_score": round(similarity, 2),
                            "duration_seconds": round(duration, 1),
                            "reason": "Possible unfamiliar speaker; examiner review required",
                            "consecutive_segments": self.mismatch_count,
                            "audioPath": audio_clip_path
                        },
                        audio_path=audio_clip_path
                    )
                    # Reset counter after firing
                    self.mismatch_count = 0
            else:
                # Student's own voice verified (talking to self or reading question)
                # Reset consecutive mismatch count
                if self.mismatch_count > 0:
                    print("[VoiceMonitor] Student reference voice matched. Resetting mismatch counter.")
                self.mismatch_count = 0

        except Exception as e:
            self.verification_error = "Speaker verification failed. Notify the examiner and retry the microphone check."
            self.mismatch_count = 0
            print(f"[VoiceMonitor Error] Speaker verification failed: {e}")

    # Function purpose: Rejects unsuitable or noisy audio before speaker comparison.
    def _has_clear_speech(self, audio_bytes):
        vad = webrtcvad.Vad(3)
        frame_bytes = int(self.sample_rate * 0.03) * 2
        frames = [audio_bytes[i:i + frame_bytes] for i in range(0, len(audio_bytes) - frame_bytes + 1, frame_bytes)]
        if not frames:
            return False
        voiced = sum(vad.is_speech(frame, self.sample_rate) for frame in frames)
        return (voiced * 0.03 >= self.thresholds.get('vad_sustained_seconds', 1.5) and
                voiced / len(frames) >= 0.6)

    # Function purpose: Constructs standard schema violation payload and emits to callback.
    def _emit_violation(self, violation_type: str, severity: int, details: dict, audio_path: Optional[str] = None):
        """Constructs standard schema violation payload and emits to callback."""
        screenshot_path = None
        try:
            from services.capture import capture_screenshot
            screenshot_path = capture_screenshot(self.session_id, violation_type)
        except Exception as e:
            print(f"[VoiceMonitor Warning] Could not capture screenshot: {e}")

        event = {
            "sessionId": self.session_id,
            "type": violation_type,
            "severity": severity,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "details": details,
            "screenshotPath": screenshot_path,
            "audioPath": audio_path
        }

        if self.on_violation:
            self.on_violation(event)
        else:
            print(json.dumps(event, indent=2))
