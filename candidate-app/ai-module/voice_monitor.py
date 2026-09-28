import os
import time
import json
import threading
import numpy as np
from datetime import datetime, timezone
from typing import Callable, Optional
import webrtcvad
import sounddevice as sd
from resemblyzer import VoiceEncoder, preprocess_wav
import io
import wave

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
            "consecutive_mismatches_threshold": 2
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

        # Initialize Resemblyzer VoiceEncoder on CPU
        try:
            print("[VoiceMonitor] Initializing Resemblyzer VoiceEncoder model...")
            self.encoder = VoiceEncoder(device="cpu")
            print("[VoiceMonitor] Resemblyzer VoiceEncoder loaded successfully.")
        except Exception as e:
            print(f"[VoiceMonitor Error] Could not load VoiceEncoder: {e}")
            self.encoder = None

        # Persistence directory for reference embeddings
        self.storage_dir = os.path.join(base_dir, "config", "voice_profiles")
        os.makedirs(self.storage_dir, exist_ok=True)
        self._load_persisted_reference()

    def _get_reference_path(self, session_id: Optional[str] = None) -> str:
        """Returns the file path for storing the session's reference embedding."""
        sid = session_id or self.session_id or "default"
        safe_session_id = "".join(c for c in str(sid) if c.isalnum() or c in ("-", "_"))
        if not safe_session_id:
            safe_session_id = "default"
        return os.path.join(self.storage_dir, f"voice_reference_{safe_session_id}.npy")

    def _load_persisted_reference(self):
        """Attempts to load a previously captured reference embedding from disk."""
        candidates = []
        if self.session_id and str(self.session_id).lower() not in ("unknown-session", "null", "undefined", "none"):
            candidates.append(self._get_reference_path(self.session_id))
        candidates.append(os.path.join(self.storage_dir, "voice_reference_latest.npy"))
        
        # Check specific candidates first
        for path in candidates:
            if os.path.exists(path):
                try:
                    self.reference_embedding = np.load(path)
                    print(f"[VoiceMonitor] Loaded reference voice embedding from: {path}")
                    return
                except Exception as e:
                    print(f"[VoiceMonitor Warning] Could not load persisted reference voice from {path}: {e}")

        # Fallback: load the most recently modified profile in storage_dir
        try:
            profile_files = [
                os.path.join(self.storage_dir, f) for f in os.listdir(self.storage_dir)
                if f.startswith("voice_reference_") and f.endswith(".npy")
            ]
            if profile_files:
                newest_file = max(profile_files, key=os.path.getmtime)
                self.reference_embedding = np.load(newest_file)
                print(f"[VoiceMonitor] Fallback: Loaded newest reference voice embedding from: {newest_file}")
        except Exception as e:
            print(f"[VoiceMonitor Warning] Fallback loading failed: {e}")

    def set_reference_voice(self, audio_data, session_id: Optional[str] = None) -> dict:
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
        if self.encoder is None:
            return {"success": False, "error": "VoiceEncoder not initialized"}

        if session_id and str(session_id).lower() not in ("null", "undefined", "none"):
            self.session_id = session_id

        try:
            wav_float = self._convert_to_float_wav(audio_data)
            if wav_float is None or len(wav_float) < self.sample_rate * 1.2:
                return {
                    "success": False,
                    "error": "Audio sample too short. Please speak clearly for at least 2-3 seconds."
                }

            processed = preprocess_wav(wav_float, source_sr=self.sample_rate)
            embedding = self.encoder.embed_utterance(processed)
            # Normalize embedding for fast cosine similarity via dot product
            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm

            self.reference_embedding = embedding
            
            # Persist to disk (both session-specific and latest fallback)
            ref_path = self._get_reference_path(self.session_id)
            latest_path = os.path.join(self.storage_dir, "voice_reference_latest.npy")
            np.save(ref_path, embedding)
            np.save(latest_path, embedding)
            print(f"[VoiceMonitor] Reference voice calibrated & saved to {ref_path} and {latest_path}")

            return {
                "success": True,
                "message": "Reference voice profile calibrated successfully",
                "embedding_dim": len(embedding)
            }
        except Exception as e:
            print(f"[VoiceMonitor Error] Failed to set reference voice: {e}")
            return {"success": False, "error": str(e)}

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
                            audio_np = np.frombuffer(frames, dtype=np.float32)

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
                    print(f"[VoiceMonitor] WAV parse fallback: {e}")

            # Treat as raw 16-bit 16kHz PCM
            return np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0

        return None

    def start(self):
        """Starts the background microphone audio stream and monitoring thread."""
        if self.running:
            return
        
        self.running = True
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        print("[VoiceMonitor] Two-Stage Voice Monitor started.")

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

    def _monitor_loop(self):
        """
        Main audio capture loop.
        Processes 30ms frames from microphone stream via sounddevice.
        """
        sustained_speech_frames = []
        consecutive_silent_frames = 0
        min_speech_frames = int(self.thresholds.get("vad_sustained_seconds", 2.0) / (self.frame_duration_ms / 1000.0))
        max_silent_gap_frames = int(0.4 / (self.frame_duration_ms / 1000.0))  # Allow 400ms pause between words

        try:
            # Test default input device availability
            default_input = sd.default.device[0]
            print(f"[VoiceMonitor] Opening audio input stream (Device ID: {default_input})...")
        except Exception as e:
            print(f"[VoiceMonitor Warning] No audio input device detected: {e}. Voice monitoring paused.")
            return

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
                        if not raw_frame or len(raw_frame) != self.frame_bytes:
                            time.sleep(0.01)
                            continue

                        # -------------------------------------------------------------
                        # STAGE 1: Lightweight VAD Gate (<1% CPU)
                        # -------------------------------------------------------------
                        is_speech = False
                        if self.vad is not None:
                            try:
                                is_speech = self.vad.is_speech(bytes(raw_frame), self.sample_rate)
                            except Exception:
                                is_speech = False

                        if is_speech:
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
                                    speech_count = len(sustained_speech_frames) - consecutive_silent_frames
                                    if speech_count >= min_speech_frames:
                                        # Stage 1 Gated In -> Trigger Stage 2
                                        audio_segment_bytes = b"".join(sustained_speech_frames)
                                        duration = len(audio_segment_bytes) / (self.sample_rate * 2)
                                        self._verify_speaker_segment(audio_segment_bytes, duration)
                                    else:
                                        # Brief sound (cough, click, single word) -> Discarded
                                        pass
                                    
                                    sustained_speech_frames = []
                                    consecutive_silent_frames = 0
                    except Exception as loop_err:
                        time.sleep(0.05)

        except Exception as stream_err:
            print(f"[VoiceMonitor Error] Microphone stream failed: {stream_err}")

    def _verify_speaker_segment(self, audio_bytes: bytes, duration: float):
        """
        STAGE 2: Speaker Verification (Runs ONLY when gated in by Stage 1).
        Extracts Resemblyzer embedding and tests similarity against student's reference.
        """
        if self.reference_embedding is None:
            print("[VoiceMonitor] Sustained speech detected, but no reference voice calibrated. Skipping comparison.")
            return

        if self.encoder is None:
            return

        try:
            # Convert raw 16-bit PCM bytes to float32 wav
            audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            wav = preprocess_wav(audio_np, source_sr=self.sample_rate)
            
            if len(wav) < self.sample_rate * 1.0:
                return

            embedding = self.encoder.embed_utterance(wav)
            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm

            # Cosine similarity
            similarity = float(np.dot(self.reference_embedding, embedding))
            similarity_thresh = float(self.thresholds.get("voice_similarity_threshold", 0.75))
            mismatch_thresh = int(self.thresholds.get("consecutive_mismatches_threshold", 2))

            print(f"[VoiceMonitor Stage 2] Sustained speech ({duration:.1f}s) analyzed: Similarity = {similarity:.3f} (Threshold = {similarity_thresh})")

            if similarity < similarity_thresh:
                self.mismatch_count += 1
                print(f"[VoiceMonitor Warning] Voice mismatch detected! Consecutive mismatch count: {self.mismatch_count}/{mismatch_thresh}")
                
                if self.mismatch_count >= mismatch_thresh:
                    # Fire second_voice_detected violation
                    self._emit_violation(
                        violation_type="second_voice_detected",
                        severity=3,
                        details={
                            "similarity_score": round(similarity, 2),
                            "duration_seconds": round(duration, 1),
                            "reason": "Unrecognized voice detected speaking for a sustained duration",
                            "consecutive_segments": self.mismatch_count
                        }
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
            print(f"[VoiceMonitor Error] Speaker verification failed: {e}")

    def _emit_violation(self, violation_type: str, severity: int, details: dict):
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
            "screenshotPath": screenshot_path
        }

        if self.on_violation:
            self.on_violation(event)
        else:
            print(json.dumps(event, indent=2))
