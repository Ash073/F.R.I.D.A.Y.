"""
FRIDAY — Voice Isolation Whisper Pipeline (Persistent Daemon Edition)
Usage: python transcribe.py
Listens on stdin for audio file paths, transcribes them, and writes JSON to stdout.
"""
import sys
import os
import json
import warnings

warnings.filterwarnings("ignore")
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

INITIAL_PROMPT = (
    "Hey Friday, open Spotify, open WhatsApp, open Chrome, open Discord, "
    "open YouTube, open Instagram, open Telegram, open Settings, "
    "close Spotify, search for, play music, volume up, volume down, "
    "what is the time, what is the date, take a screenshot, "
    "shut down, restart, lock the screen"
)

def main():
    # ── LOAD WHISPER MODEL ONCE ON STARTUP ──
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel(
            "base",
            device="cpu",
            compute_type="int8",
            cpu_threads=4,
        )
        use_faster = True
    except ImportError:
        import whisper
        model = whisper.load_model("base")
        use_faster = False

    # Notify Node.js parent that the daemon is ready and primed
    print("READY", flush=True)

    # ── CONVERSATION LOOP ──
    for line in sys.stdin:
        audio_path = line.strip()
        if not audio_path:
            continue

        if not os.path.exists(audio_path):
            print(json.dumps({"text": "", "confidence": 0.0, "error": f"File not found: {audio_path}"}), flush=True)
            continue

        try:
            if use_faster:
                segments, info = model.transcribe(
                    audio_path,
                    language="en",
                    beam_size=3,
                    best_of=1,
                    initial_prompt=INITIAL_PROMPT,
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=300),
                    word_timestamps=True,
                )

                words = []
                all_text = []
                total_prob = 0.0
                word_count = 0

                for seg in segments:
                    all_text.append(seg.text.strip())
                    if seg.words:
                        for w in seg.words:
                            words.append({"word": w.word, "prob": round(w.probability, 3)})
                            total_prob += w.probability
                            word_count += 1

                text = " ".join(all_text).strip()
                confidence = round(total_prob / max(word_count, 1), 3)
            else:
                result = model.transcribe(
                    audio_path, language="en", fp16=False,
                    initial_prompt=INITIAL_PROMPT,
                )
                text = result["text"].strip()
                confidence = 1.0

            # Write transaction result back to stdout
            print(json.dumps({"text": text, "confidence": confidence}), flush=True)

        except Exception as e:
            print(json.dumps({"text": "", "confidence": 0.0, "error": str(e)}), flush=True)

if __name__ == "__main__":
    main()
