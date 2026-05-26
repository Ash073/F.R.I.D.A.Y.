# c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\backend\transcribe.py
import sys
import os
import json
import argparse
import warnings

# Suppress standard Python warnings to keep streams clean
warnings.filterwarnings("ignore")

try:
    import whisper
except ImportError:
    print("[FRIDAY WHISPER ERROR] whisper is not installed. Run: pip install openai-whisper", file=sys.stderr)
    sys.exit(1)

# Global models cache to prevent reloading overhead
models = {}

def get_model(name):
    """
    Retrieves or loads the specified Whisper model size in RAM.
    """
    if name not in models:
        print(f"[FRIDAY WHISPER] Loading Whisper model '{name}' in RAM...", file=sys.stderr)
        models[name] = whisper.load_model(name)
        print(f"[FRIDAY WHISPER] Whisper model '{name}' loaded successfully.", file=sys.stderr)
    return models[name]

def transcribe(audio_path, mode='command'):
    """
    Executes raw local Whisper STT inference.
    - wake mode: uses Whisper 'tiny' (fast, english-only).
    - command mode: uses Whisper 'base' (accurate, confidence calculation).
    """
    model_name = 'tiny' if mode == 'wake' else 'base'
    model = get_model(model_name)
    
    options = {}
    if mode == 'wake':
        options['language'] = 'en'
        options['suppress_tokens'] = []
    
    result = model.transcribe(audio_path, **options)
    text = result.get('text', '').strip()
    
    if mode == 'wake':
        return text
    else:
        # Calculate pseudo-confidence based on logarithmic probability averages
        confidence = 1.0
        segments = result.get('segments', [])
        if segments:
            import math
            logprobs = [seg.get('avg_logprob', 0) for seg in segments]
            # Convert logarithmic probability to range [0.0, 1.0]
            probs = [math.exp(max(min(lp, 0), -3.0)) for lp in logprobs]
            confidence = sum(probs) / len(probs) if probs else 1.0
            
        return {
            "text": text,
            "confidence": round(confidence, 2)
        }

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="F.R.I.D.A.Y. Whisper STT Bridge Service")
    parser.add_argument('--mode', type=str, default='command', choices=['command', 'wake'], help="Transcribe mode")
    parser.add_argument('--audio', type=str, default=None, help="Direct audio file path to transcribe")
    parser.add_argument('--serve', action='store_true', help="Boot Flask HTTP Service API daemon")
    parser.add_argument('--port', type=int, default=5002, help="Flask server bind port")
    
    args = parser.parse_args()

    if args.serve:
        # Flask Server Mode
        try:
            from flask import Flask, request, jsonify
            import threading
        except ImportError:
            print("[FRIDAY WHISPER ERROR] Flask is required for HTTP service. Run: pip install flask", file=sys.stderr)
            sys.exit(1)
            
        app = Flask(__name__)
        
        # Eagerly load both tiny and base models to RAM for immediate real-time execution
        print("[FRIDAY WHISPER] Eagerly warming up models...", file=sys.stderr)
        get_model('tiny')
        get_model('base')
        print("[FRIDAY WHISPER] Models successfully warmed.", file=sys.stderr)
        
        @app.route('/health', methods=['GET'])
        def health():
            return jsonify({
                "status": "ok",
                "model": "tiny/base",
                "loaded_models": list(models.keys())
            })
            
        @app.route('/transcribe', methods=['POST'])
        def api_transcribe():
            mode = 'command'
            audio_path = None
            
            # Read arguments from multipart form or JSON body
            if request.is_json:
                mode = request.json.get('mode', 'command')
                audio_path = request.json.get('audioPath')
            else:
                mode = request.form.get('mode', 'command')
                audio_path = request.form.get('audioPath')
                
            # If an audio blob was uploaded directly
            if 'audio' in request.files:
                uploaded_file = request.files['audio']
                temp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'temp')
                if not os.path.exists(temp_dir):
                    os.makedirs(temp_dir)
                
                temp_path = os.path.join(temp_dir, f'uploaded_{mode}_temp.wav')
                uploaded_file.save(temp_path)
                audio_path = temp_path
                
            if not audio_path or not os.path.exists(audio_path):
                return jsonify({"error": "Audio file target not found or path was invalid"}), 400
                
            try:
                res = transcribe(audio_path, mode)
                
                # Automatically delete file if uploaded
                if 'audio' in request.files and os.path.exists(audio_path):
                    try:
                        os.remove(audio_path)
                    except Exception:
                        pass
                        
                if isinstance(res, dict):
                    return jsonify(res)
                else:
                    return jsonify({"transcript": res})
            except Exception as e:
                return jsonify({"error": str(e)}), 500
                
        # Start Flask server in a background thread so the main thread can handle stdin paths
        def run_flask():
            app.run(port=args.port, host='0.0.0.0', debug=False, use_reloader=False)
            
        flask_thread = threading.Thread(target=run_flask)
        flask_thread.daemon = True
        flask_thread.start()
        
        print("READY", flush=True) # Announce readiness to Node parent process
        
        # Stdin/Stdout loop in the main thread for backward compatibility / seamless integration!
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                audio_path = line.strip()
                if audio_path:
                    if os.path.exists(audio_path):
                        res = transcribe(audio_path, 'command')
                        print(json.dumps(res), flush=True)
                    else:
                        print(json.dumps({"text": "", "confidence": 0.0, "error": f"file not found at {audio_path}"}), flush=True)
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(json.dumps({"text": "", "confidence": 0.0, "error": str(e)}), flush=True)

    elif args.audio:
        # CLI direct single file run mode
        if not os.path.exists(args.audio):
            print(f"Error: Target file {args.audio} was not found.", file=sys.stderr)
            sys.exit(1)
        res = transcribe(args.audio, args.mode)
        if isinstance(res, dict):
            print(json.dumps(res))
        else:
            print(res)

    else:
        # Stdin/Stdout Persistent Daemon mode
        # Eagerly load base model for legacy compatibility
        get_model('base')
        print("READY", flush=True) # Let Node.js parent know the daemon is fully loaded in memory
        
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                audio_path = line.strip()
                if audio_path:
                    if os.path.exists(audio_path):
                        res = transcribe(audio_path, 'command')
                        print(json.dumps(res), flush=True)
                    else:
                        print(json.dumps({"text": "", "confidence": 0.0, "error": f"file not found at {audio_path}"}), flush=True)
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(json.dumps({"text": "", "confidence": 0.0, "error": str(e)}), flush=True)
