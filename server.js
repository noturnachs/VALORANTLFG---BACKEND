const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Pool } = require("pg");
const http = require("http");
const socketIo = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL, // Change this to your client URL
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
    const result = await pool.query("SELECT * FROM parties");
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
  const { partyCode, description } = req.body;

  if (partyCode.length > 6) {
    return res
      .status(400)
      .json({ error: "PartyCode must be 6 characters or less" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO parties (party_code, description, created_at, expired) VALUES ($1, $2, NOW() AT TIME ZONE 'UTC', FALSE) RETURNING *",
      [partyCode, description]
    );

    setTimeout(async () => {
      try {
        await pool.query("UPDATE parties SET expired = TRUE WHERE id = $1", [
          result.rows[0].id,
        ]);
        console.log(
          `Party ${result.rows[0].id} with code: ${result.rows[0].party_code} has been set to expired`
        );

        // Emit event to all connected clients
        io.emit("partyExpired", result.rows[0].id);
      } catch (err) {
        console.error(
          `Failed to update party ${result.rows[0].id} with code: ${result.rows[0].party_code} to expired`,
          err
        );
      }
    }, 300000);

    res.json(result.rows[0]);
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
