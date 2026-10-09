const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
  "const newTargets = predictions.filter(pred => \\n          pred.class === 'airplane' || pred.class === 'bird' || pred.class === 'kite' || pred.class === 'drone'\\n        ).map((pred, idx) => {",
  "const newTargets = predictions.filter(pred => \\n          pred.score > 0.45 && (pred.class === 'airplane' || pred.class === 'bird' || pred.class === 'kite' || pred.class === 'drone')\\n        ).map((pred, idx) => {"
);

// Fallback if the whitespace is different
if (code.indexOf('pred.score > 0.45') === -1) {
  code = code.replace(
    /const newTargets = predictions\.filter\(pred =>\s*(pred\.class === 'airplane' \|\| pred\.class === 'bird' \|\| pred\.class === 'kite' \|\| pred\.class === 'drone')\s*\)\.map\(\(pred, idx\) => \{/,
    "const newTargets = predictions.filter(pred => pred.score > 0.45 && ($1)).map((pred, idx) => {"
  );
}

fs.writeFileSync('src/App.tsx', code);
