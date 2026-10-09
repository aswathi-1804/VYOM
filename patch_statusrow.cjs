const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// Update StatusRow interface and implementation
code = code.replace(
  "function StatusRow({ label, status, extra }: { label: string, status: string, extra?: React.ReactNode }) {",
  "function StatusRow({ label, status, extra, className }: { label: string, status: string, extra?: React.ReactNode, className?: string }) {"
);

code = code.replace(
  /<div className="flex justify-between items-center py-2\.5 border-b border-slate-100 last:border-0">/,
  '<div className={cn("flex justify-between items-center py-2.5 px-2 -mx-2 rounded border-b border-slate-100 last:border-0 transition-colors", className)}>'
);

// Update SENSOR HUB usage
const sensorHubReplacement = `
                <StatusRow 
                  label="SENSOR HUB" 
                  status={data.system.sensorStatus} 
                  className={sensorDrift > 25 ? "bg-rose-100/50 border-rose-300 animate-pulse" : ""}
                  extra={
`;

code = code.replace(
  /                <StatusRow \n                  label="SENSOR HUB" \n                  status=\{data\.system\.sensorStatus\} \n                  extra=\{/g,
  sensorHubReplacement.trimStart()
);

// We need to match if it doesn't have the `\n` perfectly. Let's do a more robust regex if needed.
fs.writeFileSync('src/App.tsx', code);
