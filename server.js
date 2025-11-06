import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const HISTORY_FILE = path.join(__dirname, "chat.json");

// Load previous messages or start empty
let messages = [];
if (fs.existsSync(HISTORY_FILE)) {
  try {
    messages = JSON.parse(fs.readFileSync(HISTORY_FILE));
  } catch {
    messages = [];
  }
}

// Serve the public folder (index.html at root)
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  console.log("🟢 User connected");

  // send chat history
  socket.emit("chatHistory", messages);

  // new chat message
  socket.on("chatMessage", ({ user, text }) => {
    const msg = {
      user: user || "Anonymous",
      text: text || "",
      time: new Date().toLocaleTimeString(),
    };
    messages.push(msg);
    messages = messages.slice(-100); // keep last 100
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(messages, null, 2));
    io.emit("chatMessage", msg); // broadcast to all users
  });

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected");
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
