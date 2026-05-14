const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, "database.sqlite");
const LCD_PATH = process.env.LCD_PATH || path.join(__dirname, "lcd.txt");

// Render/Proxies: trust X-Forwarded-* headers
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "sistec-iot-application-2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);

function ensureLcdFile() {
  try {
    if (!fs.existsSync(LCD_PATH)) fs.writeFileSync(LCD_PATH, "WELCOME SISTEC\n", "utf8");
  } catch (e) {
    // ignore
  }
}

function toISTParts(date) {
  try {
    const d = date instanceof Date ? date : new Date(Number(date));
    if (Number.isNaN(d.getTime())) return { dateStr: "--", timeStr: "--" };

    const dateFmt = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const timeFmt = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const parts = dateFmt.formatToParts(d);
    const map = {};
    for (const p of parts) {
      if (p.type !== "literal") map[p.type] = p.value;
    }
    const day = map.day;
    const month = map.month;
    const year = map.year;
    if (!day || !month || !year) return { dateStr: "--", timeStr: "--" };
    const dateStr = `${day}-${month}-${year}`;
    const timeStr = timeFmt.format(d);
    return { dateStr, timeStr };
  } catch (e) {
    return { dateStr: "--", timeStr: "--" };
  }
}

function formatSensorValue(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return n.toFixed(1);
}

