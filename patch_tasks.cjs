const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add new state variables
code = code.replace(
  "const [mapZoom, setMapZoom] = useLocalStorage('antiDrone_mapZoom', 1);",
  "const [cameraPower, setCameraPower] = useLocalStorage('antiDrone_cameraPower', true);\n  const [driftResetTimestamp, setDriftResetTimestamp] = useState<number>(0);\n  const [mapZoom, setMapZoom] = useLocalStorage('antiDrone_mapZoom', 1);"
);

// 2. Add timestamp to history items
code = code.replace(
  "time: ts,",
  "time: ts,\n             timestamp: Date.now(),"
);

// 3. Update sensorDrift calculation
const sensorDriftCode = `
  const sensorDrift = useMemo(() => {
    if (!history || history.length < 2) return 0;
    const relevantHistory = history.filter((h: any) => h.timestamp > driftResetTimestamp);
    if (relevantHistory.length < 2) return 0;
    const sum = relevantHistory.reduce((acc, h: any) => acc + (h.error * h.error), 0);
    return sum / relevantHistory.length;
  }, [history, driftResetTimestamp]);
`;
code = code.replace(
  /  const sensorDrift = useMemo\(\(\) => \{\n    if \(\!history \|\| history\.length < 2\) return 0;\n    const sum = history\.reduce\(\(acc, h\) => acc \+ \(h\.error \* h\.error\), 0\);\n    return sum \/ history\.length;\n  \}, \[history\]\);/g,
  sensorDriftCode.trim()
);

// 4. Update handleTakeSnapshot for timestamp overlay
const snapshotCode = `
  const handleTakeSnapshot = async () => {
    if (feedRef.current) {
      try {
        const timestampEl = document.createElement('div');
        timestampEl.style.position = 'absolute';
        timestampEl.style.bottom = '16px';
        timestampEl.style.right = '16px';
        timestampEl.style.color = 'white';
        timestampEl.style.fontFamily = 'monospace';
        timestampEl.style.fontSize = '12px';
        timestampEl.style.zIndex = '9999';
        timestampEl.style.backgroundColor = 'rgba(0,0,0,0.5)';
        timestampEl.style.padding = '4px 8px';
        timestampEl.style.borderRadius = '4px';
        timestampEl.innerText = new Date().toLocaleString();
        feedRef.current.appendChild(timestampEl);

        const canvas = await html2canvas(feedRef.current, { backgroundColor: '#0f172a', useCORS: true });
        
        feedRef.current.removeChild(timestampEl);

        const url = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = \`drone_snapshot_\${new Date().getTime()}.png\`;
        link.href = url;
        link.click();
      } catch (e) {
        console.error('Failed to take snapshot', e);
      }
    }
  };
`;
code = code.replace(
  /  const handleTakeSnapshot = async \(\) => \{[\s\S]*?console\.error\('Failed to take snapshot', e\);\n      \}\n    \}\n  \};/g,
  snapshotCode.trim()
);

// 5. Add "Reset Drift" button to System Health -> SENSOR HUB extra prop
const sensorExtraCode = `
                  extra={
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setDriftResetTimestamp(Date.now())}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 font-bold uppercase tracking-wider transition-colors"
                        title="Reset Drift Calculation"
                      >
                        Reset Drift
                      </button>
                      <div className="flex items-center gap-1.5">
                        {sensorDrift > 25 && (
                           <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" title="High Drift - Calibration Required" />
                        )}
                        <span className="text-[10px] text-slate-400 font-mono tracking-tighter" title="Cumulative Variance">v:{sensorDrift.toFixed(3)}</span>
                      </div>
                    </div>
                  }
`;
code = code.replace(
  /                  extra=\{\n                    <div className="flex items-center gap-1\.5">\n                      \{sensorDrift > 25 && \(\n                         <AlertTriangle className="w-3\.5 h-3\.5 text-rose-500 animate-pulse" title="High Drift - Calibration Required" \/>\n                      \)\}\n                      <span className="text-\[10px\] text-slate-400 font-mono tracking-tighter" title="Cumulative Variance">v:\{sensorDrift\.toFixed\(3\)\}<\/span>\n                    <\/div>\n                  \}/g,
  sensorExtraCode.trim()
);

// 6. Camera Power Toggle
// Replace "Live Camera Feed" action block to add power button
const cameraActionBlock = `
            action={
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCameraPower(!cameraPower)}
                  className={cn(
                    "p-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 px-3",
                    cameraPower ? "text-rose-600 bg-rose-50 hover:bg-rose-100" : "text-emerald-600 bg-emerald-50 hover:bg-emerald-100"
                  )}
                  title={cameraPower ? "Power Off Camera Feed" : "Power On Camera Feed"}
                >
                  <Power className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase hidden sm:inline">{cameraPower ? 'Power Off' : 'Power On'}</span>
                </button>
                <select 
`;
code = code.replace(
  /            action=\{\n              <div className="flex items-center gap-3">\n                <select /g,
  cameraActionBlock.trimStart()
);

// Modify feedRef to hide video if !cameraPower
const feedRefBlock = `
            <div ref={feedRef} className="relative flex-1 bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center shadow-inner border border-slate-800 min-h-[400px]">
              {cameraPower ? (
                <>
                  <video 
                    ref={videoRef}
                    className="absolute inset-0 w-full h-full object-cover"
                    autoPlay 
                    playsInline 
                    muted 
                  />
                  {/* Simulated Camera View Filter (optional overlay) */}
                  <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]" />
                  
                  {/* Crosshair Center */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                    <Crosshair className="w-10 h-10 text-slate-500 opacity-60 stroke-[1.5]" />
                  </div>
`;
code = code.replace(
  /            <div ref=\{feedRef\} className="relative flex-1 bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center shadow-inner border border-slate-800">[\s\S]*?<div className="absolute top-1\/2 left-1\/2 -translate-x-1\/2 -translate-y-1\/2">\n                <Crosshair className="w-10 h-10 text-slate-500 opacity-60 stroke-\[1\.5\]" \/>\n              <\/div>/g,
  feedRefBlock.trimStart()
);

const endOfFeedRef = `
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 bg-black">
                  <Power className="w-12 h-12 mb-4 opacity-50" />
                  <span className="text-sm font-bold tracking-widest uppercase">Feed Offline</span>
                  <span className="text-xs mt-2 opacity-70">Camera powered down to save CPU resources.</span>
                </div>
              )}
            </div>
`;
code = code.replace(
  /              \{\/\* Drone Details Floating Overlay \*\/\}[\s\S]*?<\/div>\n                  <\/div>\n                \);\n              \}\)\(\)\}\n            <\/div>/,
  (match) => match.replace("            </div>", endOfFeedRef.trimStart())
);

fs.writeFileSync('src/App.tsx', code);
