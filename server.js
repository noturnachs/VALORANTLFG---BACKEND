const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Pool } = require("pg");
const http = require("http");
const socketIo = require("socket.io");
const filter = require("leo-profanity");
const puppeteer = require("puppeteer");
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

let browser, page;

const initializeBrowser = async () => {
  browser = await puppeteer.launch({
    executablePath:
      process.env.NODE_ENV === "production"
        ? process.env.PUPPETEER_EXECUTABLE_PATH
        : puppeteer.executablePath(),
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-notifications",
      // "--single-process",
      // "--no-zygote",
    ],
  });
  page = await browser.newPage();
  await page.goto(
    "https://www.facebook.com/groups/valorantph/?sorting_setting=",
    {
      waitUntil: "networkidle2",
    }
  );

  const emailSelector = 'input[name="email"]';
  await page.waitForSelector(emailSelector);

  // Wait for a random amount of time (between 1 and 3 seconds)
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        setTimeout(resolve, Math.floor(Math.random() * 2000) + 1000)
      )
  );

  await page.type(emailSelector, "61550098922225");

  const passwordSelector = 'input[name="pass"]';
  await page.waitForSelector(passwordSelector);

  // Wait for a random amount of time (between 1 and 3 seconds) before typing password
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        setTimeout(resolve, Math.floor(Math.random() * 2000) + 1000)
      )
  );
  await page.type(passwordSelector, "$DANdan2003$");

  // Wait for a random amount of time (between 1 and 3 seconds) before typing password
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        setTimeout(resolve, Math.floor(Math.random() * 2000) + 1000)
      )
  );

  const loginButtonSelector = 'button[id="loginbutton"]';
  await page.waitForSelector(loginButtonSelector);
  await page.click(loginButtonSelector);

  // Wait until the page is fully loaded
  await page.waitForNavigation({ waitUntil: "networkidle2" });
};

const scrapeFacebookPosts = async () => {
  try {
    const scrapePosts = async () => {
      return await page.evaluate(() => {
        return Array.from(document.querySelectorAll('div[dir="auto"].html-div'))
          .map((post) => post.innerText)
          .filter((text) => text.trim().length > 0);
      });
    };

    const allPosts = new Set();
    const maxPosts = 20;
    const scrollTimes = 10;

    for (let i = 0; i < scrollTimes; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });

      const previousHeight = await page.evaluate("document.body.scrollHeight");
      await page.waitForFunction(
        `document.body.scrollHeight > ${previousHeight}`
      );

      const posts = await scrapePosts();
      posts.forEach((post) => allPosts.add(post));

      if (allPosts.size >= maxPosts) {
        break;
      }
    }

    const postsArray = Array.from(allPosts);
    console.log("Scraped posts:", postsArray);

    return postsArray;
  } catch (error) {
    console.error("Error occurred:", error);
    return [];
  }
};

app.get("/api/posts", async (req, res) => {
  try {
    // Refresh the page
    await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
    const posts = await scrapeFacebookPosts();
    res.json(posts);
  } catch (error) {
    console.error("Failed to scrape posts:", error);
    res.json([]);
  }
});

const port = process.env.PORT || 5000;
server.listen(port, async () => {
  console.log(`Server is running on port ${port}`);
  await initializeBrowser();
});
