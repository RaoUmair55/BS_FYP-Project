# IntegrityFlow file overview
# Purpose: Offline evaluation of speaker comparison on labelled WAV files.
# How it works: Creates a Resemblyzer vector from a reference recording,
# compares sample vectors using the configured similarity cutoff,
# and prints whether predictions match supplied labels.
# Connection: Used for measured threshold evaluation; 
# it records nothing and uploads nothing.
"""Score labelled local WAVs before tuning the speaker cutoff; no recording or upload.
python evaluate_voice.py --reference enrolled.wav --sample self.wav --speaker candidate --sample other.wav --speaker other
"""
import argparse
import json
from pathlib import Path
import wave
import numpy as np
from resemblyzer import VoiceEncoder, preprocess_wav


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', required=True)
    parser.add_argument('--sample', action='append', required=True)
    parser.add_argument('--speaker', choices=('candidate', 'other'), action='append', required=True)
    args = parser.parse_args()
    if len(args.sample) != len(args.speaker):
        parser.error('Supply one speaker label per sample.')
    thresholds = json.loads((Path(__file__).parent / 'config' / 'thresholds.json').read_text())
    cutoff = thresholds['voice_similarity_threshold']
    encoder = VoiceEncoder(device='cpu')
    def embed(path):
        with wave.open(path, 'rb') as clip:
            if clip.getsampwidth() != 2:
                raise ValueError('Use 16-bit PCM WAV recordings')
            rate, channels = clip.getframerate(), clip.getnchannels()
            pcm = np.frombuffer(clip.readframes(clip.getnframes()), dtype=np.int16).reshape(-1, channels)
        audio = pcm[:, 0].astype(np.float32) / 32768
        if not len(audio) or np.mean(np.abs(audio) >= .99) > .01:
            raise ValueError('Empty or clipped recording')
        if float(np.sqrt(np.mean(audio ** 2))) < thresholds.get('voice_min_rms', .003):
            raise ValueError('Recording too quiet')
        processed = preprocess_wav(audio, source_sr=rate)
        if len(processed) < 16000:
            raise ValueError('Less than one second of usable speech')
        vector = encoder.embed_utterance(processed)
        norm = np.linalg.norm(vector)
        if not np.isfinite(norm) or norm <= 0:
            raise ValueError('Invalid embedding')
        return vector / norm
    try:
        reference = embed(args.reference)
        for path, speaker in zip(args.sample, args.speaker):
            score = float(np.dot(reference, embed(path)))
            predicted = 'candidate' if score >= cutoff else 'other'
            print(json.dumps({'sample': Path(path).name, 'expected': speaker,
                'similarity': round(score, 4), 'cutoff': cutoff, 'matches_label': predicted == speaker}))
    except (ValueError, OSError, wave.Error) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    main()
