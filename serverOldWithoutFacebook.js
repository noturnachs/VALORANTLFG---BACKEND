const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Pool } = require("pg");
const http = require("http");
const socketIo = require("socket.io");
const filter = require("leo-profanity");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL,
    methods: ["GET", "POST"],
  },
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

app.use(cors());
app.use(bodyParser.json());

app.get("/api/parties", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM parties WHERE is_deleted = FALSE"
    );
    if (result.rows.length === 0) {
      return res.status(200).json({ msg: "No parties found" });
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/parties", async (req, res) => {
  const { partyCode, description, serverTag, add_tags, rank, gamemode } =
    req.body;

  if (filter.check(partyCode) || filter.check(description)) {
    return res.status(400).json({ error: "Profanity is not allowed" });
  }

  if (partyCode.length > 6) {
    return res
      .status(400)
      .json({ error: "PartyCode must be 6 characters or less" });
  }

  try {
    const tags = Array.isArray(add_tags) ? add_tags : [];
    const result = await pool.query(
      "INSERT INTO parties (party_code, description, created_at, expired, server_tag, add_tags, rank, gamemode) VALUES ($1, $2, NOW() AT TIME ZONE 'UTC', FALSE, $3, $4, $5, $6) RETURNING *",
      [partyCode, description, serverTag, tags, rank, gamemode]
    );

    io.emit("newParty", result.rows[0]);

    setTimeout(async () => {
      await pool.query("UPDATE parties SET expired = TRUE WHERE id = $1", [
        result.rows[0].id,
      ]);
      io.emit("partyExpired", result.rows[0].id);
    }, 300000);

    setTimeout(async () => {
      await pool.query("UPDATE parties SET is_deleted = TRUE WHERE id = $1", [
        result.rows[0].id,
      ]);
      io.emit("partyDeleted", result.rows[0].id); // Optionally notify the frontend
    }, 3600000);

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

io.on("connection", (socket) => {
  console.log("a user connected");
  socket.on("disconnect", () => {
    console.log("user disconnected");
  });
});

const port = process.env.PORT || 5000;
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
