const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add modelLatencyRef and calculateDistanceMeters
code = code.replace(
  "function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {",
  "function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {\n  const R = 6371e3;\n  const p1 = lat1 * Math.PI/180;\n  const p2 = lat2 * Math.PI/180;\n  const dp = (lat2-lat1) * Math.PI/180;\n  const dl = (lon2-lon1) * Math.PI/180;\n  const a = Math.sin(dp/2) * Math.sin(dp/2) +\n            Math.cos(p1) * Math.cos(p2) *\n            Math.sin(dl/2) * Math.sin(dl/2);\n  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));\n  return R * c;\n}\n\nfunction calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {"
);

code = code.replace(
  "const liveTargetsRef = useRef<any[]>([]);",
  "const liveTargetsRef = useRef<any[]>([]);\n  const modelLatencyRef = useRef<number>(0);"
);

// 2. Update TelemetryData types
code = code.replace(
  "    battery: number;\n    model: string;",
  "    battery: number;\n    model: string;\n    speed?: number;\n    timestamp?: number;"
);

// 3. Update detectFrame
const detectStart = `
        const start = performance.now();
        const predictions = await model.detect(videoRef.current);
        const end = performance.now();
        modelLatencyRef.current = end - start;
`;
code = code.replace(
  "        const predictions = await model.detect(videoRef.current);",
  detectStart.trimStart()
);

const newTargetsLogic = `
          const targetId = \`LIV-\${idx}-\${pred.class.substring(0,3).toUpperCase()}\`;
          const prevTarget = liveTargetsRef.current.find(t => t.id === targetId);
          const currentBattery = prevTarget ? Math.max(0, prevTarget.battery - 0.2) : 100;
          
          let speed = 0;
          if (prevTarget && prevTarget.timestamp) {
             const timeDelta = (performance.now() - prevTarget.timestamp) / 1000;
             if (timeDelta > 0) {
                 const d = calculateDistanceMeters(prevTarget.gps.lat, prevTarget.gps.lng, 37.7749 + (targetY * -0.00001), -122.4194 + (targetX * 0.00001));
                 speed = (d / timeDelta) * 3.6;
             }
          }

          return {
            id: targetId,
            timestamp: performance.now(),
            speed: speed,
            x: targetX,
            y: targetY,
            width: (pred.bbox[2] / video.videoWidth) * renderWidth,
            height: (pred.bbox[3] / video.videoHeight) * renderHeight,
            confidence: pred.score,
            battery: currentBattery,
`;
code = code.replace(
  /          return \{\n            id: `LIV-\$\{idx\}-\$\{pred\.class\.substring\(0,3\)\.toUpperCase\(\)\}`,\n            x: targetX,\n            y: targetY,\n            width: \(pred\.bbox\[2\] \/ video\.videoWidth\) \* renderWidth,\n            height: \(pred\.bbox\[3\] \/ video\.videoHeight\) \* renderHeight,\n            confidence: pred\.score,\n            battery: 80,/g,
  newTargetsLogic.trimStart()
);

// 4. Update Battery Alert Logic
code = code.replace(
  "const hasBatteryAlert = data.targets.some(t => t.battery < 15);",
  "const hasBatteryAlert = data.targets.some(t => t.battery < 10);"
);
code = code.replace(
  "data.targets.filter(t => t.battery < 15).forEach(t => {",
  "data.targets.filter(t => t.battery < 10).forEach(t => {"
);
code = code.replace(
  "message: `CRITICAL: ${t.id} Battery below 15%`, type: 'error'",
  "message: `CRITICAL: ${t.id} Battery below 10%`, type: 'error'"
);

// 5. Inject responseTimeMs into setData
code = code.replace(
  "             fps: 30, confidence: drone ? drone.confidence : 0,",
  "             fps: 30, confidence: drone ? drone.confidence : 0,\n             responseTimeMs: modelLatencyRef.current,"
);

// 6. Update Bounding Box UI to show speed
const speedUi = `
                        <div className="bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shadow-sm whitespace-nowrap">
                          {target.model} • {distanceStr}
                        </div>
                        {target.speed !== undefined && target.speed > 0.5 && (
                           <div className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shadow-sm whitespace-nowrap">
                             {target.speed.toFixed(1)} km/h
                           </div>
                        )}
`;
code = code.replace(
  /                        <div className="bg-rose-500 text-white text-\[10px\] font-bold px-1\.5 py-0\.5 rounded flex items-center gap-1 shadow-sm whitespace-nowrap">\n                          \{target\.model\} • \{distanceStr\}\n                        <\/div>/g,
  speedUi.trimStart()
);

// 7. Update System Health UI to show latency
const cameraLatencyUi = `
                <StatusRow 
                  label="CAMERA" 
                  status={data.system.cameraStatus} 
                  extra={<span className="text-[10px] text-slate-400 font-mono tracking-tighter" title="Latency">{data.system.responseTimeMs?.toFixed(0) || 0}ms</span>}
                />
`;
code = code.replace(
  /<StatusRow label="CAMERA" status=\{data\.system\.cameraStatus\} \/>/g,
  cameraLatencyUi.trimStart()
);


fs.writeFileSync('src/App.tsx', code);
