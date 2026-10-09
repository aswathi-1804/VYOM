const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /<StatusRow\s+label="SENSOR HUB"\s+status=\{data\.system\.sensorStatus\}\s+extra=\{/;
code = code.replace(
  regex,
  '<StatusRow label="SENSOR HUB" status={data.system.sensorStatus} className={sensorDrift > 25 ? "bg-rose-100/80 shadow-[inset_0_0_0_1px_rgba(244,63,94,0.5)] animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]" : ""} extra={'
);

fs.writeFileSync('src/App.tsx', code);
