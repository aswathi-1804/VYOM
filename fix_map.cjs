const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

const transformLogic = `
  const mapRotation = useMemo(() => {
    if (mapOrientation === 'North-Up' || !data) return 0;
    const primaryVel = velocityRef.current[data.primaryTargetId] || { vx: 0, vy: 0 };
    if (primaryVel.vx === 0 && primaryVel.vy === 0) return 0;
    return Math.atan2(primaryVel.vy, primaryVel.vx) * (180 / Math.PI) + 90; // Align heading to 'Up'
  }, [mapOrientation, data]);

  const mapCenterOffset = useMemo(() => {
    if (!centerOnPrimary || !data || data.targets.length === 0) return { x: 0, y: 0 };
    const pt = data.targets.find(t => t.id === data.primaryTargetId) || data.targets[0];
    // Map grid is -150 to +150 relative bounds, so we offset by negative of target to center it.
    // X range -150 to 150 = 300 span. Container is 100%. So x/150 * 50% = relative offset.
    return {
      x: - (pt.x / 150) * 50,
      y: - (pt.y / 150) * 50
    };
  }, [centerOnPrimary, data]);

  const mapTransX = mapCenterOffset.x;
  const mapTransY = mapCenterOffset.y;
`;

// Replace existing mapRotation block and inject the rest
code = code.replace(
  /  const mapRotation = useMemo\(\(\) => \{[\s\S]*?    const primaryVel = velocityRef\.current\[data\.primaryTargetId\] \|\| \{ vx: 0, vy: 0 \};[\s\S]*?    return Math\.atan2\(primaryVel\.vy, primaryVel\.vx\) \* \(180 \/ Math\.PI\) \+ 90; \/\/ Align heading to 'Up'\n  \}, \[mapOrientation, data\]\);/g,
  transformLogic.trim()
);

fs.writeFileSync('src/App.tsx', code);
