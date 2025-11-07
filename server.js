import express from "express";
import http from "http";
import { Server } from "socket.io";
import cookieParser from "cookie-parser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

let messages = [];
let bans = [];
let bannedWords = [];

// Auto-create required JSON files
const files = ["bans.json", "bannedwords.json"];
for (const f of files) if (!fs.existsSync(f)) fs.writeFileSync(f, "[]");

// Load bans and banned words
bans = JSON.parse(fs.readFileSync("bans.json", "utf-8"));
bannedWords = JSON.parse(fs.readFileSync("bannedwords.json", "utf-8"));

// Admin routes
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.get("/api/bans", (req, res) => res.json(bans));

app.post("/admin/unban", (req, res) => {
  const { id, password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).send("Invalid password");

  const unbanned = bans.find(b => b.cookie === id);
  bans = bans.filter(b => b.cookie !== id);
  fs.writeFileSync("bans.json", JSON.stringify(bans, null, 2));

  const unbanMsg = {
    username: "AutoMod",
    message: `${unbanned?.username || "A user"} has been unbanned by admin.`,
    system: true,
    type: "unban"
  };

  messages.push(unbanMsg);
  messages = messages.slice(-100);
  io.emit("chat message", unbanMsg);

  res.send("User unbanned");
});

// Socket.io
io.on("connection", socket => {
  const cookie = socket.handshake.headers.cookie || "";
  const idMatch = cookie.match(/uid=([^;]+)/);
  const id = idMatch ? idMatch[1] : socket.id;

  if (bans.find(b => b.cookie === id)) {
    socket.emit("banned", "You are banned.");
    socket.disconnect(true);
    return;
  }

  socket.emit("init history", messages.slice(-100));

  socket.on("chat message", msg => {
    if (!msg || !msg.message || !msg.username) return;

    if (bans.some(b => b.cookie === id)) return;

    const content = msg.message.trim().toLowerCase();

    if (bannedWords.some(w => content.includes(w.toLowerCase()))) {
      bans.push({ username: msg.username, reason: "Used banned word", cookie: id });
      fs.writeFileSync("bans.json", JSON.stringify(bans, null, 2));

      socket.emit("banned", "You were banned for using a banned word.");
      socket.disconnect(true);

      const banMsg = {
        username: "AutoMod",
        message: `${msg.username} was banned for using a banned word.`,
        system: true,
        type: "ban"
      };

      messages.push(banMsg);
      messages = messages.slice(-100);
      io.emit("chat message", banMsg);
      return;
    }

    messages.push(msg);
    messages = messages.slice(-100);
    io.emit("chat message", msg);
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
