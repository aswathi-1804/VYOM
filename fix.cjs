const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  'const prevPosRef = useRef<{ [key: string]: { x: number, y: number } }>({});',
  'const prevPosRef = useRef<{ [key: string]: { x: number, y: number } }>({});\n  const lastKnownGpsRef = useRef<{lat: number, lng: number} | null>(null);'
);

const telemetryReplace = `    socket.on('telemetry', (incomingData: TelemetryData) => {
      if (hasCameraRef.current) {
        incomingData.targets = liveTargetsRef.current;
        if (liveTargetsRef.current.length > 0) {
          incomingData.primaryTargetId = liveTargetsRef.current[0].id;
          incomingData.droneDetails.gps.lat = liveTargetsRef.current[0].gps.lat;
          incomingData.droneDetails.gps.lng = liveTargetsRef.current[0].gps.lng;
          lastKnownGpsRef.current = { lat: liveTargetsRef.current[0].gps.lat, lng: liveTargetsRef.current[0].gps.lng };
        } else {
          incomingData.primaryTargetId = '';
          if (lastKnownGpsRef.current) {
            incomingData.droneDetails.gps.lat = lastKnownGpsRef.current.lat;
            incomingData.droneDetails.gps.lng = lastKnownGpsRef.current.lng;
          } else {
            incomingData.droneDetails.gps.lat = BASE_LAT;
            incomingData.droneDetails.gps.lng = BASE_LNG;
          }
        }
      }`;

const telemetryRegex = /    socket\.on\('telemetry', \(incomingData: TelemetryData\) => \{\s*if \(hasCameraRef\.current\) \{\s*incomingData\.targets = liveTargetsRef\.current;\s*if \(liveTargetsRef\.current\.length > 0\) \{\s*incomingData\.primaryTargetId = liveTargetsRef\.current\[0\]\.id;\s*\} else \{\s*incomingData\.primaryTargetId = '';\s*\}\s*\}/;

code = code.replace(telemetryRegex, telemetryReplace);
fs.writeFileSync('src/App.tsx', code);
