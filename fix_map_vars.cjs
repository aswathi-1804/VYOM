const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  /translate\(\$\{mapTransX\}%, \$\{mapTransY\}%\)/g,
  'translate(${mapOffsetX}%, ${mapOffsetY}%)'
);

fs.writeFileSync('src/App.tsx', code);
