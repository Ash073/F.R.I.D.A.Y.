import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
    AreaChart, 
    Area, 
    XAxis, 
    YAxis, 
    Tooltip, 
    ResponsiveContainer,
    CartesianGrid
} from 'recharts';
import { Activity, Thermometer, Zap, X } from 'lucide-react';

interface MetricHistory {
    time: string;
    load: number;
    temp: number;
    uplink: number;
}

interface SystemMetricsDashboardProps {
    isOpen: boolean;
    onClose: () => void;
    data: MetricHistory[];
    accentColor: string;
}

export default function SystemMetricsDashboard({ isOpen, onClose, data, accentColor }: SystemMetricsDashboardProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/80 backdrop-blur-md z-[80]"
                    />
                    <motion.div 
                        initial={{ scale: 0.9, opacity: 0, y: 50 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 50 }}
                        className="fixed inset-2 sm:inset-10 md:inset-20 bg-[#0d0000] border border-white/10 rounded-2xl md:rounded-3xl z-[90] p-4 md:p-8 flex flex-col font-mono overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.8)]"
                    >
                        <div className="flex items-center justify-between mb-4 md:mb-8">
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2 md:gap-3 text-white">
                                    <Activity style={{ color: accentColor }} className="animate-pulse size-4 md:size-6" />
                                    <h2 className="text-sm md:text-2xl font-bold tracking-[0.1em] md:tracking-[0.2em] uppercase truncate max-w-[200px] md:max-w-none">Tactical_Metrics</h2>
                                </div>
                                <span className="text-[8px] md:text-[10px] text-white/40 tracking-[0.2em] md:tracking-[0.4em] uppercase mt-1">Real_Time_Analysis</span>
                            </div>
                            <button onClick={onClose} className="p-2 md:p-3 bg-white/5 hover:bg-white/10 rounded-full transition-colors group">
                                <X size={20} className="text-white/40 group-hover:text-white" />
                            </button>
                        </div>

                        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8 overflow-y-auto pr-2 md:pr-4 custom-scrollbar">
                            {/* System Load Chart */}
                            <section className="bg-white/5 border border-white/5 p-4 md:p-6 rounded-xl md:rounded-2xl flex flex-col h-[200px] md:h-[300px]">
                                <div className="flex items-center justify-between mb-2 md:mb-4">
                                    <div className="flex items-center gap-2">
                                        <Zap size={14} style={{ color: accentColor }} />
                                        <span className="text-[10px] md:text-sm font-bold uppercase tracking-widest text-white/80">Neural_Load</span>
                                    </div>
                                    <span className="text-sm md:text-xl font-bold" style={{ color: accentColor }}>{data[data.length - 1]?.load.toFixed(1)}%</span>
                                </div>
                                <div className="flex-1 min-h-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={data}>
                                            <defs>
                                                <linearGradient id="colorLoad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={accentColor} stopOpacity={0.3}/>
                                                    <stop offset="95%" stopColor={accentColor} stopOpacity={0}/>
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                            <XAxis dataKey="time" hide />
                                            <YAxis domain={[0, 100]} hide />
                                            <Tooltip 
                                                contentStyle={{ backgroundColor: '#0d0000', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '10px' }}
                                                itemStyle={{ color: accentColor }}
                                            />
                                            <Area type="monotone" dataKey="load" stroke={accentColor} fillOpacity={1} fill="url(#colorLoad)" animationDuration={1000} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </section>

                            {/* Core Temp Chart */}
                            <section className="bg-white/5 border border-white/5 p-4 md:p-6 rounded-xl md:rounded-2xl flex flex-col h-[200px] md:h-[300px]">
                                <div className="flex items-center justify-between mb-2 md:mb-4">
                                    <div className="flex items-center gap-2">
                                        <Thermometer size={14} className="text-red-500" />
                                        <span className="text-[10px] md:text-sm font-bold uppercase tracking-widest text-white/80">Thermal_Signature</span>
                                    </div>
                                    <span className="text-sm md:text-xl font-bold text-red-500">{data[data.length - 1]?.temp.toFixed(1)}°C</span>
                                </div>
                                <div className="flex-1 min-h-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={data}>
                                            <defs>
                                                <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                                                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                            <XAxis dataKey="time" hide />
                                            <YAxis domain={[20, 60]} hide />
                                            <Tooltip 
                                                contentStyle={{ backgroundColor: '#0d0000', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '10px' }}
                                                itemStyle={{ color: '#ef4444' }}
                                            />
                                            <Area type="monotone" dataKey="temp" stroke="#ef4444" fillOpacity={1} fill="url(#colorTemp)" animationDuration={1000} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </section>

                            {/* Uplink Chart */}
                            <section className="bg-white/5 border border-white/5 p-4 md:p-6 rounded-xl md:rounded-2xl flex flex-col h-[200px] md:h-[300px] lg:col-span-2">
                                <div className="flex items-center justify-between mb-2 md:mb-4">
                                    <div className="flex items-center gap-2">
                                        <Zap size={14} className="text-blue-500" />
                                        <span className="text-[10px] md:text-sm font-bold uppercase tracking-widest text-white/80">Uplink_Flux</span>
                                    </div>
                                    <span className="text-sm md:text-xl font-bold text-blue-500">{data[data.length - 1]?.uplink.toFixed(2)} GB/S</span>
                                </div>
                                <div className="flex-1 min-h-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={data}>
                                            <defs>
                                                <linearGradient id="colorUplink" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                            <XAxis dataKey="time" hide />
                                            <YAxis hide />
                                            <Tooltip 
                                                contentStyle={{ backgroundColor: '#0d0000', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '10px' }}
                                                itemStyle={{ color: '#3b82f6' }}
                                            />
                                            <Area type="stepAfter" dataKey="uplink" stroke="#3b82f6" fillOpacity={1} fill="url(#colorUplink)" animationDuration={1000} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </section>
                        </div>

                        <div className="mt-4 md:mt-8 pt-4 md:pt-6 border-t border-white/5 flex flex-col md:flex-row items-center justify-between text-[8px] md:text-[10px] text-white/20 uppercase tracking-[0.1em] md:tracking-[0.2em] gap-2">
                            <span>Capture: 500ms</span>
                            <span className="hidden md:inline">Secure_Link: Verified</span>
                            <span>VISUAL_CORE_V2.1</span>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
