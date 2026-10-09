const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

const buttonHtml = `
          <button 
            onClick={handleConnectHardware}
            className={cn("flex items-center gap-2 px-3 py-1.5 border rounded-full text-xs font-bold uppercase transition-colors", 
              isSerialConnected ? "bg-emerald-500 text-white border-emerald-600" : "bg-slate-800 text-white border-slate-700")}
          >
            <Server className="w-4 h-4" />
            {isSerialConnected ? "ESP32 (USB)" : "Connect ESP32 (USB)"}
          </button>
          <div className="text-right">`;

code = code.replace(/<div className="text-right">/, buttonHtml);

// I need to change isConnected condition to look at isSerialConnected or default true if we are mocking
code = code.replace(/isConnected \? 'Live Connection' : 'Disconnected'/g, "isSerialConnected ? 'Hardware Live' : 'Hardware Disconnected'");
code = code.replace(/isConnected \? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-rose-50 text-rose-700 border-rose-100"/g, "isSerialConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-100'");
code = code.replace(/isConnected \? "bg-emerald-500 animate-pulse" : "bg-rose-500"/g, "isSerialConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'");

fs.writeFileSync('src/App.tsx', code);
