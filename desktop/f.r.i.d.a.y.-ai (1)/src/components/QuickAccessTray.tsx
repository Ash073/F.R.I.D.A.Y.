import React, { useState, useEffect } from 'react';
import { motion, Reorder, AnimatePresence } from 'motion/react';
import { 
    Grid, 
    Folder, 
    Home,
    Plus,
    X,
    Globe,
    Terminal,
    Gamepad2,
    Music,
    Settings,
    Cpu,
    Monitor,
    MessageSquare,
    AppWindow
} from 'lucide-react';
import { smartFetch } from '../hooks/useFridayVoicePipeline';

interface AppConfig {
    id: string;
    icon: React.ElementType;
    label: string;
    action?: () => void;
    path?: string;
    isCustom?: boolean;
    iconUrl?: string;
}

const getIconForApp = (name: string, path: string) => {
    const n = (name + ' ' + path).toLowerCase();
    if (n.includes('chrome') || n.includes('browser') || n.includes('web') || n.includes('internet') || n.includes('edge') || n.includes('firefox')) return Globe;
    if (n.includes('code') || n.includes('editor') || n.includes('terminal') || n.includes('cmd') || n.includes('powershell') || n.includes('vs')) return Terminal;
    if (n.includes('game') || n.includes('play') || n.includes('steam') || n.includes('xbox') || n.includes('epic')) return Gamepad2;
    if (n.includes('music') || n.includes('spotify') || n.includes('audio') || n.includes('sound') || n.includes('itunes')) return Music;
    if (n.includes('settings') || n.includes('config') || n.includes('control') || n.includes('pref')) return Settings;
    if (n.includes('discord') || n.includes('slack') || n.includes('whatsapp') || n.includes('telegram') || n.includes('chat') || n.includes('message') || n.includes('teams')) return MessageSquare;
    if (n.includes('file') || n.includes('folder') || n.includes('explorer') || n.includes('drive')) return Folder;
    if (n.includes('cpu') || n.includes('system') || n.includes('process') || n.includes('hardware')) return Cpu;
    return AppWindow;
};

const BRAND_LOGOS: Record<string, string> = {
    chrome: 'https://cdn.simpleicons.org/googlechrome',
    google: 'https://cdn.simpleicons.org/google',
    spotify: 'https://cdn.simpleicons.org/spotify',
    vscode: 'https://cdn.simpleicons.org/visualstudiocode',
    code: 'https://cdn.simpleicons.org/visualstudiocode',
    discord: 'https://cdn.simpleicons.org/discord',
    steam: 'https://cdn.simpleicons.org/steam',
    whatsapp: 'https://cdn.simpleicons.org/whatsapp',
    telegram: 'https://cdn.simpleicons.org/telegram',
    slack: 'https://cdn.simpleicons.org/slack',
    firefox: 'https://cdn.simpleicons.org/firefox',
    edge: 'https://cdn.simpleicons.org/microsoftedge',
    epic: 'https://cdn.simpleicons.org/epicgames',
    github: 'https://cdn.simpleicons.org/github',
    notion: 'https://cdn.simpleicons.org/notion',
    figma: 'https://cdn.simpleicons.org/figma',
    postman: 'https://cdn.simpleicons.org/postman',
    zoom: 'https://cdn.simpleicons.org/zoom',
    teams: 'https://cdn.simpleicons.org/microsoftteams',
    skype: 'https://cdn.simpleicons.org/skype',
    vlc: 'https://cdn.simpleicons.org/vlc',
    cmd: 'https://cdn.simpleicons.org/windowsterminal',
    powershell: 'https://cdn.simpleicons.org/powershell',
    terminal: 'https://cdn.simpleicons.org/windowsterminal',
};

const getBrandLogoUrl = (name: string, path: string): string | null => {
    const combined = (name + ' ' + path).toLowerCase();
    for (const key of Object.keys(BRAND_LOGOS)) {
        if (combined.includes(key)) {
            return BRAND_LOGOS[key];
        }
    }
    return null;
};

