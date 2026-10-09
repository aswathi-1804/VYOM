const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// We want to clear out the drones array so it doesn't send mock targets
const replacement = `  const drones: any[] = [];`;

code = code.replace(
  /const drones = \[\s*\{.*?\},\s*\{.*?\},\s*\{.*?\}\s*\];/,
  replacement
);

fs.writeFileSync('server.ts', code);
