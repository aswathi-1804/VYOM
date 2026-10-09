const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  /                  <button \n                    onClick=\{\(\) => setMapOrientation\(o => o === 'North-Up' \? 'Dynamic' : 'North-Up'\)\}\n  \(o => o === 'North-Up' \? 'Dynamic' : 'North-Up'\)\}/g,
  "                  <button \n                    onClick={() => setMapOrientation(o => o === 'North-Up' ? 'Dynamic' : 'North-Up')}"
);

fs.writeFileSync('src/App.tsx', code);
