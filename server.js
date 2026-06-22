require("dotenv").config();

const express = require("express");
const cors = require("cors");

const pool = require("./db");

const app = express();

const authRoutes =
require("./routes/auth");

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "Mylikith",
    status: "Running"
  });
});

app.get("/api/novels", async (req, res) => {
  try {

    const result = await pool.query(
      "SELECT * FROM novels ORDER BY id DESC"
    );

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Failed to load novels"
    });

  }
});

app.get("/api/novels/:id", async (req, res) => {
  try {

    const result = await pool.query(
      "SELECT * FROM novels WHERE id=$1",
      [req.params.id]
    );

    res.json(result.rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Failed to load novel"
    });

  }
});

app.get("/api/chapters/:id", async (req, res) => {
  try {

    const result = await pool.query(
      "SELECT * FROM chapters WHERE id=$1",
      [req.params.id]
    );

    res.json(result.rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Failed to load chapter"
    });

  }
});

const PORT = process.env.PORT || 5000;

app.get("/api/debug-users-columns", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json(err.message);
  }
});

app.get("/api/debug-db", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT current_database(), current_schema()
    `);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json(err.message);
  }
});

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});

