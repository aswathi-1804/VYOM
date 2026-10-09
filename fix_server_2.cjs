const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// The line "const primary = drones.find(d => d.id === primaryTargetId) || drones[0];" 
// will crash because drones[0] is undefined now that drones is empty.
// We need to provide a fallback object.

code = code.replace(
  'const primary = drones.find(d => d.id === primaryTargetId) || drones[0];',
  'const primary = drones.find(d => d.id === primaryTargetId) || { id: "none", x: 0, y: 0, conf: 0, bat: 0, model: "none", isHighPriority: false };'
);

fs.writeFileSync('server.ts', code);
