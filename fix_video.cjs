const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  /videoRef\.current\.srcObject = stream;\n\s*videoRef\.current\.play\(\);/,
  `videoRef.current.srcObject = stream;\n            const playPromise = videoRef.current.play();\n            if (playPromise !== undefined) {\n              playPromise.catch(e => console.log('Video play interrupted:', e));\n            }`
);

fs.writeFileSync('src/App.tsx', code);
