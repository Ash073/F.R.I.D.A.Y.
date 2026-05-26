import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { smartFetch } from '../hooks/useFridayVoicePipeline';

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

const SpotifyLogo = ({ size = 14, glow = false }: { size?: number; glow?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#1DB954"
    style={glow ? { filter: 'drop-shadow(0 0 4px rgba(29,185,84,0.6))' } : {}}>
    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.565.387-.86.207-2.377-1.454-5.37-1.783-8.893-.982-.336.075-.668-.135-.744-.47-.076-.336.135-.668.47-.743 3.856-.88 7.15-.506 9.822 1.13.295.178.387.563.207.858zm1.225-2.72c-.227.367-.707.487-1.074.26-2.72-1.672-6.87-2.157-10.075-1.183-.413.125-.847-.107-.972-.52-.125-.413.107-.847.52-.972 3.666-1.11 8.237-.574 11.34 1.33.368.228.488.708.26 1.076zm.107-2.833C14.384 8.78 8.567 8.587 5.2 9.61c-.547.165-1.12-.143-1.285-.69-.165-.547.143-1.12.69-1.285 3.864-1.173 10.288-.95 14.34 1.455.49.292.65.925.358 1.416-.29.49-.925.65-1.417.357z"/>
  </svg>
);

interface Props {
  spotifyState: any;
  widgetMode: 'hidden' | 'mini' | 'player' | 'expanded';
  accentColor: string;
  onMinimize: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onHide: () => void;
  onShow: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onPlayTrack: (uri: string) => void;
  onSearch: (q: string) => Promise<any[]>;
}

export default function SpotifyWidget({
  spotifyState, widgetMode, accentColor,
  onMinimize, onExpand, onCollapse, onHide, onShow,
  onTogglePlay, onNext, onPrev, onPlayTrack, onSearch
}: Props) {
  const widgetRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<number | null>(null);

  // Click outside → minimize (player→mini) or collapse (expanded→player)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
        if (widgetMode === 'expanded') onCollapse();
        else if (widgetMode === 'player') onMinimize();
      }
    };
    if (widgetMode === 'player' || widgetMode === 'expanded') {
      document.addEventListener('mousedown', handler);
    }
    return () => document.removeEventListener('mousedown', handler);
  }, [widgetMode, onCollapse, onMinimize]);

  // Debounced search
  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) { setSearchResults([]); return; }
    searchTimeout.current = window.setTimeout(async () => {
      setSearching(true);
      const results = await onSearch(q);
      setSearchResults(results || []);
      setSearching(false);
    }, 500);
  }, [onSearch]);

  const ac = accentColor;

  return (
    <>
      {/* ── MINI FLOATING BUTTON ── */}
      <AnimatePresence>
        {widgetMode === 'mini' && (
          <motion.button
            key="mini-btn"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            onClick={onShow}
            className="fixed bottom-5 right-5 z-[70] w-11 h-11 rounded-full flex items-center justify-center cursor-pointer"
            style={{
              background: 'rgba(0,0,0,0.85)',
              border: `1px solid ${ac}33`,
              boxShadow: `0 0 20px ${ac}15, 0 4px 12px rgba(0,0,0,0.5)`
            }}
          >
            <SpotifyLogo size={18} glow />
            {spotifyState.isPlaying && (
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{ border: `2px solid ${ac}44` }}
                animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── PLAYER / EXPANDED WIDGET ── */}
      <AnimatePresence>
        {(widgetMode === 'player' || widgetMode === 'expanded') && (
          <motion.div
            ref={widgetRef}
            key="spotify-widget"
            initial={{ opacity: 0, y: 60, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.85, transition: { duration: 0.25 } }}
            transition={{ type: 'spring', stiffness: 80, damping: 18 }}
            className="fixed bottom-5 right-5 z-[70] font-mono select-none pointer-events-auto"
            style={{ width: widgetMode === 'expanded' ? 360 : 320 }}
          >
            <div className="relative rounded-2xl overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(0,0,0,0.94), rgba(13,0,0,0.97))',
                boxShadow: `0 0 40px ${ac}15, 0 8px 32px rgba(0,0,0,0.6)`,
              }}>
              {/* Top glow sweep */}
              <div className="absolute top-0 left-0 right-0 h-[1px] overflow-hidden">
                <motion.div className="h-full w-[60%]"
                  style={{ background: `linear-gradient(90deg, transparent, ${ac}, transparent)` }}
                  animate={{ x: ['-60%', '160%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }} />
              </div>
              <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ border: `1px solid ${ac}20` }} />

              <div className="p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <SpotifyLogo glow />
                    <span className="text-[8px] font-bold tracking-[0.25em] uppercase" style={{ color: ac }}>Audio Deck</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {spotifyState.isPlaying && (
                      <div className="flex items-center gap-1.5">
                        <motion.div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#1DB954' }}
                          animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
                        <span className="text-[7px] tracking-[0.15em]" style={{ color: '#1DB954' }}>LIVE</span>
                      </div>
                    )}
                    {/* Minimize button */}
                    <button onClick={onMinimize} className="p-1 rounded hover:bg-white/5 cursor-pointer transition-colors" style={{ color: ac + '66' }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/></svg>
                    </button>
                  </div>
                </div>

                {/* Track Info + Art */}
                <div className="flex items-center gap-3 mb-3 cursor-pointer" onClick={() => widgetMode === 'player' ? onExpand() : onCollapse()}>
                  {spotifyState.albumArt ? (
                    <motion.div className="relative flex-shrink-0"
                      animate={spotifyState.isPlaying ? { rotate: [0, 360] } : { rotate: 0 }}
                      transition={spotifyState.isPlaying ? { duration: 20, repeat: Infinity, ease: 'linear' } : { duration: 0.3 }}>
                      <img src={spotifyState.albumArt} alt="" className="w-14 h-14 object-cover rounded-lg"
                        style={{ boxShadow: `0 0 20px ${ac}22`, border: `1px solid ${ac}25` }} />
                      <div className="absolute inset-0 rounded-lg flex items-center justify-center pointer-events-none">
                        <div className="w-3 h-3 rounded-full bg-black/60 border" style={{ borderColor: ac + '33' }} />
                      </div>
                    </motion.div>
                  ) : (
                    <div className="w-14 h-14 rounded-lg flex items-center justify-center" style={{ backgroundColor: ac + '0d', border: `1px solid ${ac}22` }}>
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke={ac + '66'} strokeWidth="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-[11px] font-bold tracking-wide truncate" style={{ textShadow: `0 0 10px ${ac}33` }}>
                      {spotifyState.trackName || 'No track'}
                    </div>
                    <div className="text-[9px] font-medium truncate" style={{ color: ac + 'aa' }}>
                      {spotifyState.artistName || 'Play a song to get started'}
                    </div>
                    {widgetMode === 'player' && (
                      <div className="text-[7px] mt-1 opacity-40" style={{ color: ac }}>Tap to expand</div>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="relative mb-3">
                  <div className="flex justify-between text-[7px] mb-1 opacity-40" style={{ color: ac }}>
                    <span>{formatTime(spotifyState.position)}</span>
                    <span>{formatTime(spotifyState.duration)}</span>
                  </div>
                  <div className="w-full h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: ac + '11' }}>
                    <div className="h-full rounded-full relative transition-all duration-1000 ease-linear"
                      style={{ backgroundColor: ac, width: `${(spotifyState.position / (spotifyState.duration || 1)) * 100}%` }}>
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
                        style={{ backgroundColor: ac, boxShadow: `0 0 6px ${ac}` }} />
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex justify-center items-center gap-5 mb-1">
                  <button onClick={onPrev} className="p-2 rounded-lg hover:bg-white/5 active:scale-90 cursor-pointer transition-all" style={{ color: ac + 'cc' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z"/></svg>
                  </button>
                  <button onClick={onTogglePlay} className="p-3 rounded-xl hover:scale-105 active:scale-95 cursor-pointer transition-all"
                    style={{ backgroundColor: ac + '18', border: `1px solid ${ac}33`, color: ac }}>
                    {spotifyState.isPlaying
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                      : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5z"/></svg>}
                  </button>
                  <button onClick={onNext} className="p-2 rounded-lg hover:bg-white/5 active:scale-90 cursor-pointer transition-all" style={{ color: ac + 'cc' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm8.5 0h2V6h-2v12z"/></svg>
                  </button>
                </div>

                {/* ── EXPANDED: Search & Results ── */}
                <AnimatePresence>
                  {widgetMode === 'expanded' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t pt-3 mt-2" style={{ borderColor: ac + '15' }}>
                        {/* Search bar */}
                        <div className="relative mb-3">
                          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3" viewBox="0 0 24 24" fill="none"
                            stroke={ac + '66'} strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                          <input
                            type="text"
                            placeholder="Search Spotify..."
                            value={searchQuery}
                            onChange={e => handleSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-2 rounded-lg text-[10px] outline-none"
                            style={{
                              backgroundColor: ac + '08',
                              border: `1px solid ${ac}22`,
                              color: 'white',
                              fontFamily: 'monospace',
                            }}
                          />
                        </div>

                        {/* Results */}
                        <div className="max-h-[180px] overflow-y-auto space-y-1 pr-1" style={{ scrollbarWidth: 'thin', scrollbarColor: `${ac}33 transparent` }}>
                          {searching && (
                            <div className="text-center py-3">
                              <motion.div className="w-4 h-4 mx-auto rounded-full border-2 border-t-transparent"
                                style={{ borderColor: `${ac}55`, borderTopColor: 'transparent' }}
                                animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} />
                            </div>
                          )}
                          {!searching && searchResults.length === 0 && searchQuery && (
                            <div className="text-center text-[9px] py-4 opacity-40" style={{ color: ac }}>No results found</div>
                          )}
                          {!searching && searchResults.map((track: any, i: number) => (
                            <motion.button
                              key={track.uri || i}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.05 }}
                              onClick={() => { onPlayTrack(track.uri); setSearchQuery(''); setSearchResults([]); onCollapse(); }}
                              className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-all text-left"
                              style={{ border: 'none', background: 'transparent' }}
                            >
                              {track.albumArt ? (
                                <img src={track.albumArt} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0"
                                  style={{ border: `1px solid ${ac}15` }} />
                              ) : (
                                <div className="w-9 h-9 rounded flex-shrink-0" style={{ backgroundColor: ac + '0d' }} />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-white text-[10px] font-semibold truncate">{track.name}</div>
                                <div className="text-[8px] truncate" style={{ color: ac + '88' }}>{track.artist}</div>
                              </div>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill={ac + '55'}><path d="M8 5v14l11-7L8 5z"/></svg>
                            </motion.button>
                          ))}
                          {!searching && !searchQuery && (
                            <div className="text-center text-[8px] py-4 opacity-30" style={{ color: ac }}>
                              Search for songs, artists, or albums
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Footer */}
                <div className="flex items-center justify-center gap-2 mt-3">
                  <span className="w-6 h-[1px]" style={{ backgroundColor: ac + '15' }} />
                  <span className="text-[6px] font-bold tracking-[0.3em] uppercase" style={{ color: ac + '30' }}>F.R.I.D.A.Y. AUDIO DECK</span>
                  <span className="w-6 h-[1px]" style={{ backgroundColor: ac + '15' }} />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