const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at_utc INTEGER NOT NULL
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS sensor_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temperature REAL NOT NULL,
      humidity REAL NOT NULL,
      timestamp_utc INTEGER NOT NULL
    )`
  );

  // Demo user for quick login (created only if missing)
  db.run(
    `INSERT OR IGNORE INTO users (name, email, password, created_at_utc)
     VALUES (?, ?, ?, ?)`,
    ["SISTec Admin", "admin@sistec.com", "1234", Date.now()]
  );
});

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/");
  next();
}

function readHtml(fileName) {
  return fs.readFileSync(path.join(__dirname, fileName), "utf8");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderTemplate(html, vars) {
  let out = html;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, String(v));
  }
  return out;
}

app.get("/", (req, res) => {
  if (req.session?.user) return res.redirect("/dashboard");
  res.type("html").send(readHtml("index.html"));
});

app.get("/register", (req, res) => {
  if (req.session?.user) return res.redirect("/dashboard");
  res.type("html").send(readHtml("register.html"));
});

app.post("/register", (req, res) => {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const password = (req.body.password || "").trim();

  if (!name || !email || !password) return res.status(400).send("All fields are required.");

  db.run(
    `INSERT INTO users (name, email, password, created_at_utc) VALUES (?, ?, ?, ?)`,
    [name, email, password, Date.now()],
    (err) => {
      if (err) return res.status(400).send("User already exists or invalid data.");
      res.redirect("/");
    }
  );
});

app.post("/login", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = (req.body.password || "").trim();

  if (!email || !password) return res.status(400).send("Email and password are required.");

  db.get(`SELECT id, name, email FROM users WHERE email = ? AND password = ?`, [email, password], (err, row) => {
    if (err) return res.status(500).send("Server error.");
    if (!row) return res.status(401).send("Invalid email or password.");
    req.session.user = row;
    res.redirect("/dashboard");
  });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/dashboard", requireAuth, (req, res) => {
  const user = req.session.user;

  db.all(`SELECT id, temperature, humidity, timestamp_utc FROM sensor_records ORDER BY id DESC`, (err, rows) => {
    if (err) return res.status(500).send("DB error.");

    const latest = rows[0] || null;
    const latestTemp = latest ? formatSensorValue(latest.temperature) : "--";
    const latestHum = latest ? formatSensorValue(latest.humidity) : "--";
    const latestTime = latest ? toISTParts(latest.timestamp_utc).timeStr : "--";
    const latestDate = latest ? toISTParts(latest.timestamp_utc).dateStr : "--";

    const tableRows = rows
      .map((r, idx) => {
        const { dateStr, timeStr } = toISTParts(r.timestamp_utc);
        return `
          <tr class="border-b border-white/10 text-white/90 hover:bg-white/5">
            <td class="p-3">${escapeHtml(rows.length - idx)}</td>
            <td class="p-3">${escapeHtml(formatSensorValue(r.temperature))}</td>
            <td class="p-3">${escapeHtml(formatSensorValue(r.humidity))}</td>
            <td class="p-3">${escapeHtml(timeStr)}</td>
            <td class="p-3">${escapeHtml(dateStr)}</td>
            <td class="p-3">
              <form method="POST" action="/records/delete" onsubmit="return confirm('Delete this record?');">
                <input type="hidden" name="id" value="${escapeHtml(r.id)}" />
                <button class="bg-red-600/90 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold" type="submit">Delete</button>
              </form>
            </td>
          </tr>
        `.trim();
      })
      .join("\n");

    ensureLcdFile();
    const lcdText = fs.readFileSync(LCD_PATH, "utf8").trim().slice(0, 16);

    const html = readHtml("dashboard.html");
    res.type("html").send(
      renderTemplate(html, {
        username: escapeHtml(user.name),
        latestTemperature: escapeHtml(latestTemp),
        latestHumidity: escapeHtml(latestHum),
        latestTime: escapeHtml(latestTime),
        latestDate: escapeHtml(latestDate),
        lcdCurrentText: escapeHtml(lcdText),
        recordsRows:
          tableRows ||
          `<tr><td class="p-3 text-white/70 border-b border-white/10" colspan="6">No records yet.</td></tr>`,
      })
    );
  });
});

app.post("/lcd", requireAuth, (req, res) => {
  ensureLcdFile();
  const text = String(req.body.lcdText || "").slice(0, 16);
  fs.writeFileSync(LCD_PATH, text + "\n", "utf8");
  res.redirect("/dashboard");
});

app.post("/records/delete", requireAuth, (req, res) => {
  const id = Number(req.body.id);
  if (!Number.isFinite(id)) return res.status(400).send("Invalid id.");
  db.run(`DELETE FROM sensor_records WHERE id = ?`, [id], () => res.redirect("/dashboard"));
});

// One-click test row when hardware / API is not sending data yet
app.post("/seed-demo-reading", requireAuth, (req, res) => {
  const now = Date.now();
  db.run(
    `INSERT INTO sensor_records (temperature, humidity, timestamp_utc) VALUES (?, ?, ?)`,
    [25.0, 55.0, now],
    (err) => {
      if (err) return res.status(500).send("DB error.");
      res.redirect("/dashboard");
    }
  );
});

// Latest reading + current IST time + full records (for Refresh button)
app.get("/api/sensors/latest", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  db.all(`SELECT id, temperature, humidity, timestamp_utc FROM sensor_records ORDER BY id DESC`, (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: "db error" });

    const now = Date.now();
    const nowIST = toISTParts(now);

    const latestRow = rows[0] || null;
    const records = rows.map((r) => {
      const { dateStr, timeStr } = toISTParts(r.timestamp_utc);
      return {
        id: r.id,
        temperature: formatSensorValue(r.temperature),
        humidity: formatSensorValue(r.humidity),
        time: timeStr,
        date: dateStr,
      };
    });

    return res.json({
      ok: true,
      latest: latestRow
        ? {
            id: latestRow.id,
            temperature: formatSensorValue(latestRow.temperature),
            humidity: formatSensorValue(latestRow.humidity),
            timestamp_utc: latestRow.timestamp_utc,
          }
        : null,
      now: { timestamp_utc: now, time: nowIST.timeStr, date: nowIST.dateStr },
      records,
    });
  });
});

// API 1: ESP8266 sends temperature, humidity, timestamp
app.all("/api/sensors/save", (req, res) => {
  const src = req.method === "GET" ? req.query : req.body;
  const temperature = Number(src.temperature);
  const humidity = Number(src.humidity);
  const timestamp = src.timestamp ? Number(src.timestamp) : Date.now();

  if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) {
    return res.status(400).json({ ok: false, error: "temperature and humidity are required numbers" });
  }

  const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
  db.run(
    `INSERT INTO sensor_records (temperature, humidity, timestamp_utc) VALUES (?, ?, ?)`,
    [temperature, humidity, ts],
    (err) => {
      if (err) return res.status(500).json({ ok: false, error: "db error" });
      res.json({ ok: true });
    }
  );
});

// API 2: ESP8266 fetches LCD text (max 16 chars)
app.get("/api/lcd/fetch", (req, res) => {
  ensureLcdFile();
  let text = "";
  try {
    text = fs.readFileSync(LCD_PATH, "utf8").trim();
  } catch (e) {
    text = "";
  }
  res.type("text").send(text.slice(0, 16));
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, HOST, () => {
  ensureLcdFile();
  console.log(`Server running on http://${HOST}:${PORT}`);
});

