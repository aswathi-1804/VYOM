const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

const offlineOverlay = `
              {/* Camera Offline Overlay */}
              {!cameraPower && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 bg-black z-50 pointer-events-none">
                  <Power className="w-12 h-12 mb-4 opacity-50" />
                  <span className="text-sm font-bold tracking-widest uppercase">Feed Offline</span>
                  <span className="text-xs mt-2 opacity-70">Camera powered down to save CPU resources.</span>
                </div>
              )}
`;

// Insert right after <div ref={feedRef}
code = code.replace(
  /<div ref=\{feedRef\} className="relative flex-1 bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center shadow-inner border border-slate-800 min-h-\[400px\]">/g,
  `<div ref={feedRef} className="relative flex-1 bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center shadow-inner border border-slate-800 min-h-[400px]">${offlineOverlay}`
);

// We need to remove the broken ternary I added earlier
code = code.replace(
  /              \{cameraPower \? \(\n                <>\n                  <video/g,
  "                  <video"
);

// We also need to remove the closing part of that broken ternary. 
// I actually didn't inject the closing part successfully last time (which is why I didn't see it). Let's verify if `<> ` is present.

fs.writeFileSync('src/App.tsx', code);