const getBaseName = (pathStr: string) => {
    const parts = pathStr.split(/[\\/]/);
    const lastPart = parts[parts.length - 1];
    return lastPart.replace(/\.[^/.]+$/, "");
};

export default function QuickAccessTray({ accentColor = '#ff8c00' }: { accentColor?: string }) {
    const [apps, setApps] = useState<AppConfig[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    
    // Modal states
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [newAppName, setNewAppName] = useState('');
    const [newAppPath, setNewAppPath] = useState('');
    const [newAppIconUrl, setNewAppIconUrl] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    // Reconstruct list from localstorage & fallback to Electron fs storage on mount
    useEffect(() => {
        const homeApp: AppConfig = { 
            id: 'home', 
            icon: Home, 
            label: 'Close Friday', 
            action: () => (window as any).friday?.minimize() 
        };

        const loadApps = async () => {
            let parsed: any[] = [];
            
            // 1. Try Electron direct fs storage first (most reliable)
            if ((window as any).friday?.getCustomApps) {
                try {
                    const loaded = await (window as any).friday.getCustomApps();
                    if (loaded && Array.isArray(loaded) && loaded.length > 0) {
                        parsed = loaded;
                    }
                } catch (fsErr) {
                    console.error('[FRIDAY] Electron custom apps storage load failed:', fsErr);
                }
            }

            // 2. Fall back to localStorage if Electron returned empty or failed
            if (parsed.length === 0) {
                try {
                    const saved = localStorage.getItem('friday_custom_apps');
                    if (saved) {
                        parsed = JSON.parse(saved);
                    }
                } catch (e) {
                    console.error('Failed to parse saved custom apps from localStorage', e);
                }
            }

            if (parsed && parsed.length > 0) {
                const reconstructed = parsed.map((app: any) => {
                    const brandLogo = getBrandLogoUrl(app.label, app.path);
                    return {
                        id: app.id,
                        label: app.label,
                        path: app.path,
                        iconUrl: brandLogo || app.iconUrl,
                        isCustom: true,
                        icon: getIconForApp(app.label, app.path),
                        action: () => {
                            if ((window as any).friday?.launchApp) {
                                (window as any).friday.launchApp(app.path);
                            } else {
                                // Fallback via Node backend server API
                                smartFetch('/api/launch-app', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ path: app.path })
                                }).catch(err => console.error('Fallback launch failed', err));
                            }
                        }
                    };
                });
                setApps([homeApp, ...reconstructed]);
            } else {
                setApps([homeApp]);
            }
        };

        loadApps();
    }, []);

    const handleSelectPath = async () => {
        if ((window as any).friday?.selectApp) {
            const path = await (window as any).friday.selectApp();
            if (path) {
                setNewAppPath(path);
                const extractedName = getBaseName(path);
                if (extractedName && !newAppName) {
                    setNewAppName(extractedName.charAt(0).toUpperCase() + extractedName.slice(1));
                }

                // If running in Electron, extract native application executable icon as base64 png
                if ((window as any).friday?.getAppIcon) {
                    try {
                        const iconData = await (window as any).friday.getAppIcon(path);
                        if (iconData) {
                            setNewAppIconUrl(iconData);
                        }
                    } catch (iconErr) {
                        console.error('[FRIDAY] Failed to fetch native app icon:', iconErr);
                    }
                }
            }
        } else {
            setErrorMessage('Direct file browser is only available when running in Electron desktop. Please manually type the path below.');
            setTimeout(() => setErrorMessage(''), 5000);
        }
    };

    const handleAddApp = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newAppName.trim() || !newAppPath.trim()) {
            setErrorMessage('Please fill out both Name and Path parameters.');
            return;
        }

        const path = newAppPath.trim();
        const name = newAppName.trim();
        const newId = 'custom_' + Date.now();

        const brandLogo = getBrandLogoUrl(name, path);
        const newApp: AppConfig = {
            id: newId,
            label: name,
            path: path,
            isCustom: true,
            iconUrl: brandLogo || newAppIconUrl || undefined,
            icon: getIconForApp(name, path),
            action: () => {
                if ((window as any).friday?.launchApp) {
                    (window as any).friday.launchApp(path);
                } else {
                    smartFetch('/api/launch-app', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: path })
                    }).catch(err => console.error('Fallback launch failed', err));
                }
            }
        };

        const updatedApps = [...apps, newApp];
        setApps(updatedApps);

        const customOnly = updatedApps
            .filter(app => app.isCustom)
            .map(app => ({
                id: app.id,
                label: app.label,
                path: app.path,
                iconUrl: app.iconUrl
            }));
        localStorage.setItem('friday_custom_apps', JSON.stringify(customOnly));
        if ((window as any).friday?.saveCustomApps) {
            (window as any).friday.saveCustomApps(customOnly);
        }

        setNewAppName('');
        setNewAppPath('');
        setNewAppIconUrl('');
        setIsAddModalOpen(false);
    };

    const handleDeleteApp = (id: string) => {
        const updatedApps = apps.filter(app => app.id !== id);
        setApps(updatedApps);

        const customOnly = updatedApps
            .filter(app => app.isCustom)
            .map(app => ({
                id: app.id,
                label: app.label,
                path: app.path,
                iconUrl: app.iconUrl
            }));
        localStorage.setItem('friday_custom_apps', JSON.stringify(customOnly));
        if ((window as any).friday?.saveCustomApps) {
            (window as any).friday.saveCustomApps(customOnly);
        }
    };

    const handleReorder = (newAppsOrder: AppConfig[]) => {
        // Ensure "home" always stays at index 0
        const homeItem = newAppsOrder.find(a => a.id === 'home');
        const otherItems = newAppsOrder.filter(a => a.id !== 'home');
        const correctedOrder = homeItem ? [homeItem, ...otherItems] : newAppsOrder;

        setApps(correctedOrder);
        const customOnly = correctedOrder
            .filter(app => app.isCustom)
            .map(app => ({
                id: app.id,
                label: app.label,
                path: app.path,
                iconUrl: app.iconUrl
            }));
        localStorage.setItem('friday_custom_apps', JSON.stringify(customOnly));
        if ((window as any).friday?.saveCustomApps) {
            (window as any).friday.saveCustomApps(customOnly);
        }
    };

    return (
        <>
            <div className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-[45] flex items-center gap-2 md:gap-4">
                {/* Toggle Button */}
                <button 
                    onClick={() => setIsOpen(!isOpen)}
                    className={`p-2 md:p-3 border transition-all duration-500 rounded-lg group pointer-events-auto ${isOpen ? 'text-black rotate-90 shadow-lg' : 'bg-transparent border-white/5 hover:border-white/20'}`}
                    style={isOpen ? { backgroundColor: accentColor, borderColor: accentColor } : { color: accentColor + '99' }}
                >
                    <Folder size={16} className="md:size-4.5 group-hover:scale-110 transition-transform" />
                </button>

                {/* Tray Content */}
                <div className="relative min-h-[150px] max-h-[500px] flex items-center overflow-visible pointer-events-none">
                    <motion.div 
                        initial={false}
                        animate={{ 
                            width: isOpen ? (window.innerWidth < 768 ? 60 : 80) : 0,
                            opacity: isOpen ? 1 : 0,
                            x: isOpen ? 0 : -20
                        }}
                        className="overflow-hidden flex flex-col items-center justify-center bg-black/65 backdrop-blur-xl border rounded-2xl p-1 md:p-2 gap-2 md:gap-4 pointer-events-auto"
                        style={{ borderColor: accentColor + '22' }}
                    >
                        <span className="text-[6px] md:text-[7px] rotate-180 [writing-mode:vertical-lr] uppercase tracking-[0.2em] md:tracking-widest mb-1 md:mb-2 opacity-50 font-mono" style={{ color: accentColor }}>
                            Quick_Access
                        </span>
                        
                        {/* Static Home Button (Minimize OS) — Rendered OUTSIDE of Reorder.Group to avoid drag events hijacking click handlers! */}
                        {apps.length > 0 && apps[0].id === 'home' && (
                            <div className="group relative">
                                <div 
                                    className="p-2 md:p-3 rounded-xl border border-transparent transition-all cursor-pointer hover:border-white/10 flex items-center justify-center pointer-events-auto animate-pulse-subtle" 
                                    style={{ backgroundColor: accentColor + '0d' }}
                                    onClick={() => apps[0].action && apps[0].action()}
                                >
                                    {(() => {
                                        const HomeIcon = apps[0].icon;
                                        return <HomeIcon size={16} className="md:size-4.5 transition-colors" style={{ color: accentColor + '99' }} />;
                                    })()}
                                </div>
                                
                                {/* Label Tooltip */}
                                <div className="hidden md:block absolute left-16 top-1/2 -translate-y-1/2 px-2 py-1 text-black text-[8px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap uppercase tracking-tighter font-mono" style={{ backgroundColor: accentColor }}>
                                    {apps[0].label}
                                </div>
                            </div>
                        )}

                        <Reorder.Group 
                            axis="y" 
                            values={apps.filter(app => app.id !== 'home')} 
                            onReorder={(newOrder) => handleReorder([apps[0], ...newOrder])}
                            className="flex flex-col gap-2 md:gap-3"
                        >
                            {apps.filter(app => app.id !== 'home').map((app) => (
                                <Reorder.Item 
                                    key={app.id} 
                                    value={app}
                                    className="cursor-grab active:cursor-grabbing group relative animate-fade-in"
                                >
                                    <div 
                                        className="p-2 md:p-3 rounded-xl border border-transparent transition-all cursor-pointer hover:border-white/10 flex items-center justify-center" 
                                        style={{ backgroundColor: accentColor + '0d' }}
                                        onClick={() => app.action && app.action()}
                                    >
                                        {app.iconUrl ? (
                                            <img 
                                                src={app.iconUrl} 
                                                alt={app.label}
                                                className="w-4 h-4 md:w-[18px] md:h-[18px] object-contain rounded-md"
                                            />
                                        ) : (
                                            <app.icon size={16} className="md:size-4.5 transition-colors" style={{ color: accentColor + '99' }} />
                                        )}
                                    </div>
                                    
                                    {/* Delete Button for Custom Apps */}
                                    {app.isCustom && (
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteApp(app.id);
                                            }}
                                            className="absolute -top-1 -right-1 p-0.5 rounded-full bg-black border border-red-500/30 text-red-500/80 hover:text-red-400 hover:bg-red-950/80 hover:border-red-500 transition-all pointer-events-auto"
                                        >
                                            <X size={10} />
                                        </button>
                                    )}

                                    {/* Label Tooltip - Hidden on mobile touch */}
                                    <div className="hidden md:block absolute left-16 top-1/2 -translate-y-1/2 px-2 py-1 text-black text-[8px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap uppercase tracking-tighter font-mono" style={{ backgroundColor: accentColor }}>
                                        {app.label}
                                    </div>
                                </Reorder.Item>
                            ))}
                        </Reorder.Group>
                        
                        {/* Plus Add Option */}
                        <div className="relative group mt-1">
                            <button 
                                onClick={() => setIsAddModalOpen(true)}
                                className="p-2 md:p-3 rounded-xl border border-dashed transition-all cursor-pointer bg-transparent hover:bg-white/5" 
                                style={{ borderColor: accentColor + '33', color: accentColor + '99' }}
                            >
                                <Plus size={16} className="md:size-4.5" />
                            </button>
                            <div className="hidden md:block absolute left-16 top-1/2 -translate-y-1/2 px-2 py-1 text-black text-[8px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap uppercase tracking-tighter font-mono" style={{ backgroundColor: accentColor }}>
                                Add Application
                            </div>
                        </div>

                        <span className="mt-1 md:mt-2 p-1 border-t w-6 md:w-8 flex justify-center" style={{ borderColor: accentColor + '33' }}>
                            <Grid size={10} style={{ color: accentColor + '4d' }} />
                        </span>
                    </motion.div>
                </div>
            </div>

            {/* Stark OS Add Application Modal */}
            <AnimatePresence>
                {isAddModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-md pointer-events-auto">
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            className="w-full max-w-md bg-black/95 border rounded-2xl p-6 font-mono text-xs uppercase tracking-wider relative shadow-2xl"
                            style={{ borderColor: accentColor }}
                        >
                            {/* Glow Top Line */}
                            <div className="absolute top-0 inset-x-0 h-[2px] blur-[8px]" style={{ backgroundColor: accentColor }} />
                            
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xs font-bold tracking-[0.2em]" style={{ color: accentColor }}>
                                    SYS_ADD_APPLICATION
                                </h2>
                                <button 
                                    onClick={() => setIsAddModalOpen(false)}
                                    className="p-1 hover:bg-white/10 rounded transition-colors text-white/50 hover:text-white"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            <form onSubmit={handleAddApp} className="flex flex-col gap-4">
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-[9px] text-white/50">Application Label / Name</label>
                                    <input 
                                        type="text"
                                        placeholder="e.g. VS Code, Chrome"
                                        value={newAppName}
                                        onChange={(e) => setNewAppName(e.target.value)}
                                        className="bg-black/40 border p-3 rounded-lg text-white outline-none transition-all placeholder:text-white/20 focus:border-white/40 font-mono"
                                        style={{ borderColor: accentColor + '33' }}
                                    />
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[9px] text-white/50">System Path / Command / URL</label>
                                        {(window as any).friday?.selectApp && (
                                            <button
                                                type="button"
                                                onClick={handleSelectPath}
                                                className="text-[8px] font-bold px-2 py-0.5 border rounded hover:bg-white/10 transition-colors font-mono cursor-pointer"
                                                style={{ borderColor: accentColor + '66', color: accentColor }}
                                            >
                                                [ BROWSE SYSTEM ]
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text"
                                            placeholder="e.g. C:\Program Files\Google\Chrome\Application\chrome.exe"
                                            value={newAppPath}
                                            onChange={(e) => setNewAppPath(e.target.value)}
                                            className="flex-1 bg-black/40 border p-3 rounded-lg text-white outline-none transition-all placeholder:text-white/20 focus:border-white/40 font-mono"
                                            style={{ borderColor: accentColor + '33' }}
                                        />
                                        {!(window as any).friday?.selectApp && (
                                            <button
                                                type="button"
                                                onClick={handleSelectPath}
                                                className="text-[8px] font-bold px-3 border rounded hover:bg-white/10 transition-colors font-mono cursor-pointer"
                                                style={{ borderColor: accentColor + '66', color: accentColor }}
                                            >
                                                [ BROWSE ]
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {errorMessage && (
                                    <span className="text-[9px] text-red-400 font-bold mt-1 tracking-tight leading-normal uppercase">
                                        {errorMessage}
                                    </span>
                                )}

                                <div className="flex gap-3 mt-4">
                                    <button 
                                        type="button"
                                        onClick={() => setIsAddModalOpen(false)}
                                        className="flex-1 p-3 border border-white/10 rounded-lg hover:bg-white/5 transition-all text-white/70 font-mono"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        type="submit"
                                        className="flex-1 p-3 rounded-lg text-black font-bold transition-all shadow-md active:scale-95 font-mono cursor-pointer"
                                        style={{ backgroundColor: accentColor }}
                                    >
                                        Add App
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
}
