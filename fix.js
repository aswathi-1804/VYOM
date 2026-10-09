const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const replacement = `  // Audio alert effect
  useEffect(() => {
    if (!data) return;
    const hasBatteryAlert = data.targets.some(t => t.battery < 15);
    const hasAlert = hasBatteryAlert || data.motion.disturbance === 'HIGH' || data.environment.altitude > 100 || data.system.confidence < 0.5;

    setPersistentAlerts(prev => {
      let changed = false;
      const newAlerts = [...prev];
      const now = Date.now();

      const addAlert = (id, message, type) => {
        const idx = newAlerts.findIndex(a => a.id === id);
        if (idx >= 0) {
          if (now - (newAlerts[idx].timestamp || 0) > 1000) {
            newAlerts[idx].timestamp = now;
            changed = true;
          }
        } else {
          newAlerts.push({ id, message, type, timestamp: now });
          changed = true;
        }
      };

      if (hasBatteryAlert) {
        data.targets.filter(t => t.battery < 15).forEach(t => {
          if (!newAlerts.some(a => a.id === \`bat-\${t.id}\`)) {
            newAlerts.push({ id: \`bat-\${t.id}\`, message: \`CRITICAL: \${t.id} Battery below 15%\`, type: 'error' });
            changed = true;
          }
        });
      }

      if (data.tracking.neutralization === 'SIMULATED') addAlert('neutralization', 'Neutralization Simulated Successfully', 'success');
      if (data.motion.disturbance === 'HIGH') addAlert('disturbance', 'High wind disturbance detected', 'warning');
      if (data.tracking.status === 'LOCKED') addAlert('locked', 'Target locked centered', 'success');
      else addAlert('tracking', 'Adjusting pan-tilt to target', 'info');
      if (data.environment.altitudeMode === 'HIGH-ALTITUDE MODE') addAlert('altitude', 'High altitude parameters active', 'warning');
      if (data.environment.thermal === 'ACTIVE') addAlert('thermal', 'Thermal protection engaged', 'info');
      if (data.environment.fogRisk === 'HIGH') addAlert('fog', 'Lens defogging engaged', 'warning');

      return changed ? newAlerts : prev;
    });`;

const regex = /\/\/ Audio alert effect[\s\S]*?(?=    if \(hasAlert && !prevAlertState\.current && !isMuted\))/;
code = code.replace(regex, replacement + '\n\n');
fs.writeFileSync('src/App.tsx', code);
