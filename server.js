import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_ID = process.env.ADMIN_ID; // only this user can execute admin commands

// Paths
const BANNED_WORDS_FILE = path.join(__dirname, "bannedwords.json");
const BANS_FILE = path.join(__dirname, "ban.json");
const MESSAGES_FILE = path.join(__dirname, "chat-history.json");

// Load banned words
let bannedWords = [];
if (fs.existsSync(BANNED_WORDS_FILE)) bannedWords = JSON.parse(fs.readFileSync(BANNED_WORDS_FILE, "utf-8"));

// Load bans
let bans = [];
if (fs.existsSync(BANS_FILE)) bans = JSON.parse(fs.readFileSync(BANS_FILE, "utf-8"));
const saveBans = () => fs.writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2));

// Load messages
let messages = [];
if (fs.existsSync(MESSAGES_FILE)) messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf-8"));
const saveMessages = () => fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

// Block banned users
app.use((req, res, next) => {
  const cookieId = req.cookies?.userid;
  if (bans.find(b => b.cookie === cookieId)) return res.status(403).send("You are banned.");
  next();
});

// Socket.io
io.on("connection", (socket) => {
  let username;
  let userId;

  // Set username & persistent cookie
  socket.on("set username", (data) => {
    username = data.username || "Anonymous";

    if (!data.cookieId) {
      userId = randomUUID();
      socket.emit("setCookie", userId);
    } else {
      userId = data.cookieId;
    }

    socket.username = username;
    socket.userId = userId;

    // Send last 100 messages
    const lastMessages = messages.slice(-100);
    socket.emit("chat history", lastMessages);

    console.log(`🟢 New user connected: ${username} (${userId})`);
  });

  // Handle messages
  socket.on("chat message", (msg) => {
    if (!username || !userId) return;

    if (bans.find(b => b.cookie === userId)) {
      socket.emit("bannedNotice", { text: "You are banned." });
      return;
    }

    if (msg.startsWith("/")) {
      handleCommand(msg, socket);
      return;
    }

    // AutoMod
    const lowerMsg = msg.toLowerCase();
    const foundWord = bannedWords.find(w => lowerMsg.includes(w.toLowerCase()));
    if (foundWord) {
      if (!bans.find(b => b.cookie === userId)) {
        const reason = `Used banned word "${foundWord}"`;
        bans.push({ username, cookie: userId, reason, time: Date.now() });
        saveBans();

        const sysMsg = { username: "AutoMod", message: `${username} has been banned for ${reason}`, system: true };
        io.emit("chat message", sysMsg);

        messages.push(sysMsg);
        messages = messages.slice(-100);
        saveMessages();
      }
      socket.disconnect();
      return;
    }

    const msgData = { username, userId, message: msg };
    messages.push(msgData);
    messages = messages.slice(-100);
    saveMessages();

    io.emit("chat message", msgData);
  });

  socket.on("disconnect", () => {
    console.log(`🔴 ${username || "Unknown"} disconnected`);
  });
});

// ---------------- Command handler ----------------
function handleCommand(msg, socket) {
  const args = msg.trim().split(" ");
  const command = args[0].toLowerCase();

  // Admin-only commands
  const adminCommands = ["/ban", "/unban", "/server", "/updateusername"];
  if (adminCommands.includes(command) && socket.userId !== ADMIN_ID) {
    socket.emit("chat message", { username: "System", message: "❌ You are not an admin.", system: true });
    return;
  }

  switch(command) {
    // ---------- Admin Commands ----------
    case "/ban":
      const banId = args[1];
      const banReason = args.slice(2).join(" ") || "No reason provided";
      if (!banId) return socket.emit("chat message", { username: "System", message: "Usage: /ban userid reason", system: true });

      if (!bans.find(b => b.cookie === banId)) {
        let uname = "Unknown";
        for (let i = messages.length-1; i>=0; i--) if (messages[i].userId===banId){uname=messages[i].username; break;}
        bans.push({ username: uname, cookie: banId, reason: banReason, time: Date.now() });
        saveBans();

        const sysMsg = { username: "AutoMod", message: `${uname} has been manually banned for ${banReason}`, system: true };
        io.emit("chat message", sysMsg);
      }
      break;

    case "/unban":
      const unbanId = args[1];
      if (!unbanId) return socket.emit("chat message", { username: "System", message: "Usage: /unban userid", system: true });

      const index = bans.findIndex(b => b.cookie===unbanId || b.userId===unbanId);
      if (index !== -1) {
        const unbannedUser = bans[index];
        bans.splice(index,1);
        saveBans();

        const sysMsg = { username: "AutoMod", message: `${unbannedUser.username || "Unknown"} has been unbanned.`, system: true };
        io.emit("chat message", sysMsg);

        messages.push(sysMsg);
        messages = messages.slice(-100);
        saveMessages();
      }
      break;

    case "/server":
      const subCommand = args[1]?.toLowerCase();
      switch(subCommand) {
        case "say":
          const sayMsg = args.slice(2).join(" ");
          io.emit("chat message", { username: "Server", message: sayMsg, system: true });
          break;
        case "update":
          io.emit("server update");
          break;
        case "listusers":
          const onlineUsers = Array.from(io.sockets.sockets.values()).map(s => `${s.username} (${s.userId})`);
          socket.emit("chat message", { username: "Server", message: `Online Users:\n${onlineUsers.join("\n")}`, system: true });
          break;
        case "updatestatus":
          const status = args[2] || "online";
          io.emit("server status", status);
          break;
        case "updateusername":
          const targetId = args[2];
          const newName = args.slice(3).join(" ");
          for (let s of io.sockets.sockets.values()) if(s.userId===targetId) s.username=newName;
          messages.forEach(m => { if(m.userId===targetId) m.username=newName; });
          saveMessages();
          io.emit("chat message", { username: "Server", message: `${targetId} username updated to ${newName}`, system: true });
          break;
        default:
          socket.emit("chat message", { username: "Server", message: "Unknown /server command", system: true });
      }
      break;

    // ---------- User Commands ----------
    case "/online":
      const onlineCount = io.sockets.sockets.size;
      socket.emit("chat message", { username: "Server", message: `Online users: ${onlineCount}`, system: true });
      break;

    case "/report":
      const reportId = args[1];
      const reportMsg = args.slice(reportId ? 2 : 1).join(" ");
      socket.emit("chat message", { username: "Server", message: `Report sent: ${reportMsg}`, system: true });
      // TODO: send report to admin via DM or logging
      break;

    default:
      socket.emit("chat message", { username: "System", message: `Unknown command: ${command}`, system: true });
  }
}

// Optional chat history endpoint
app.get("/chat-history.json", (req, res) => {
  res.json(messages);
});

// Admin page
app.get("/admin", (req,res) => {
  res.sendFile(path.join(__dirname, "public/admin.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
