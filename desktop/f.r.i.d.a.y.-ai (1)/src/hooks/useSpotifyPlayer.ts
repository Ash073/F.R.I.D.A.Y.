import { useState, useEffect, useRef, useCallback } from 'react';
import { smartFetch, getBackendBaseUrl } from './useFridayVoicePipeline';

export interface SpotifyState {
  active: boolean;
  trackName: string;
  artistName: string;
  albumArt: string;
  isPlaying: boolean;
  position: number;
  duration: number;
}

export function useSpotifyPlayer() {
  const [state, setState] = useState<SpotifyState>({
    active: false,
    trackName: '',
    artistName: '',
    albumArt: '',
    isPlaying: false,
    position: 0,
    duration: 0,
  });

  // Widget visibility states: 'hidden' | 'mini' | 'player' | 'expanded'
  const [widgetMode, setWidgetMode] = useState<'hidden' | 'mini' | 'player' | 'expanded'>('hidden');

  const playerRef = useRef<any>(null);
  const progressIntervalRef = useRef<number | null>(null);
  const retryIntervalRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const sdkConnectedRef = useRef(false);
  const sdkIsActiveSourceRef = useRef(false);

  // Smart-routing local/cloud re-auth trigger
  const triggerAuth = useCallback(async () => {
    try {
      const baseUrl = await getBackendBaseUrl();
      const loginUrl = `${baseUrl}/spotify/login`;
      console.log('[FRIDAY Spotify Player] Launching Spotify authentication...', loginUrl);
      if ((window as any).friday?.openExternal) {
        (window as any).friday.openExternal(loginUrl);
      } else {
        window.open(loginUrl, '_blank');
      }
    } catch (err) {
      console.error('[FRIDAY Spotify] triggerAuth failed:', err);
    }
  }, []);

  // Fetch a fresh token from the backend
  const fetchToken = useCallback(async (): Promise<string | null> => {
    try {
      const tokenRes = await smartFetch('/spotify/token');
      if (!tokenRes.ok) return null;
      const tokenData = await tokenRes.json();
      return tokenData.token || null;
    } catch {
      return null;
    }
  }, []);

  // Sync state helper (from SDK events)
  const updatePlayerState = useCallback((playbackState: any) => {
    if (!playbackState) {
      sdkIsActiveSourceRef.current = false;
      setState(prev => ({ ...prev, active: false, isPlaying: false }));
      return;
    }

    const currentTrack = playbackState.track_window?.current_track;
    if (!currentTrack) {
      sdkIsActiveSourceRef.current = false;
      setState(prev => ({ ...prev, active: false, isPlaying: false }));
      return;
    }

    sdkIsActiveSourceRef.current = true;
    setState({
      active: true,
      trackName: currentTrack.name,
      artistName: currentTrack.artists.map((a: any) => a.name).join(', '),
      albumArt: currentTrack.album.images[0]?.url || '',
      isPlaying: !playbackState.paused,
      position: playbackState.position,
      duration: playbackState.duration,
    });
  }, []);

  // Poll current track from backend (only when widget is visible)
  const pollCurrentTrack = useCallback(async () => {
    if (sdkIsActiveSourceRef.current) return;
    try {
      const res = await smartFetch('/spotify/current');
      if (!res.ok) return;
      const data = await res.json();

      if (data.trackName) {
        setState(prev => ({
          active: true,
          trackName: data.trackName,
          artistName: data.artistName || '',
          albumArt: data.albumArt || prev.albumArt || '',
          isPlaying: data.playing ?? false,
          position: data.progress_ms ?? prev.position,
          duration: data.duration_ms ?? prev.duration,
        }));
      } else {
        setState(prev => ({ ...prev, isPlaying: false }));
      }
    } catch { /* ignore */ }
  }, []);

  // Show the widget (called when a play command is triggered)
  const showWidget = useCallback(() => {
    setWidgetMode('player');
    // Start polling to keep track info updated
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    // Immediate poll
    setTimeout(pollCurrentTrack, 1500);
    pollIntervalRef.current = window.setInterval(pollCurrentTrack, 5000);
  }, [pollCurrentTrack]);

  // Hide the widget completely
  const hideWidget = useCallback(() => {
    setWidgetMode('hidden');
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Minimize to floating icon
  const minimizeWidget = useCallback(() => {
    setWidgetMode('mini');
  }, []);

  // Expand to full interface
  const expandWidget = useCallback(() => {
    setWidgetMode('expanded');
  }, []);

  // Collapse back to player view
  const collapseWidget = useCallback(() => {
    setWidgetMode('player');
  }, []);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Auto-hide when music stops for > 10 seconds
  useEffect(() => {
    if (!state.isPlaying && widgetMode === 'player') {
      const timeout = setTimeout(() => {
        if (!state.isPlaying) {
          minimizeWidget();
        }
      }, 15000);
      return () => clearTimeout(timeout);
    }
  }, [state.isPlaying, widgetMode, minimizeWidget]);

  // Initialize the Spotify SDK player
  const initializePlayer = useCallback(async () => {
    if (sdkConnectedRef.current) return;

    try {
      const token = await fetchToken();
      if (!token) {
        console.warn('[FRIDAY Spotify SDK] No token available. Will retry...');
        return false;
      }

      if (!(window as any).Spotify?.Player) {
        console.warn('[FRIDAY Spotify SDK] SDK not loaded yet.');
        return false;
      }

      const player = new (window as any).Spotify.Player({
        name: 'F.R.I.D.A.Y. Player',
        getOAuthToken: async (cb: any) => {
          const freshToken = await fetchToken();
          if (freshToken) cb(freshToken);
        },
        volume: 0.7,
      });

      playerRef.current = player;
      (window as any).fridayPlayer = player;

      player.addListener('ready', ({ device_id }: any) => {
        console.log('[FRIDAY Spotify SDK] Ready with Device ID:', device_id);
        (window as any).fridayDeviceId = device_id;
        sdkConnectedRef.current = true;
        if (retryIntervalRef.current) {
          clearInterval(retryIntervalRef.current);
          retryIntervalRef.current = null;
        }
      });

      player.addListener('not_ready', () => {
        sdkIsActiveSourceRef.current = false;
      });

      player.addListener('player_state_changed', (playbackState: any) => {
        updatePlayerState(playbackState);
        // Auto-show widget when playback starts through SDK
        if (playbackState && !playbackState.paused && widgetMode === 'hidden') {
          showWidget();
        }
      });

      player.addListener('initialization_error', ({ message }: any) => {
        console.error('[FRIDAY Spotify SDK] Initialization Error:', message);
      });

      player.addListener('authentication_error', ({ message }: any) => {
        console.error('[FRIDAY Spotify SDK] Authentication Error:', message);
        sdkConnectedRef.current = false;
      });

      player.addListener('account_error', ({ message }: any) => {
        console.error('[FRIDAY Spotify SDK] Premium Account required:', message);
      });

      await player.connect();
      return true;
    } catch (err) {
      console.error('[FRIDAY Spotify SDK] Error during SDK startup:', err);
      return false;
    }
  }, [fetchToken, updatePlayerState, showWidget, widgetMode]);

  // Initialize SDK
  useEffect(() => {
    if (!document.getElementById('spotify-player-sdk')) {
      const script = document.createElement('script');
      script.id = 'spotify-player-sdk';
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      document.body.appendChild(script);
    }

    (window as any).onSpotifyWebPlaybackSDKReady = async () => {
      console.log('[FRIDAY Spotify SDK] Loading native Web Playback...');
      const success = await initializePlayer();
      if (!success) {
        retryIntervalRef.current = window.setInterval(async () => {
          if (sdkConnectedRef.current) {
            if (retryIntervalRef.current) clearInterval(retryIntervalRef.current);
            return;
          }
          const retrySuccess = await initializePlayer();
          if (retrySuccess && retryIntervalRef.current) {
            clearInterval(retryIntervalRef.current);
            retryIntervalRef.current = null;
          }
        }, 30000);
      }
    };

    if ((window as any).Spotify?.Player) {
      (window as any).onSpotifyWebPlaybackSDKReady();
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.disconnect();
        sdkConnectedRef.current = false;
      }
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (retryIntervalRef.current) clearInterval(retryIntervalRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [initializePlayer]);

  // Progress tick
  useEffect(() => {
    if (state.isPlaying) {
      progressIntervalRef.current = window.setInterval(() => {
        setState(prev => {
          if (!prev.isPlaying || prev.position >= prev.duration) return prev;
          return { ...prev, position: prev.position + 1000 };
        });
      }, 1000);
    } else {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [state.isPlaying]);

  // Controls
  const togglePlay = useCallback(async () => {
    if (sdkIsActiveSourceRef.current && playerRef.current) {
      await playerRef.current.togglePlay();
    } else {
      try {
        if (state.isPlaying) {
          const res = await smartFetch('/spotify/pause', { method: 'POST' });
          if (res.status === 401) {
            await triggerAuth();
            return;
          }
          setState(prev => ({ ...prev, isPlaying: false }));
        } else {
          const res = await smartFetch('/spotify/play', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          if (res.status === 401) {
            await triggerAuth();
            return;
          }
          setState(prev => ({ ...prev, isPlaying: true }));
        }
      } catch (err) {
        console.error('[FRIDAY Spotify] Toggle play failed:', err);
      }
    }
  }, [state.isPlaying, triggerAuth]);

  const nextTrack = useCallback(async () => {
    if (sdkIsActiveSourceRef.current && playerRef.current) {
      await playerRef.current.nextTrack();
    } else {
      try {
        const res = await smartFetch('/spotify/next', { method: 'POST' });
        if (res.status === 401) {
          await triggerAuth();
          return;
        }
        setTimeout(pollCurrentTrack, 1000);
      } catch (err) {
        console.error('[FRIDAY Spotify] Next track failed:', err);
      }
    }
  }, [pollCurrentTrack, triggerAuth]);

  const previousTrack = useCallback(async () => {
    if (sdkIsActiveSourceRef.current && playerRef.current) {
      await playerRef.current.previousTrack();
    } else {
      try {
        const res = await smartFetch('/spotify/previous', { method: 'POST' });
        if (res.status === 401) {
          await triggerAuth();
          return;
        }
        setTimeout(pollCurrentTrack, 1000);
      } catch (err) {
        console.error('[FRIDAY Spotify] Previous track failed:', err);
      }
    }
  }, [pollCurrentTrack, triggerAuth]);

  // Search Spotify
  const searchTracks = useCallback(async (query: string) => {
    try {
      const res = await smartFetch(`/spotify/search?q=${encodeURIComponent(query)}`);
      if (res.status === 401) {
        await triggerAuth();
        return [];
      }
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }, [triggerAuth]);

  // Play a specific track
  const playTrack = useCallback(async (uri: string) => {
    try {
      const res = await smartFetch('/spotify/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri, device_id: (window as any).fridayDeviceId })
      });
      if (res.status === 401) {
        await triggerAuth();
        return;
      }
      setTimeout(pollCurrentTrack, 1500);
    } catch (err) {
      console.error('[FRIDAY Spotify] Play track failed:', err);
    }
  }, [pollCurrentTrack, triggerAuth]);

  return {
    state,
    widgetMode,
    showWidget,
    hideWidget,
    minimizeWidget,
    expandWidget,
    collapseWidget,
    togglePlay,
    nextTrack,
    previousTrack,
    searchTracks,
    playTrack,
  };
}
