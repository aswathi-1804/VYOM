const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

const vars = `
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
  "  if (!data) {\n    return (",
  vars + "\n  if (!data) {\n    return ("
);

fs.writeFileSync('src/App.tsx', code);
