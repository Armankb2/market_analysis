
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({
    path: require("path").resolve(__dirname, "../.env"),
  });
}

const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const aiService = require("./aiService");
const db = require("./db");
const { updateMarketData } = require("./marketDataService");

const app = express();
// Market data update status
const updateStatus = {
  running: false,
  lastStarted: null,
  lastCompleted: null,
  lastReport: null,
  lastError: null
};
app.use(cors());
app.use(express.json());

// Existing AI Chat API
app.post("/chat", async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const response = await aiService.processMessage(message, history || []);
    res.json(response);
  } catch (error) {
    console.error("Chat API Error:", error);
    res.status(500).json({
      error: "Internal Server Error",
      details: error.message,
    });
  }
});

// Dashboard summary API
app.get("/api/dashboard/summary", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        COUNT(*) AS totalRecords,
        COUNT(DISTINCT Symbol) AS totalAssets,
        MAX(Date) AS latestDate
      FROM market_data
    `);

    const [categories] = await db.query(`
      SELECT
        CASE
          WHEN LOWER(Type) = 'curreny' THEN 'Currency'
          ELSE Type
        END AS category,
        COUNT(DISTINCT Symbol) AS total
      FROM market_data
      GROUP BY category
    `);

    res.json({
      ...rows[0],
      categories,
    });
  } catch (error) {
    console.error("Summary API Error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard summary" });
  }
});

// Asset list API

app.get("/api/dashboard/assets", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        t.Symbol,
        t.Type,
        t.Logo,
        latest.Close,
        latest.Date
      FROM trackers t
      LEFT JOIN (
        SELECT m1.Symbol, m1.Close, m1.Date
        FROM market_data m1
        INNER JOIN (
          SELECT Symbol, MAX(Date) AS maxDate
          FROM market_data
          GROUP BY Symbol
        ) m2
          ON m1.Symbol = m2.Symbol
          AND m1.Date = m2.maxDate
      ) latest
        ON latest.Symbol = t.Symbol
      ORDER BY t.Type, t.Symbol
    `);

    res.json(rows);
  } catch (error) {
    console.error("Assets API Error:", error);
    res.status(500).json({ error: "Failed to fetch assets" });
  }
});


// Manual market data update API
app.post("/api/dashboard/update", async (req, res) => {
  if (updateStatus.running) {
    return res.status(409).json({
      message: "Market data update is already running.",
      status: updateStatus
    });
  }

  updateStatus.running = true;
  updateStatus.lastStarted = new Date();
  updateStatus.lastError = null;

  // Respond immediately; update continues in the background.
  res.status(202).json({
    message: "Market data update started.",
    status: updateStatus
  });

  try {
    const report = await updateMarketData();

    updateStatus.lastReport = report;
    updateStatus.lastCompleted = new Date();

    console.log("Market update completed:", report);

  } catch (error) {
    updateStatus.lastError = error.message;
    console.error("Market update failed:", error);

  } finally {
    updateStatus.running = false;
  }
});

// Market data update status API
app.get("/api/dashboard/update-status", (req, res) => {
  res.json(updateStatus);
});

// Historical price API
app.get("/api/dashboard/history/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol;

    const [rows] = await db.query(
      `SELECT Symbol, Date, Open, High, Low, Close, Volume
       FROM market_data
       WHERE Symbol = ?
       ORDER BY Date ASC`,
      [symbol]
    );

    res.json(rows);
  } catch (error) {
    console.error("History API Error:", error);
    res.status(500).json({ error: "Failed to fetch price history" });
  }
});

// Automatic daily market data update
cron.schedule(
  "0 2 * * *",
  async () => {
    if (updateStatus.running) {
      console.log("Scheduled update skipped: another update is running.");
      return;
    }

    console.log("Starting scheduled market data update...");

    updateStatus.running = true;
    updateStatus.lastStarted = new Date();
    updateStatus.lastError = null;

    try {
      const report = await updateMarketData();

      updateStatus.lastReport = report;
      updateStatus.lastCompleted = new Date();

      console.log("Scheduled update completed:", report);

    } catch (error) {
      updateStatus.lastError = error.message;
      console.error("Scheduled update failed:", error);

    } finally {
      updateStatus.running = false;
    }
  },
  {
    timezone: "Asia/Kolkata"
  }
);

console.log("Daily market update scheduled for 2:00 AM IST.");

const PORT = process.env.PORT || 5001;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
