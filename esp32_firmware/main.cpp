#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <MPU6050_tockn.h>
#include <ESP32Servo.h>

// I2C Pins for ESP32
#define I2C_SDA 21
#define I2C_SCL 22

// Hardware Components
Adafruit_BME280 bme;
MPU6050 mpu6050(Wire);

Servo panServo;
Servo tiltServo;

// Pins
const int panPin = 18;
const int tiltPin = 19;
const int thermalHeaterPin = 25; // MOSFET/Relay for battery/system heating pad
const int lensHeaterPin = 26;    // MOSFET/Relay for lens defogging
const int anemometerPin = 34;    // Analog input from wind sensor

// State Variables
float temperature = 0.0;
float humidity = 0.0;
float pressure = 0.0;
float windSpeed = 0.0;
float roll = 0.0;
float pitch = 0.0;

bool fogRiskHigh = false;
bool thermalRiskHigh = false;

// Pan/Tilt state
int currentPan = 90;
int currentTilt = 90;

unsigned long lastTelemetryTime = 0;
const long telemetryInterval = 500; // ms

void setup() {
  Serial.begin(115200);
  Wire.begin(I2C_SDA, I2C_SCL);

  // Initialize Sensors
  if (!bme.begin(0x76)) {
    Serial.println("Could not find a valid BME280 sensor, check wiring!");
  }
  
  mpu6050.begin();
  mpu6050.calcGyroOffsets(true);

  // Initialize Servos
  panServo.attach(panPin);
  tiltServo.attach(tiltPin);
  panServo.write(currentPan);
  tiltServo.write(currentTilt);

  // Initialize Heaters
  pinMode(thermalHeaterPin, OUTPUT);
  pinMode(lensHeaterPin, OUTPUT);
  digitalWrite(thermalHeaterPin, LOW);
  digitalWrite(lensHeaterPin, LOW);
}

void loop() {
  mpu6050.update();
  
  // 1. Read Environmental Sensors
  temperature = bme.readTemperature();
  humidity = bme.readHumidity();
  pressure = bme.readPressure() / 100.0F; // hPa
  
  // Read Anemometer (Simulated mapping from analog read)
  int windRaw = analogRead(anemometerPin);
  windSpeed = map(windRaw, 0, 4095, 0, 100); // km/h mapping (adjust based on specific sensor)
  
  // Read IMU
  roll = mpu6050.getAngleX();
  pitch = mpu6050.getAngleY();

  // 2. Local Environment Control Logic
  // Thermal Management
  if (temperature < 0.0) {
    thermalRiskHigh = true;
    digitalWrite(thermalHeaterPin, HIGH); // Turn ON system heater
  } else if (temperature > 5.0) {
    thermalRiskHigh = false;
    digitalWrite(thermalHeaterPin, LOW);
  }

  // Defogging Management
  // Simple dew point heuristic: high humidity and low temp
  if (humidity > 80.0 && temperature < 10.0) {
    fogRiskHigh = true;
    digitalWrite(lensHeaterPin, HIGH); // Turn ON lens heater
  } else if (humidity < 70.0) {
    fogRiskHigh = false;
    digitalWrite(lensHeaterPin, LOW);
  }

  // 3. Send Telemetry to Laptop AI
  if (millis() - lastTelemetryTime > telemetryInterval) {
    Serial.print("TEMP:"); Serial.print(temperature);
    Serial.print(",HUMIDITY:"); Serial.print(humidity);
    Serial.print(",PRESSURE:"); Serial.print(pressure);
    Serial.print(",WIND:"); Serial.print(windSpeed);
    Serial.print(",ROLL:"); Serial.print(roll);
    Serial.print(",PITCH:"); Serial.println(pitch);
    lastTelemetryTime = millis();
  }

  // 4. Receive Tracking Commands from Laptop AI
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    // Parse command e.g., "PAN:10,TILT:-5"
    int panIdx = command.indexOf("PAN:");
    int tiltIdx = command.indexOf("TILT:");
    
    if (panIdx != -1 && tiltIdx != -1) {
      int commaIdx = command.indexOf(',', panIdx);
      String panStr = command.substring(panIdx + 4, commaIdx);
      String tiltStr = command.substring(tiltIdx + 5);
      
      int deltaPan = panStr.toInt();
      int deltaTilt = tiltStr.toInt();
      
      // Update servo positions with constraints
      currentPan = constrain(currentPan - deltaPan, 0, 180); // Subtracted because standard camera mount orientation
      currentTilt = constrain(currentTilt + deltaTilt, 0, 180);
      
      panServo.write(currentPan);
      tiltServo.write(currentTilt);
    }
  }
}
