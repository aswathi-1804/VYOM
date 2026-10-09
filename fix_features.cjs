const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add state for mapCenterOnPrimary
code = code.replace(
  "const [mapZoom, setMapZoom] = useLocalStorage('antiDrone_mapZoom', 1);\n  const [mapOrientation, setMapOrientation] = useLocalStorage<'North-Up' | 'Dynamic'>('antiDrone_mapOrientation', 'North-Up');",
  "const [mapZoom, setMapZoom] = useLocalStorage('antiDrone_mapZoom', 1);\n  const [mapOrientation, setMapOrientation] = useLocalStorage<'North-Up' | 'Dynamic'>('antiDrone_mapOrientation', 'North-Up');\n  const [mapCenterOnPrimary, setMapCenterOnPrimary] = useLocalStorage('antiDrone_mapCenterOnPrimary', false);"
);

// 2. Add computation for transX and transY
const calcCode = `
  const primaryLat = (scrubIndex !== null && history[scrubIndex]?.lat) ? history[scrubIndex].lat : data.droneDetails.gps.lat;
  const primaryLng = (scrubIndex !== null && history[scrubIndex]?.lng) ? history[scrubIndex].lng : data.droneDetails.gps.lng;
  const mapTransX = mapCenterOnPrimary ? -(((primaryLng - BASE_LNG) / 0.00005) * 50) : 0;
  const mapTransY = mapCenterOnPrimary ? -(((primaryLat - BASE_LAT) / 0.00005) * 50) : 0;

  return (
`;
code = code.replace("  if (!data) {\n    return (", "  if (!data) {\n    return (");
code = code.replace(/  return \(\n    <div className="flex flex-col h-screen overflow-hidden/g, calcCode + `    <div className="flex flex-col h-screen overflow-hidden`);

// 3. Add button in Mission Map action bar
const centerButtonCode = `
                <button 
                  onClick={() => setMapCenterOnPrimary(!mapCenterOnPrimary)}
                  className={cn(
                    "p-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 px-2",
                    mapCenterOnPrimary ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100" : "text-slate-500 hover:bg-slate-100"
                  )}
                  title={mapCenterOnPrimary ? "Disable Centering" : "Center on Primary"}
                >
                  <Crosshair className={cn("w-4 h-4", mapCenterOnPrimary && "animate-pulse")} />
                  <span className="text-[10px] font-bold uppercase hidden sm:inline">Center</span>
                </button>
                <button 
                  onClick={() => setMapOrientation(o => o === 'North-Up' ? 'Dynamic' : 'North-Up')}
`;
code = code.replace(/                <button \n                  onClick={\(\) => setMapOrientation/g, centerButtonCode.trimStart());

// 4. Update map transform
code = code.replace(
  /style=\{\{ transform: `scale\(\$\{mapZoom\}\) rotate\(\$\{mapRotation\}deg\)` \}\}/g,
  "style={{ transform: `scale(${mapZoom}) rotate(${mapRotation}deg) translate(${mapTransX}%, ${mapTransY}%)` }}"
);

// 5. Update SENSOR HUB StatusRow
const sensorHubCode = `
                <StatusRow 
                  label="SENSOR HUB" 
                  status={data.system.sensorStatus} 
                  extra={
                    <div className="flex items-center gap-1.5">
                      {sensorDrift > 25 && (
                         <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" title="High Drift - Calibration Required" />
                      )}
                      <span className="text-[10px] text-slate-400 font-mono tracking-tighter" title="Cumulative Variance">v:{sensorDrift.toFixed(3)}</span>
                    </div>
                  }
                />
`;
code = code.replace(
  /<StatusRow \s*label="SENSOR HUB" \s*status=\{data\.system\.sensorStatus\} \s*extra=\{<span className="text-\[10px\] text-slate-400 font-mono tracking-tighter" title="Cumulative Variance">v:\{sensorDrift\.toFixed\(3\)\}<\/span>\}\s*\/>/g,
  sensorHubCode.trim()
);

// 6. Add timeline to the bottom of the Scrub Slider
const timelineCode = `
                 {/* Timeline visualization */}
                 <div className="relative w-full h-4 mt-1 flex gap-[1px]">
                    {history.map((h, i) => {
                       const threatLevel = h.targets && h.targets.length > 0 ? (h.targets.length > 1 ? 'HIGH' : 'MEDIUM') : 'LOW';
                       const bgColor = threatLevel === 'HIGH' ? 'bg-rose-500' : (threatLevel === 'MEDIUM' ? 'bg-amber-400' : 'bg-slate-200');
                       return (
                         <div 
                           key={i} 
                           className={\`h-full flex-1 \${bgColor} cursor-pointer opacity-70 hover:opacity-100 transition-opacity\`}
                           onClick={() => setScrubIndex(i)}
                           title={\`\${h.targets?.length || 0} Drones Detected\`}
                         />
                       );
                    })}
                 </div>
               </div>
`;
code = code.replace(
  /                   className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"\n                 \/>\n               <\/div>/g,
  `                   className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"\n                 />\n${timelineCode}`
);

fs.writeFileSync('src/App.tsx', code);
