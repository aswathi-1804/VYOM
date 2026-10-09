const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Fix calculateDistance return
code = code.replace(
  "  if (d > 1000) \n  const DRIFT_LIMIT = 500;\n  \n  let mapOffsetX = 0;\n  let mapOffsetY = 0;\n  if (centerOnPrimary && data?.primaryTargetId) {\n    const pt = (scrubIndex !== null && history[scrubIndex]?.targets ? history[scrubIndex].targets : data.targets).find((t: any) => t.id === data.primaryTargetId);\n    if (pt) {\n      const leftPerc = ((pt.gps.lng - (-122.4194)) / 0.00005) + 50;\n      const topPerc = ((pt.gps.lat - 37.7749) / 0.00005) + 50;\n      mapOffsetX = 50 - leftPerc;\n      mapOffsetY = 50 - topPerc;\n    }\n  }\n\n  const hasDriftWarning = sensorDrift > DRIFT_LIMIT;\n\n  return (d/1000).toFixed(2) + ' km';",
  "  if (d > 1000) return (d/1000).toFixed(2) + ' km';"
);

// 2. Fix the corrupted button
code = code.replace(
  "onClick={() => setMapOrientation(o => o === 'North-Up' ? 'Dynamic' : 'North-Up')}(o => o === 'North-Up' ? 'Dynamic' : 'North-Up')}",
  "onClick={() => setMapOrientation(o => o === 'North-Up' ? 'Dynamic' : 'North-Up')}"
);

// 3. Let's put the DRIFT_LIMIT and mapOffsetX logic in the right place!
// It should be right before the main `return (` of the `App` component.
// The main return is `return (\n    <div className="flex items-center justify-center h-screen bg-slate-50 text-slate-900 font-sans">\n` no wait, it's `return (\n      <div className="flex flex-col h-screen bg-slate-900 text-slate-100 font-sans overflow-hidden">\n`
// Let's check `App.tsx` for `return (` around line 705

fs.writeFileSync('src/App.tsx', code);
