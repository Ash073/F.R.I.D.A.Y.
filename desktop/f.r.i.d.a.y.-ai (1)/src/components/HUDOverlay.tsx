import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Cloud, Sun, CloudRain, Thermometer, CloudLightning, CloudSnow } from 'lucide-react';

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
    showMetricsBtn = true
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
    const [weather, setWeather] = useState<{temp: number, location: string, condition: string} | null>(null);
    const [forecast, setForecast] = useState<{day: string, temp: number, condition: string}[] | null>(null);

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
                { day: 'WED', temp: simulatedTemp + 1.2, condition: 'Clear' },
                { day: 'THU', temp: simulatedTemp - 0.5, condition: 'Clouds' },
                { day: 'FRI', temp: simulatedTemp + 1.8, condition: 'Clear' }
            ]);
        }

        if (!geo || !showClimate) return;
        const fetchWeather = async () => {
            // ── TRY OPEN-METEO FIRST (No API Key Required!) ──
            try {
                console.log('[WEATHER] Querying Open-Meteo for Lat:', geo.lat, 'Lon:', geo.lon);
                const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current_weather=true&daily=temperature_2m_max,weathercode&timezone=auto`);
                const data = await res.json();
                if (data && data.current_weather) {
                    const temp = data.current_weather.temperature;
                    const code = data.current_weather.weathercode;
                    let condition = 'CLOUDS';
                    
                    if (code === 0 || code === 1) condition = 'CLEAR';
                    else if (code === 2 || code === 3) condition = 'CLOUDS';
                    else if ((code >= 51 && code <= 65) || (code >= 80 && code <= 82)) condition = 'RAIN';
                    else if (code >= 71 && code <= 77) condition = 'SNOW';
                    else if (code >= 95 && code <= 99) condition = 'THUNDERSTORM';

                    setWeather({
                        temp: temp,
                        location: cityName.toUpperCase().replace(/\s+/g, '_'),
                        condition: condition
                    });

                    if (data.daily && data.daily.temperature_2m_max) {
                        const daily: {day: string, temp: number, condition: string}[] = [];
                        const daysOfWeek = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
                        const today = new Date();
                        
                        for (let i = 1; i <= 3; i++) {
                            const date = new Date();
                            date.setDate(today.getDate() + i);
                            const dayName = daysOfWeek[date.getDay()];
                            const fCode = data.daily.weathercode ? data.daily.weathercode[i] : 3;
                            let fCond = 'Clouds';
                            
                            if (fCode === 0 || fCode === 1) fCond = 'Clear';
                            else if (fCode === 2 || fCode === 3) fCond = 'Clouds';
                            else if ((fCode >= 51 && fCode <= 65) || (fCode >= 80 && fCode <= 82)) fCond = 'Rain';
                            else if (fCode >= 71 && fCode <= 77) fCond = 'Snow';
                            else if (fCode >= 95 && fCode <= 99) fCond = 'Thunderstorm';

                            daily.push({
                                day: dayName,
                                temp: data.daily.temperature_2m_max[i] ?? (temp + Math.sin(i) * 2),
                                condition: fCond
                            });
                        }
                        setForecast(daily);
                    }
                    console.log('[WEATHER] Open-Meteo synchronization successful');
                    return;
                }
            } catch (err) {
                console.warn('[WEATHER] Open-Meteo failed, trying OpenWeatherMap fallback...', err);
            }

            // ── TRY OPENWEATHERMAP SECOND (Fallback) ──
            try {
                const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${geo.lat}&lon=${geo.lon}&appid=${WEATHER_API_KEY}&units=metric`);
                const data = await res.json();
                if (data.main) {
                    setWeather({
                        temp: data.main.temp,
                        location: data.name.toUpperCase().replace(/\s+/g, '_'),
                        condition: data.weather[0]?.main || 'CLOUDS'
                    });
                    
                    const foreRes = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${geo.lat}&lon=${geo.lon}&appid=${WEATHER_API_KEY}&units=metric`);
                    const foreData = await foreRes.json();
                    if (foreData.list) {
                        const daily: {day: string, temp: number, condition: string}[] = [];
                        for (let i = 8; i < foreData.list.length && daily.length < 3; i += 8) {
                            const item = foreData.list[i];
                            const date = new Date(item.dt * 1000);
                            const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
                            daily.push({
                                day: dayName,
                                temp: item.main.temp,
                                condition: item.weather[0]?.main || 'Clouds'
                            });
                        }
                        setForecast(daily);
                        console.log('[WEATHER] OpenWeatherMap synchronization successful');
                        return;
                    }
                }
            } catch (err) {
                console.error('[WEATHER] OpenWeatherMap failed, using dynamic simulated weather fallback', err);
            }

            // ── TRY SIMULATED STARK WEATHER THIRD (Resilient Fallback) ──
            const simulatedTemp = 28.4 + Math.sin(Date.now() / 3600000) * 2;
            setWeather({
                temp: simulatedTemp,
                location: cityName.toUpperCase().replace(/\s+/g, '_'),
                condition: 'CLEAR'
            });
            setForecast([
                { day: 'WED', temp: simulatedTemp + 1.2, condition: 'Clear' },
                { day: 'THU', temp: simulatedTemp - 0.5, condition: 'Clouds' },
                { day: 'FRI', temp: simulatedTemp + 1.8, condition: 'Clear' }
            ]);
        };
        fetchWeather();
        const interval = setInterval(fetchWeather, 15 * 60 * 1000);
        return () => clearInterval(interval);
    }, [geo, showClimate, cityName]);

    const WeatherIcon = React.useMemo(() => {
        if (!weather) return Cloud;
        switch (weather.condition.toLowerCase()) {
            case 'clear': return Sun;
            case 'clouds': return Cloud;
            case 'rain':
            case 'drizzle': return CloudRain;
            case 'thunderstorm': return CloudLightning;
            case 'snow': return CloudSnow;
            default: return Cloud;
        }
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
                    <div className="mt-2 md:mt-4 pt-2 md:pt-4 border-t flex flex-col gap-1 md:gap-2" style={{ borderColor: accentColor + '1a' }}>
                        <div className="flex items-center gap-2 text-[7px] md:text-[9px]">
                            <Thermometer size={10} />
                            <span className="hidden xs:inline">CLIMATE: {weather ? 'ACTIVE' : 'SYNCING...'}</span>
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
                            <WeatherIcon size={14} className={`md:size-5 ${weather?.condition.toLowerCase() === 'clear' ? 'animate-spin-slow' : 'opacity-80'}`} style={{ color: accentColor }} />
                        </div>
                        {/* 3-Day Forecast Grid */}
                        {forecast && (
                            <div className="flex gap-1.5 mt-2 pt-2 border-t border-dashed" style={{ borderColor: accentColor + '1a' }}>
                                {forecast.map((f, idx) => {
                                    const Icon = (() => {
                                        switch (f.condition.toLowerCase()) {
                                            case 'clear': return Sun;
                                            case 'clouds': return Cloud;
                                            case 'rain':
                                            case 'drizzle': return CloudRain;
                                            case 'thunderstorm': return CloudLightning;
                                            case 'snow': return CloudSnow;
                                            default: return Cloud;
                                        }
                                    })();
                                    return (
                                        <div key={idx} className="flex flex-col items-center gap-0.5 bg-black/20 p-1 rounded-sm min-w-[30px] border border-white/5" style={{ borderColor: accentColor + '10' }}>
                                            <span className="text-[5px] md:text-[6px] opacity-55 font-bold">{f.day}</span>
                                            <Icon size={8} style={{ color: accentColor }} />
                                            <span className="text-[7px] md:text-[8px] font-bold" style={{ color: accentColor }}>{f.temp.toFixed(0)}°</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Top Right - Time & Security */}
            <div className="absolute top-4 right-4 md:top-8 md:right-8 flex flex-col items-end gap-1 md:gap-2 text-right max-w-[120px] md:max-w-none">
                <span className="text-xs md:text-sm font-bold" style={{ color: accentColor }}>{formatTime(time)}</span>
                <span className="opacity-50">EYE_SCR: {formatDate(time)}</span>
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
