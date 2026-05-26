import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Thermometer } from 'lucide-react';
import { smartFetch } from '../hooks/useFridayVoicePipeline';

// Proper weather condition → emoji mapping
function weatherEmoji(condition: string): string {
  switch (condition?.toLowerCase()) {
    case 'clear': return '☀️';
    case 'clouds': return '☁️';
    case 'few clouds': return '🌤️';
    case 'scattered clouds': return '⛅';
    case 'broken clouds': return '🌥️';
    case 'rain': case 'drizzle': return '🌧️';
    case 'thunderstorm': return '⛈️';
    case 'snow': return '❄️';
    case 'mist': case 'fog': case 'haze': return '🌫️';
    default: return '🌡️';
  }
}

interface ApiStatusItem {
    configured: boolean;
    exhausted: boolean;
    masked: string | null;
}

interface ApiStatus {
    gemini: ApiStatusItem;
    openai: ApiStatusItem;
}

interface HUDOverlayProps {
    status: string;
    systemLoad: number;
    encryption: string;
    accentColor?: string;
    coreTemp?: number;
    uplink?: number;
    showUplink?: boolean;
    showCoreTemp?: boolean;
    showClimate?: boolean;
    showGeodata?: boolean;
    onMetricsClick?: () => void;
    showMetricsBtn?: boolean;
    apiStatus?: ApiStatus | null;
}


