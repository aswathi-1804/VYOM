const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add new states
const stateInjection = `
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [sensorData, setSensorData] = useState({
    TEMP: -8, HUMIDITY: 88, PRESSURE: 650, WIND: 35, ROLL: 3, PITCH: -2
  });
  const serialWriterRef = useRef<any>(null);

  const handleConnectHardware = async () => {
    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      setIsSerialConnected(true);

      const textEncoder = new TextEncoderStream();
      textEncoder.readable.pipeTo(port.writable);
      serialWriterRef.current = textEncoder.writable.getWriter();

      const textDecoder = new TextDecoderStream();
      port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();

      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          reader.releaseLock();
          break;
        }
        buffer += value;
        const lines = buffer.split('\\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          try {
            const parts = line.split('|').map((p: string) => p.trim());
            const parsedData: any = {};
            parts.forEach((p: string) => {
              const [key, val] = p.split(':');
              if (key && val) parsedData[key.trim()] = parseFloat(val);
            });
            if (Object.keys(parsedData).length > 0) {
              setSensorData(prev => ({...prev, ...parsedData}));
            }
          } catch(e) {}
        }
      }
    } catch (err) {
      console.error("Serial error:", err);
      setIsSerialConnected(false);
    }
  };
`;

code = code.replace(/const \[sessionStartTime, setSessionStartTime\] = useState<number \| null>\(null\);/, 
  'const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);' + stateInjection);

// 2. Replace the socket telemetry loop with our local loop
const socketRegex = /useEffect\(\(\) => \{\s*const socket = io\(\);[\s\S]*?return \(\) => \{\s*socket\.disconnect\(\);\s*\};\s*\}, \[\]\);/;

const localLoop = `
  useEffect(() => {
    if (!sessionStartTime) setSessionStartTime(Date.now());
    
    const interval = setInterval(() => {
       const drone = liveTargetsRef.current.length > 0 ? liveTargetsRef.current[0] : null;
       const temp = sensorData.TEMP;
       const humidity = sensorData.HUMIDITY;
       const pressure = sensorData.PRESSURE;
       const wind = sensorData.WIND;
       const roll = sensorData.ROLL;
       const pitch = sensorData.PITCH;

       const thermalActive = temp < 0;
       const fogRiskHigh = humidity > 80 && temp < 5;
       const highAltitudeMode = pressure < 800;

       let panError = 0;
       let tiltError = 0;
       let trackingState = 'IDLE';

       if (drone) {
          panError = drone.x; 
          tiltError = drone.y;
          trackingState = (Math.abs(panError) < 15 && Math.abs(tiltError) < 15) ? 'LOCKED' : 'TRACKING';
       }

       const panCmd = (panError * 0.1) + (roll * 1.5); 
       const tiltCmd = (tiltError * 0.1) + (pitch * 1.5);

       if (serialWriterRef.current) {
          const cmd = \`PAN:\${panCmd.toFixed(1)}|TILT:\${tiltCmd.toFixed(1)}|HEATER:\${thermalActive?1:0}|LENS:\${fogRiskHigh?1:0}\\n\`;
          serialWriterRef.current.write(cmd).catch(() => {});
       }

       const newData: any = {
          timestamp: new Date().toISOString(),
          primaryTargetId: drone ? drone.id : '',
          targets: liveTargetsRef.current,
          tracking: {
             targetX: panError,
             targetY: tiltError,
             panAngle: panCmd,
             tiltAngle: tiltCmd,
             errorX: panError,
             errorY: tiltError,
             status: trackingState,
             neutralization: 'SIMULATED'
          },
          environment: {
             temperature: temp,
             humidity: humidity,
             pressure: pressure,
             altitude: Math.round((1013.25 - pressure) * 8.43),
             fogRisk: fogRiskHigh ? 'HIGH' : 'LOW',
             thermal: thermalActive ? 'ACTIVE' : 'INACTIVE',
             altitudeMode: highAltitudeMode ? 'HIGH-ALTITUDE MODE' : 'NORMAL MODE'
          },
          motion: {
             accelX: 0, accelY: 0, accelZ: 9.8,
             gyroX: roll, gyroY: pitch, gyroZ: 0,
             windSpeed: wind,
             disturbance: wind > 30 ? 'HIGH' : (wind > 15 ? 'MEDIUM' : 'LOW')
          },
          system: {
             cameraStatus: hasCameraRef.current ? 'ONLINE' : 'OFFLINE', 
             sensorStatus: isSerialConnected ? 'ONLINE' : 'SIMULATED',
             fps: 30, confidence: drone ? drone.confidence : 0,
             signalStrength: -50
          },
          droneDetails: {
             model: drone ? drone.model : '',
             battery: 100, flightMode: drone ? 'DETECTED' : 'NONE',
             gps: { lat: lastKnownGpsRef.current?.lat || 37.7749, lng: lastKnownGpsRef.current?.lng || -122.4194 }
          }
       };

       setData(newData);
       
       const ts = new Date().toLocaleTimeString();
       setHistory(prev => {
          const newHist = [...prev, {
             time: ts,
             confidence: newData.system.confidence,
             fps: newData.system.fps,
             error: Math.sqrt(Math.pow(panError, 2) + Math.pow(tiltError, 2)),
             lat: newData.droneDetails.gps.lat,
             lng: newData.droneDetails.gps.lng,
             signalStrength: newData.system.signalStrength,
             targets: liveTargetsRef.current
          }];
          return newHist.slice(-100);
       });
       setLogs(prev => [newData, ...prev].slice(0, 100));

    }, 100);
    return () => clearInterval(interval);
  }, [sensorData, isSerialConnected]);
`;

