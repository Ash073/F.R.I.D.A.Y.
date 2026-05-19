import { useState, useEffect, useRef } from 'react';

export function useVoiceInput(isActive: boolean) {
  const [data, setData] = useState({ amplitude: 0, frequencies: new Uint8Array(0) });
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(null);

  useEffect(() => {
    if (isActive) {
      startListening();
    } else {
      stopListening();
    }
    return () => stopListening();
  }, [isActive]);

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 128; // Increased for smoother wavy mapping
      analyzerRef.current = analyzer;
      
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyzer);
      
      const bufferLength = analyzer.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const updateData = () => {
        if (!analyzerRef.current) return;
        analyzerRef.current.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        setData({ 
          amplitude: Math.min(avg / 128, 1), 
          frequencies: new Uint8Array(dataArray) 
        });
        
        animationRef.current = requestAnimationFrame(updateData);
      };
      
      updateData();
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  };

  const stopListening = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    setData({ amplitude: 0, frequencies: new Uint8Array(0) });
  };

  return data;
}
