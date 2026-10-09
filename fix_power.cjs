const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

const detectLogic = `
  useEffect(() => {
    let animationId: number;
    async function detectFrame() {
`;

const detectEnd = `
      }
      animationId = requestAnimationFrame(detectFrame);
    }
    
    if (model && cameraPower) {
      detectFrame();
    } else {
      liveTargetsRef.current = []; // Clear targets when offline
    }
    
    return () => cancelAnimationFrame(animationId);
  }, [model, cameraPower]);
`;

code = code.replace(
  /  useEffect\(\(\) => \{\n    let animationId: number;\n    async function detectFrame\(\) \{/g,
  detectLogic.trimStart()
);

code = code.replace(
  /      \}\n      animationId = requestAnimationFrame\(detectFrame\);\n    \}\n    \n    if \(model\) \{\n      detectFrame\(\);\n    \}\n    \n    return \(\) => cancelAnimationFrame\(animationId\);\n  \}, \[model\]\);/g,
  detectEnd.trimStart()
);

fs.writeFileSync('src/App.tsx', code);