code = code.replace(socketRegex, localLoop);

// 3. Add Hardware button in header
const headerReplace = `
            <div className="flex items-center gap-4">
              <button 
                onClick={handleConnectHardware}
                className={cn("px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all flex items-center gap-2 border", 
                  isSerialConnected ? "bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600" : "bg-slate-800 text-white border-slate-700 hover:bg-slate-700")}
              >
                <Server className="w-4 h-4" />
                {isSerialConnected ? "ESP32 Connected" : "Connect ESP32 (USB)"}
              </button>
              <div className="text-right">`;

code = code.replace(/<div className="flex items-center gap-4">\s*<div className="text-right">/, headerReplace);

// 4. Replace Right Column Panel with the PDF Table
const rightColumnRegex = /\{\/\* ALERTS \*\/\}([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*\);\s*\}/;

const newRightColumn = `
          {/* HIGH-ALTITUDE ANTI-DRONE SYSTEM DASHBOARD */}
          <Panel title="System Dashboard" icon={<Settings2 className="w-5 h-5" />} className="flex-1 flex flex-col h-full bg-slate-900 text-slate-100 border-slate-800 border-2">
            <div className="flex-1 overflow-auto rounded-lg border border-slate-700 bg-slate-800">
              <table className="w-full text-sm text-left text-slate-300">
                <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 border-b border-slate-700">
                  <tr>
                    <th colSpan={2} className="px-4 py-3 text-center font-bold tracking-widest text-slate-200">
                      HIGH-ALTITUDE ANTI-DRONE SYSTEM
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-700/50">
                    <td className="px-4 py-2.5 font-medium">Temperature</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">{data?.environment.temperature} °C</td>
                  </tr>
                  <tr className="border-b border-slate-700/50 bg-slate-800/30">
                    <td className="px-4 py-2.5 font-medium">Humidity</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">{data?.environment.humidity} %</td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="px-4 py-2.5 font-medium">Pressure</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">{data?.environment.pressure} hPa</td>
                  </tr>
                  <tr className="border-b border-slate-700/50 bg-slate-800/30">
                    <td className="px-4 py-2.5 font-medium">Wind Speed</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">{data?.motion.windSpeed} km/h</td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="px-4 py-2.5 font-medium">Fog Risk</td>
                    <td className="px-4 py-2.5 font-mono font-bold">
                      <span className={cn("px-2 py-0.5 rounded", data?.environment.fogRisk === 'HIGH' ? "bg-amber-500/20 text-amber-400" : "text-emerald-400")}>
                        {data?.environment.fogRisk}
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b border-slate-700/50 bg-slate-800/30">
                    <td className="px-4 py-2.5 font-medium">Thermal</td>
                    <td className="px-4 py-2.5 font-mono font-bold">
                      <span className={cn("px-2 py-0.5 rounded", data?.environment.thermal === 'ACTIVE' ? "bg-rose-500/20 text-rose-400" : "text-slate-400")}>
                        {data?.environment.thermal}
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="px-4 py-2.5 font-medium">Operating Mode</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-sky-400">{data?.environment.altitudeMode}</td>
                  </tr>
                  <tr className="border-b border-slate-700/50 bg-slate-800/30">
                    <td className="px-4 py-2.5 font-medium">Drone</td>
                    <td className="px-4 py-2.5 font-mono font-bold">
                      <span className={cn("px-2 py-0.5 rounded", (data?.targets?.length || 0) > 0 ? "bg-rose-500 text-white animate-pulse" : "bg-emerald-500/20 text-emerald-400")}>
                        {(data?.targets?.length || 0) > 0 ? 'DETECTED' : 'NONE'}
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="px-4 py-2.5 font-medium">Confidence</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">{((data?.system.confidence || 0) * 100).toFixed(0)} %</td>
                  </tr>
                  <tr className="border-b border-slate-700/50 bg-slate-800/30">
                    <td className="px-4 py-2.5 font-medium">Pan / Tilt</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">{data?.tracking.panAngle.toFixed(1)}° / {data?.tracking.tiltAngle.toFixed(1)}°</td>
                  </tr>
                  <tr className="border-b border-slate-700/50">
                    <td className="px-4 py-2.5 font-medium">Tracking</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-emerald-400">{data?.tracking.status}</td>
                  </tr>
                  <tr className="">
                    <td className="px-4 py-2.5 font-medium">Neutralization</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-amber-400">{data?.tracking.neutralization}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            <div className="mt-4 p-4 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-400 space-y-2">
              <p><strong className="text-slate-300">Architecture:</strong> Laptop AI (Python/React) ↔ ESP32 (C++)</p>
              <p><strong className="text-slate-300">Serial Telemetry:</strong> \`TEMP:-8 | HUMIDITY:88 | PRESSURE:650 | WIND:35 | ROLL:3 | PITCH:-2\`</p>
              <p><strong className="text-slate-300">Control Actions:</strong> Pan/Tilt adjustment sent to servos via PySerial/WebSerial based on Position Error and IMU compensation. Heaters automatically toggle based on env risks.</p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
`;

code = code.replace(rightColumnRegex, newRightColumn);

// Make sure to remove old UI components that reference data properties that changed or were removed
fs.writeFileSync('src/App.tsx', code);

