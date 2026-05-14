#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <ESP8266HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

// ---------- USER CONFIG ----------
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// Example:
// const char* API_BASE = "https://your-app.onrender.com";
// For local testing (no HTTPS):
// const char* API_BASE = "http://192.168.1.10:3000";
// IMPORTANT: keep this WITHOUT trailing slash
const char* API_BASE = "https://YOUR_RENDER_APP.onrender.com";
// --------------------------------

// Hardware
#define DHTPIN D5
#define DHTTYPE DHT11

// LCD I2C (SCL=D1, SDA=D2) Address 0x27
LiquidCrystal_I2C lcd(0x27, 16, 2);
DHT dht(DHTPIN, DHTTYPE);

String lcdText = "";

void serialLog(const String &msg) {
  Serial.println(msg);
}

void lcdTwoLines(const String &line1, const String &line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1);
  lcd.setCursor(0, 1);
  lcd.print(line2);
}

void showConnecting() {
  lcdTwoLines("CONNECTING TO", "WIFI..........");
}

void showConnected() {
  lcdTwoLines("CONNECTED TO", "WIFI");
}

void showWelcome() {
  lcdTwoLines("-- WELCOME --", "SISTEC IoT");
}

void showTemperature(float t) {
  lcdTwoLines("TEMPERATURE", String((int)t) + " 'C");
}

void showHumidity(float h) {
  lcdTwoLines("HUMIDITY", String((int)h) + " %");
}

void showCustomText(const String &t) {
  String s = t;
  if (s.length() > 16) s = s.substring(0, 16);
  lcdTwoLines("SISTEC DISPLAY", s);
}

void showSending() {
  lcdTwoLines("SENDING DATA TO", "WEB SERVER....");
}

void showSent() {
  lcdTwoLines("DATA SENT..!!", "");
}

String httpGetText(const String &url) {
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure(); // beginner-friendly: skip certificate validation

  serialLog("GET " + url);
  if (url.startsWith("http://")) {
    WiFiClient plain;
    if (!http.begin(plain, url)) return "";
  } else {
    if (!http.begin(client, url)) return "";
  }

  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  int code = http.GET();
  String payload = "";
  if (code > 0) payload = http.getString();
  serialLog("GET code: " + String(code));
  http.end();
  payload.trim();
  if (payload.length() > 16) payload = payload.substring(0, 16);
  serialLog("GET payload: [" + payload + "]");
  return payload;
}

bool httpSendSensor(float t, float h) {
  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure(); // beginner-friendly

  String base = String(API_BASE);
  if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
  String url = base + "/api/sensors/save";

  serialLog("POST " + url);
  if (url.startsWith("http://")) {
    WiFiClient plain;
    if (!http.begin(plain, url)) return false;
  } else {
    if (!http.begin(client, url)) return false;
  }

  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"temperature\":" + String(t, 1) + ",\"humidity\":" + String(h, 1) + ",\"timestamp\":" + String((unsigned long)millis()) + "}";
  int code = http.POST(body);
  serialLog("POST code: " + String(code));
  http.end();
  return code > 0 && code < 400;
}

void setup() {
  Serial.begin(115200);
  serialLog("Booting...");

  Wire.begin(D2, D1); // SDA, SCL
  lcd.init();
  lcd.backlight();
  dht.begin();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  showConnecting();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }

  showConnected();
  delay(2000);
  showWelcome();
  delay(2000);
}

void loop() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (isnan(h) || isnan(t)) {
    lcdTwoLines("DHT11 ERROR", "CHECK WIRING");
    delay(2000);
    return;
  }

  // Fetch LCD text every cycle
  String base = String(API_BASE);
  if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
  lcdText = httpGetText(base + "/api/lcd/fetch");
  if (lcdText.length() == 0) lcdText = "FETCH FAIL";

  // LCD rotating screens (timings per requirement)
  showTemperature(t);
  delay(2000);

  showHumidity(h);
  delay(2000);

  showCustomText(lcdText);
  delay(3000);

  showSending();
  bool ok = httpSendSensor(t, h);
  (void)ok;

  showSent();
  delay(1000);
}

