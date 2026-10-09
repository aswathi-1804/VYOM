const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

const simLoop = `
  // Simulate sensor fluctuations when hardware is disconnected
  useEffect(() => {
    if (isSerialConnected) return;
    const interval = setInterval(() => {
      setSensorData(prev => {
        let temp = prev.TEMP + (Math.random() - 0.5) * 1.5;
        if (temp < -15) temp = -15;
        if (temp > 30) temp = 30;

        let humidity = prev.HUMIDITY + (Math.random() - 0.5) * 2;
        if (humidity > 95) humidity = 95;
        if (humidity < 20) humidity = 20;

        let pressure = prev.PRESSURE + (Math.random() - 0.5) * 10;
        if (pressure < 600) pressure = 600;
        if (pressure > 1020) pressure = 1020;

        let wind = prev.WIND + (Math.random() - 0.5) * 5;
        if (wind < 0) wind = 0;
        if (wind > 60) wind = 60;

        let roll = (Math.random() - 0.5) * (wind / 10);
        let pitch = (Math.random() - 0.5) * (wind / 10);

        return {
          TEMP: Math.round(temp * 10) / 10,
          HUMIDITY: Math.round(humidity),
          PRESSURE: Math.round(pressure),
          WIND: Math.round(wind),
          ROLL: Math.round(roll * 10) / 10,
          PITCH: Math.round(pitch * 10) / 10
        };
      });
    }, 100);
    return () => clearInterval(interval);
  }, [isSerialConnected]);

  useEffect(() => {
    if (!sessionStartTime) setSessionStartTime(Date.now());
`;

code = code.replace(/useEffect\(\(\) => \{\s*if \(!sessionStartTime\) setSessionStartTime\(Date\.now\(\)\);/, simLoop);

fs.writeFileSync('src/App.tsx', code);
