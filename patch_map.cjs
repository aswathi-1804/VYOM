const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add centerOnPrimary state
code = code.replace(
  "const [mapZoom, setMapZoom] = useLocalStorage('antiDrone_mapZoom', 1);",
  "const [mapZoom, setMapZoom] = useLocalStorage('antiDrone_mapZoom', 1);\n  const [centerOnPrimary, setCenterOnPrimary] = useLocalStorage('antiDrone_centerOnPrimary', false);"
);

// 2. Add Center button in action bar
const centerBtnHtml = `                <button 
                  onClick={() => setCenterOnPrimary(!centerOnPrimary)}
                  className={cn(
                    "p-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 px-2",
                    centerOnPrimary ? "text-emerald-600 bg-emerald-50 hover:bg-emerald-100" : "text-slate-500 hover:bg-slate-100"
                  )}
                  title={centerOnPrimary ? "Disable Auto-Center" : "Center on Primary Target"}
                >
                  <Target className="w-4 h-4" />
                </button>
              </div>`;
code = code.replace(
  /<\/button>\n\s*<\/div>\n\s*\}\n\s*>/,
  `</button>\n${centerBtnHtml}\n            }\n          >`
);

// 3. Compute offset and apply to map container
const offsetCode = `
  const DRIFT_LIMIT = 500;
  
  let mapOffsetX = 0;
  let mapOffsetY = 0;
  if (centerOnPrimary && data?.primaryTargetId) {
    const pt = (scrubIndex !== null && history[scrubIndex]?.targets ? history[scrubIndex].targets : data.targets).find((t: any) => t.id === data.primaryTargetId);
    if (pt) {
      const leftPerc = ((pt.gps.lng - (-122.4194)) / 0.00005) + 50;
      const topPerc = ((pt.gps.lat - 37.7749) / 0.00005) + 50;
      mapOffsetX = 50 - leftPerc;
      mapOffsetY = 50 - topPerc;
    }
  }

  const hasDriftWarning = sensorDrift > DRIFT_LIMIT;
`;

code = code.replace(
  "return (",
  `${offsetCode}\n  return (`
);

code = code.replace(
  /style=\{\{\s*transform:\s*\`scale\(\$\{mapZoom\}\)\s*rotate\(\$\{mapRotation\}deg\)\`\s*\}\}/,
  "style={{ transform: `scale(${mapZoom}) rotate(${mapRotation}deg) translate(${mapOffsetX}%, ${mapOffsetY}%)` }}"
);

// 4. Update SENSOR HUB StatusRow
code = code.replace(
  /extra=\{\<span className=\"text-\[10px\] text-slate-400 font-mono tracking-tighter\" title=\"Cumulative Variance\"\>v:\{sensorDrift\.toFixed\(3\)\}\<\/span\>\}/,
  `extra={
                    <span className="flex items-center gap-1 text-[10px] text-slate-400 font-mono tracking-tighter" title="Cumulative Variance">
                      {hasDriftWarning && <AlertTriangle className="w-3 h-3 text-rose-500 animate-pulse" title="High Drift! Recalibration Recommended" />}
                      v:{sensorDrift.toFixed(3)}
                    </span>
                  }`
);

// 5. Add Timeline graph above Scrub Slider
const scrubHtml = `{/* Threat Activity Timeline */}
             {history.length > 0 && (
               <div className="mt-4 px-1 flex flex-col gap-1">
                 <div className="flex justify-between items-center text-xs text-slate-500 font-mono">
                   <span>{history[0].time}</span>
                   <span className="font-bold text-slate-700">
                     {scrubIndex !== null && history[scrubIndex] ? history[scrubIndex].time : 'LIVE'}
                   </span>
                   <span>{history[history.length - 1].time}</span>
                 </div>
                 
                 <div className="relative w-full h-4 bg-slate-100 rounded overflow-hidden flex items-end">
                   {history.map((h, i) => {
                     const isHighThreat = (h.targets?.length || 0) > 0;
                     const height = isHighThreat ? '100%' : '25%';
                     const color = isHighThreat ? 'bg-rose-500' : 'bg-slate-300';
                     return (
                       <div 
                         key={i}
                         className={\`flex-1 \${color}\`}
                         style={{ height, minWidth: '1px' }}
                         onClick={() => setScrubIndex(i)}
                       />
                     );
                   })}
                 </div>

                 <input 
                    type="range" 
                    min="0" 
                    max={history.length - 1} 
                    value={scrubIndex !== null ? scrubIndex : history.length - 1} 
                   onChange={(e) => setScrubIndex(parseInt(e.target.value))} 
                   onMouseUp={() => setScrubIndex(null)} 
                   onTouchEnd={() => setScrubIndex(null)} 
                   className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-500 mt-1" 
                 />
               </div>
             )}`;

code = code.replace(
  /\{\/\* Scrub Slider \*\/\}\s*\{history\.length \> 0 && \(\s*\<div className=\"mt-4 px-1\"\>[\s\S]*?\<\/div\>\s*\)\}/,
  scrubHtml
);

fs.writeFileSync('src/App.tsx', code);
