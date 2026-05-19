/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useMemo } from 'react';

interface ReactorCoreProps {
  state: 'idle' | 'listening' | 'processing' | 'speaking';
  amplitude: number; // 0 to 1
  frequencies?: Uint8Array;
  accentColor?: string;
}

export default function ReactorCore({ state, amplitude, frequencies, accentColor = '#ff8c00' }: ReactorCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const rotationRef = useRef({
    outer: 0,
    arcs: 0,
    middle: 0,
    inner: 0,
    sweep: 0,
    pulse: 0
  });

  // Animation constants based on state
  const settings = useMemo(() => {
    switch (state) {
      case 'listening':
        return { speed: 2, glow: 1.5, pulseSpeed: 0.1, color: accentColor };
      case 'processing':
        return { speed: 3, glow: 2, pulseSpeed: 0.2, color: '#1a8870' };
      case 'speaking':
        return { speed: 1.5, glow: 2, pulseSpeed: 0.15, color: accentColor };
      default:
        return { speed: 0.5, glow: 0.8, pulseSpeed: 0.05, color: accentColor + 'aa' };
    }
  }, [state, accentColor]);

  const draw = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const baseRadius = Math.min(width, height) * 0.35;
    
    ctx.clearRect(0, 0, width, height);

    // Dynamic scale for "speaking" or "listening"
    const reactiveScale = 1 + (state === 'speaking' || state === 'listening' ? amplitude * 0.05 : 0);
    const radius = baseRadius * reactiveScale;

    // 1. Outer Ring with Ticks
    ctx.strokeStyle = accentColor + '22';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 40, 0, Math.PI * 2);
    ctx.stroke();

    rotationRef.current.outer += 0.002 * settings.speed;
    const tickCount = 60;
    for (let i = 0; i < tickCount; i++) {
        const angle = (i / tickCount) * Math.PI * 2 + rotationRef.current.outer;
        const outerX1 = centerX + Math.cos(angle) * (radius + 35);
        const outerY1 = centerY + Math.sin(angle) * (radius + 35);
        const outerX2 = centerX + Math.cos(angle) * (radius + 45);
        const outerY2 = centerY + Math.sin(angle) * (radius + 45);
        
        ctx.strokeStyle = i % 5 === 0 ? accentColor + '88' : accentColor + '33';
        ctx.lineWidth = i % 5 === 0 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(outerX1, outerY1);
        ctx.lineTo(outerX2, outerY2);
        ctx.stroke();
    }

    // 2. Segmented Arc Band (24 segments) - REACTION TO WAVEFORM
    rotationRef.current.arcs += 0.005 * settings.speed;
    const segments = 24;
    const arcGap = 0.04;
    const arcLength = (Math.PI * 2) / segments - arcGap;
    
    for (let i = 0; i < segments; i++) {
        const startAngle = i * ((Math.PI * 2) / segments) + rotationRef.current.arcs;
        const endAngle = startAngle + arcLength;
        
        const isTeal = i === 4 || i === 16; // Teal accents
        const isThick = i % 2 === 0;

        // Symmetrical Waveform modulation
        let freqMod = 0;
        if (frequencies && frequencies.length > 0) {
            // Create a wavy distribution by mapping segments to frequency bins symmetrically
            // This creates a "center-out" or "mirrored" wave effect
            const mid = segments / 2;
            const distFromMid = Math.abs(i - mid);
            const normalizedDist = distFromMid / mid; // 0 at mid, 1 at ends
            
            // Focus on different parts of the frequency spectrum based on position
            const freqIdx = Math.floor(normalizedDist * (frequencies.length / 2));
            const rawFreq = frequencies[freqIdx];
            
            // Smooth the reaction and add a "wave" multiplier
            freqMod = (rawFreq / 255) * 40 * (1.2 - normalizedDist * 0.5);
        } else if (state === 'speaking' || state === 'listening') {
            freqMod = amplitude * 25;
        }

        ctx.strokeStyle = isTeal ? '#1a8870' : (isThick ? accentColor : accentColor + 'cc');
        ctx.lineWidth = (isThick ? 6 : 2) + (freqMod * 0.4);
        ctx.shadowBlur = isTeal || state !== 'idle' ? (10 + freqMod) * settings.glow : 0;
        ctx.shadowColor = ctx.strokeStyle;

        ctx.beginPath();
        // The radius itself now ripples
        const rippleRadius = radius + 20 + freqMod;
        ctx.arc(centerX, centerY, rippleRadius, startAngle, endAngle);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    // 3. Counter-rotating inner ring
    rotationRef.current.inner -= 0.008 * settings.speed;
    ctx.setLineDash([10, 20]);
    ctx.strokeStyle = accentColor + '66';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 10, rotationRef.current.inner, rotationRef.current.inner + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. Concentric Middle Rings with Sweep
    rotationRef.current.sweep += 0.02 * settings.speed;
    for (let i = 0; i < 3; i++) {
        const r = radius - 30 - i * 15;
        ctx.strokeStyle = accentColor + '22';
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();

        // Sweep marker
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, rotationRef.current.sweep, rotationRef.current.sweep + 0.5);
        ctx.stroke();
    }

    // 5. Energy Core and Pulsing Rings
    rotationRef.current.pulse += settings.pulseSpeed;
    const corePulse = Math.sin(rotationRef.current.pulse) * 5 + 5;
    
    // Core Background
    ctx.fillStyle = '#0d0000';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 80, 0, Math.PI * 2);
    ctx.fill();

    // Pulse Rings
    const pulseCount = 3;
    for (let i = 0; i < pulseCount; i++) {
        const pRadius = ((rotationRef.current.pulse * 20 + i * 40) % 100);
        const opacity = 1 - (pRadius / 100);
        ctx.strokeStyle = `rgba(255, 106, 0, ${opacity * 0.3})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(centerX, centerY, pRadius + 20, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Centered Detail Rings
    ctx.strokeStyle = accentColor + '44';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 30, 0, Math.PI * 2);
    ctx.stroke();
    
    // Micro Ticks
    for (let i = 0; i < 36; i++) {
        const angle = (i / 36) * Math.PI * 2 + rotationRef.current.pulse * 0.1;
        const x1 = centerX + Math.cos(angle) * 25;
        const y1 = centerY + Math.sin(angle) * 25;
        const x2 = centerX + Math.cos(angle) * 30;
        const y2 = centerY + Math.sin(angle) * 30;
        ctx.stroke();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
    }
    ctx.stroke();

    // Central Energy Glow
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 40 + corePulse);
    gradient.addColorStop(0, `rgba(255, 140, 0, ${0.4 * settings.glow})`);
    gradient.addColorStop(0.5, `rgba(255, 106, 0, ${0.1 * settings.glow})`);
    gradient.addColorStop(1, 'rgba(13, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 60, 0, Math.PI * 2);
    ctx.fill();
  };

  const animate = (time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    }

    draw(ctx, width, height, time);
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [state, amplitude, settings]);

  return (
    <canvas
      ref={canvasRef}
      id="reactor-canvas"
      className="w-full h-full absolute inset-0 z-0 opacity-80"
    />
  );
}