export default function HUDOverlay({ 
    status, 
    systemLoad, 
    encryption, 
    accentColor = '#ff8c00',
    coreTemp = 34.2,
    uplink = 1.2,
    showUplink = true,
    showCoreTemp = true,
    showClimate = true,
    showGeodata = true,
    onMetricsClick,
    showMetricsBtn = true,
    apiStatus = null
}: HUDOverlayProps) {
    const [time, setTime] = useState(new Date());
    const [cityName, setCityName] = useState<string>(() => {
        return localStorage.getItem('friday_weather_city') || 'VISAKHAPATNAM';
    });
    const [geo, setGeo] = useState<{lat: number, lon: number} | null>(() => {
        const savedLat = localStorage.getItem('friday_weather_lat');
        const savedLon = localStorage.getItem('friday_weather_lon');
        if (savedLat && savedLon) {
            return { lat: parseFloat(savedLat), lon: parseFloat(savedLon) };
        }
        // Precise default coordinates for Visakhapatnam
        return { lat: 17.6868, lon: 83.2185 };
    });
    const [weather, setWeather] = useState<{temp: number, location: string, condition: string, humidity?: number, wind?: number, feelsLike?: number, description?: string} | null>(null);
    const [forecast, setForecast] = useState<{day: string, temp: number, tempMin: number, condition: string, humidity?: number}[] | null>(null);
    const [weatherExpanded, setWeatherExpanded] = useState(false);
    const [spotifyToken, setSpotifyToken] = useState<{status: string, remainingMin: number, verified: boolean, mode?: string} | null>(null);

    const WEATHER_API_KEY = 'c484855fdb4cc410d9895e9ac432c33c';

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        
        const fetchIPLocation = async () => {
            // Keep locked to Visakhapatnam unless explicitly overwritten
            console.log('[WEATHER] Location locked to Visakhapatnam to prevent ISP fluctuations');
            setGeo({ lat: 17.6868, lon: 83.2185 });
            setCityName('VISAKHAPATNAM');
            return true;
        };

        const obtainLocation = async () => {
            if (!showGeodata) return;
            
            // Hardcode Visakhapatnam for absolute liveness consistency
            setGeo({ lat: 17.6868, lon: 83.2185 });
            setCityName('VISAKHAPATNAM');
        };

        obtainLocation();
        return () => clearInterval(timer);
    }, [showGeodata]);

    // Poll Spotify token status every 60 seconds
    useEffect(() => {
        const fetchSpotifyStatus = async () => {
            try {
                const res = await smartFetch('/spotify/status');
                if (res.ok) {
                    const data = await res.json();
                    setSpotifyToken(data);
                } else {
                    setSpotifyToken({ status: 'OFFLINE', remainingMin: 0, verified: false });
                }
            } catch {
                setSpotifyToken({ status: 'OFFLINE', remainingMin: 0, verified: false });
            }
        };
        fetchSpotifyStatus();
        const interval = setInterval(fetchSpotifyStatus, 60000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        // If showClimate is true but we don't have geo yet, trigger simulated weather first!
        // This ensures the user instantly sees weather data and it doesn't stay blank/syncing forever if GPS/IP is slow or blocked!
        if (showClimate && !geo) {
            const simulatedTemp = 28.4 + Math.sin(Date.now() / 3600000) * 2;
            setWeather({
                temp: simulatedTemp,
                location: 'STARK_TOWER',
                condition: 'CLEAR'
            });
            setForecast([
                { day: 'WED', temp: simulatedTemp + 1.2, tempMin: simulatedTemp - 1, condition: 'Clear' },
                { day: 'THU', temp: simulatedTemp - 0.5, tempMin: simulatedTemp - 2, condition: 'Clouds' },
                { day: 'FRI', temp: simulatedTemp + 1.8, tempMin: simulatedTemp, condition: 'Clear' }
            ]);
        }

        if (!geo || !showClimate) return;
        const fetchWeather = async () => {
            // ── TRY OPENWEATHERMAP FIRST (Most accurate conditions!) ──
            try {
                const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${geo.lat}&lon=${geo.lon}&appid=${WEATHER_API_KEY}&units=metric`);
                const data = await res.json();
                if (data.main) {
                    setWeather({
                        temp: data.main.temp,
                        location: data.name.toUpperCase().replace(/\s+/g, '_'),
                        condition: data.weather[0]?.main || 'CLOUDS',
                        humidity: data.main.humidity,
                        wind: data.wind?.speed,
                        feelsLike: data.main.feels_like,
                        description: data.weather[0]?.description
                    });
                    
                    const foreRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${geo.lat}&lon=${geo.lon}&appid=${WEATHER_API_KEY}&units=metric`);
                    const foreData = await foreRes.json();
                    if (foreData.list) {
                        const daily: {day: string, temp: number, tempMin: number, condition: string, humidity?: number}[] = [];
                        const seen = new Set<string>();
                        for (const item of foreData.list) {
                            const date = new Date(item.dt * 1000);
                            const dayKey = date.toDateString();
                            if (dayKey === new Date().toDateString()) continue;
                            if (seen.has(dayKey)) continue;
                            seen.add(dayKey);
                            daily.push({
                                day: date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
                                temp: item.main.temp_max,
                                tempMin: item.main.temp_min,
                                condition: item.weather[0]?.main || 'Clouds',
                                humidity: item.main.humidity
                            });
                            if (daily.length >= 5) break;
                        }
                        setForecast(daily);
                        console.log('[WEATHER] OpenWeatherMap synchronization successful');
                        return;
                    }
                }
            } catch (err) {
                console.error('[WEATHER] OpenWeatherMap failed, trying Open-Meteo fallback...', err);
            }

            // ── TRY OPEN-METEO SECOND (Fallback — no API key needed) ──
            try {
                const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto`);
                const data = await res.json();
                if (data && data.current_weather) {
                    const temp = data.current_weather.temperature;
                    const code = data.current_weather.weathercode;
                    let condition = 'Clouds';
                    if (code === 0) condition = 'Clear';
                    else if (code === 1 || code === 2) condition = 'Few Clouds';
                    else if (code === 3) condition = 'Clouds';
                    else if (code >= 51 && code <= 67) condition = 'Rain';
                    else if (code >= 71 && code <= 77) condition = 'Snow';
                    else if (code >= 80 && code <= 82) condition = 'Rain';
                    else if (code >= 95) condition = 'Thunderstorm';

                    setWeather({
                        temp, location: cityName.toUpperCase().replace(/\s+/g, '_'),
                        condition, description: condition.toLowerCase()
                    });
                    if (data.daily?.temperature_2m_max) {
                        const daily: {day: string, temp: number, tempMin: number, condition: string}[] = [];
                        const daysOfWeek = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
                        const today = new Date();
                        for (let i = 1; i <= 5 && i < data.daily.temperature_2m_max.length; i++) {
                            const date = new Date(); date.setDate(today.getDate() + i);
                            const fCode = data.daily.weathercode?.[i] ?? 3;
                            let fCond = 'Clouds';
                            if (fCode === 0 || fCode === 1) fCond = 'Clear';
                            else if (fCode === 2 || fCode === 3) fCond = 'Clouds';
                            else if (fCode >= 51 && fCode <= 67) fCond = 'Rain';
                            else if (fCode >= 71 && fCode <= 77) fCond = 'Snow';
                            else if (fCode >= 80 && fCode <= 82) fCond = 'Rain';
                            else if (fCode >= 95) fCond = 'Thunderstorm';
                            daily.push({
                                day: daysOfWeek[date.getDay()],
                                temp: data.daily.temperature_2m_max[i],
                                tempMin: data.daily.temperature_2m_min?.[i] ?? data.daily.temperature_2m_max[i] - 4,
                                condition: fCond
                            });
                        }
                        setForecast(daily);
                    }
                    console.log('[WEATHER] Open-Meteo synchronization successful');
                    return;
                }
            } catch (err) {
                console.warn('[WEATHER] Open-Meteo also failed', err);
            }

            // ── SIMULATED FALLBACK ──
            const simulatedTemp = 28.4 + Math.sin(Date.now() / 3600000) * 2;
            setWeather({
                temp: simulatedTemp,
                location: cityName.toUpperCase().replace(/\s+/g, '_'),
                condition: 'CLEAR'
            });
            setForecast([
                { day: 'WED', temp: simulatedTemp + 1.2, tempMin: simulatedTemp - 1, condition: 'Clear' },
                { day: 'THU', temp: simulatedTemp - 0.5, tempMin: simulatedTemp - 2, condition: 'Clouds' },
                { day: 'FRI', temp: simulatedTemp + 1.8, tempMin: simulatedTemp, condition: 'Clear' }
            ]);
        };
        fetchWeather();
        const interval = setInterval(fetchWeather, 5 * 60 * 1000); // Refresh every 5 minutes
        return () => clearInterval(interval);
    }, [geo, showClimate, cityName]);

    const weatherIcon = React.useMemo(() => {
        return weather ? weatherEmoji(weather.condition) : '🌡️';
    }, [weather]);

    const formatDate = (date: Date) => {
        return date.toISOString().split('T')[0];
    };

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('en-US', { hour12: false });
    };

    return (
        <div className="absolute inset-0 pointer-events-none p-4 md:p-8 font-mono text-[8px] md:text-[10px] uppercase tracking-widest z-10" style={{ color: accentColor + '99' }}>
            {/* Top Left - System Stats */}
            <div className="absolute top-4 left-4 md:top-8 md:left-8 flex flex-col gap-1 md:gap-2 max-w-[120px] md:max-w-none">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full animate-pulse" style={{ backgroundColor: accentColor }} />
                    <span className="font-bold truncate" style={{ color: accentColor }}>STATUS: {status}</span>
                </div>
                {showCoreTemp && <span className="opacity-70 md:opacity-100">TEMP: {coreTemp.toFixed(1)}°C</span>}
                {showUplink && <span className="opacity-70 md:opacity-100">UPLINK: {uplink.toFixed(1)} GB/S</span>}
                
                {showClimate && (
                    <div className="mt-2 md:mt-4 pt-2 md:pt-4 border-t flex flex-col gap-1 md:gap-2 pointer-events-auto" style={{ borderColor: accentColor + '1a' }}>
                        {/* Clickable weather header */}
                        <button onClick={() => setWeatherExpanded(!weatherExpanded)} className="cursor-pointer bg-transparent border-none p-0 text-left w-full" style={{ color: 'inherit' }}>
                            <div className="flex items-center gap-2 text-[7px] md:text-[9px] mb-1">
                                <Thermometer size={10} />
                                <span>CLIMATE: {weather ? 'ACTIVE' : 'SYNCING...'}</span>
                                <span className="ml-auto text-[6px] opacity-40">{weatherExpanded ? '▼' : '▶'}</span>
                            </div>
                            <div className="flex items-center gap-2 md:gap-4">
                                <div className="flex flex-col">
                                    <span className="text-[12px] md:text-[14px] font-bold transition-all" style={{ color: accentColor, opacity: weather ? 1 : 0.5 }}>
                                        {weather ? `${weather.temp.toFixed(1)}°C` : '--.-°C'}
                                    </span>
                                    <span className="text-[6px] md:text-[8px] opacity-50">
                                        {weather ? weather.location : (geo ? 'LOCAL' : 'UNKNOWN')}
                                    </span>
                                </div>
                                <span className="text-[18px] md:text-[22px]">{weatherIcon}</span>
                            </div>
                        </button>

                        {/* Mini forecast row (always visible) */}
                        {forecast && !weatherExpanded && (
                            <div className="flex gap-1.5 mt-1 pt-1 border-t border-dashed" style={{ borderColor: accentColor + '1a' }}>
                                {forecast.slice(0, 3).map((f, idx) => (
                                    <div key={idx} className="flex flex-col items-center gap-0.5 bg-black/20 p-1 rounded-sm min-w-[30px] border border-white/5" style={{ borderColor: accentColor + '10' }}>
                                        <span className="text-[5px] md:text-[6px] opacity-55 font-bold">{f.day}</span>
                                        <span className="text-[10px]">{weatherEmoji(f.condition)}</span>
                                        <span className="text-[7px] md:text-[8px] font-bold" style={{ color: accentColor }}>{f.temp.toFixed(0)}°</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Expanded weather panel */}
                        <AnimatePresence>
                            {weatherExpanded && weather && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.3 }}
                                    className="overflow-hidden"
                                >
                                    <div className="mt-2 pt-2 border-t border-dashed space-y-2" style={{ borderColor: accentColor + '1a' }}>
                                        {/* Current details */}
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[7px] md:text-[8px]">
                                            <div className="flex items-center gap-1">
                                                <span className="opacity-50">FEELS:</span>
                                                <span style={{ color: accentColor }}>{weather.feelsLike?.toFixed(1) ?? '--'}°C</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className="opacity-50">💧 HUM:</span>
                                                <span style={{ color: accentColor }}>{weather.humidity ?? '--'}%</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className="opacity-50">💨 WIND:</span>
                                                <span style={{ color: accentColor }}>{weather.wind?.toFixed(1) ?? '--'} m/s</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className="opacity-50">SKY:</span>
                                                <span style={{ color: accentColor, textTransform: 'capitalize' }}>{weather.description || weather.condition}</span>
                                            </div>
                                        </div>

                                        {/* Extended forecast */}
                                        {forecast && (
                                            <div className="space-y-1">
                                                <div className="text-[6px] opacity-40 tracking-widest font-bold">FORECAST</div>
                                                {forecast.map((f, idx) => (
                                                    <div key={idx} className="flex items-center gap-2 py-0.5 px-1 rounded bg-black/20 border" style={{ borderColor: accentColor + '0d' }}>
                                                        <span className="text-[7px] font-bold w-7 opacity-60">{f.day}</span>
                                                        <span className="text-[12px]">{weatherEmoji(f.condition)}</span>
                                                        <span className="text-[8px] font-bold flex-1" style={{ color: accentColor }}>
                                                            {f.temp.toFixed(0)}°{f.tempMin != null ? ` / ${f.tempMin.toFixed(0)}°` : ''}
                                                        </span>
                                                        {f.humidity != null && (
                                                            <span className="text-[6px] opacity-40">💧{f.humidity}%</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            {/* Top Right - Time & Security */}
            <div className="absolute top-4 right-4 md:top-8 md:right-8 flex flex-col items-end gap-1 md:gap-2 text-right max-w-[120px] md:max-w-none">
                <span className="text-xs md:text-sm font-bold" style={{ color: accentColor }}>{formatTime(time)}</span>
                <span className="opacity-50">EYE_SCR: {formatDate(time)}</span>
                
                {/* AI API Slots Exhaustion HUD readout */}
                <div className="mt-1 flex flex-col items-end gap-0.5 border-t border-dashed pt-1" style={{ borderColor: accentColor + '1a' }}>
                    <div className="flex items-center gap-1.5 text-[6px] md:text-[7px] tracking-wider font-mono">
                        <span className="opacity-60">GEMINI_SLOT:</span>
                        {apiStatus?.gemini?.exhausted ? (
                            <span className="text-red-500 font-bold tracking-widest animate-pulse">EXHAUSTED</span>
                        ) : apiStatus?.gemini?.configured ? (
                            <span className="text-green-400 font-bold">ACTIVE</span>
                        ) : (
                            <span className="opacity-30">OFFLINE</span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[6px] md:text-[7px] tracking-wider font-mono">
                        <span className="opacity-60">OPENAI_SLOT:</span>
                        {apiStatus?.openai?.exhausted ? (
                            <span className="text-red-500 font-bold tracking-widest animate-pulse">EXHAUSTED</span>
                        ) : apiStatus?.openai?.configured ? (
                            <span className="text-green-400 font-bold">ACTIVE</span>
                        ) : (
                            <span className="opacity-30">OFFLINE</span>
                        )}
                    </div>
                    {/* Spotify Token Status */}
                    <div className="flex items-center gap-1.5 text-[6px] md:text-[7px] tracking-wider font-mono">
                        <span className="opacity-60">SPOTIFY_TKN:</span>
                        {spotifyToken?.status === 'ACTIVE' ? (
                            <span className="text-green-400 font-bold">
                                ACTIVE {spotifyToken.remainingMin > 0 ? `(${spotifyToken.remainingMin}m)` : ''}
                            </span>
                        ) : spotifyToken?.status === 'EXPIRED' ? (
                            <span className="text-red-500 font-bold animate-pulse">EXPIRED</span>
                        ) : spotifyToken?.status === 'NO_TOKEN' ? (
                            <span className="text-yellow-500 font-bold">NO_TOKEN</span>
                        ) : (
                            <span className="opacity-30">OFFLINE</span>
                        )}
                        {spotifyToken?.verified && <span className="text-[5px] text-green-400/50">✓</span>}
                    </div>
                </div>

                <div className="mt-2 md:mt-4 flex flex-col items-end gap-1 opacity-70 md:opacity-100">
                    <span className="truncate w-full">ENC: {encryption}</span>
                    <span className="hidden xs:inline truncate w-full">LAYER: LEVEL_7_QUANTUM</span>
                </div>
                
                {showMetricsBtn && (
                    <button 
                        onClick={onMetricsClick}
                        className="mt-2 md:mt-4 p-1 md:p-2 border border-white/5 hover:border-white/20 transition-all pointer-events-auto group text-right flex flex-col items-end gap-1 bg-black/20"
                    >
                        <div className="w-20 md:w-32 h-0.5 md:h-1 relative overflow-hidden" style={{ backgroundColor: accentColor + '1a' }}>
                            <motion.div 
                                className="absolute inset-y-0 left-0"
                                style={{ backgroundColor: accentColor + '66' }}
                                animate={{ width: `${systemLoad}%` }}
                            />
                        </div>
                        <span className="text-[7px] md:text-[10px]">LOAD: {systemLoad.toFixed(1)}%</span>
                        <span className="text-[6px] md:text-[7px] text-white/20 group-hover:text-white/60 transition-colors uppercase tracking-[0.2em] md:tracking-[0.3em] font-mono whitespace-nowrap">
                            [ ANALYZE ]
                        </span>
                    </button>
                )}
            </div>

            {/* Bottom Left - OS Identity - Hidden on mobile to reduce clutter */}
            <div className="absolute bottom-4 left-4 md:bottom-8 md:left-8 hidden sm:flex flex-col gap-1 opacity-40">
                <span>V6.2.3_STARK_OS</span>
                <span>SYNC_PULSE_ACTIVE</span>
                <span>PROTOCOL: MARK_85</span>
            </div>

            {/* Bottom Right - Geo Data */}
            {showGeodata && (
                <div className="absolute bottom-4 right-4 md:bottom-8 md:right-8 flex flex-col items-end gap-0.5 md:gap-1 opacity-30 md:opacity-40">
                    <span className="text-[7px] md:text-[10px]">LAT: {geo ? geo.lat.toFixed(4) + '°' : 'SCANNING...'}</span>
                    <span className="text-[7px] md:text-[10px]">LON: {geo ? geo.lon.toFixed(4) + '°' : 'SCANNING...'}</span>
                    <span className="hidden md:inline">ALT: {geo ? 'GPS_SYNC' : 'NO_SIGNAL'}</span>
                    <span className="text-[6px] md:text-[8px]">[ HUD_ALPHA_STABLE ]</span>
                </div>
            )}

            {/* Corners Borders */}
            <div className="absolute top-2 left-2 md:top-4 md:left-4 w-6 h-6 md:w-12 md:h-12 border-l border-t" style={{ borderColor: accentColor + '4d' }} />
            <div className="absolute top-2 right-2 md:top-4 md:right-4 w-6 h-6 md:w-12 md:h-12 border-r border-t" style={{ borderColor: accentColor + '4d' }} />
            <div className="absolute bottom-2 left-2 md:bottom-4 md:left-4 w-6 h-6 md:w-12 md:h-12 border-l border-b" style={{ borderColor: accentColor + '4d' }} />
            <div className="absolute bottom-2 right-2 md:bottom-4 md:right-4 w-6 h-6 md:w-12 md:h-12 border-r border-b" style={{ borderColor: accentColor + '4d' }} />
            
            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes spin-slow {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .animate-spin-slow {
                    animation: spin-slow 12s linear infinite;
                }
            `}} />
        </div>
    );
}
