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
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const HISTORY_FILE = path.join(__dirname, "chat.json");

// Load existing messages or start empty
let messages = [];
if (fs.existsSync(HISTORY_FILE)) {
  try {
    messages = JSON.parse(fs.readFileSync(HISTORY_FILE));
  } catch {
    messages = [];
  }
}

// Serve static files from 'public'
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  console.log("🟢 User connected");

  // Send chat history to the new user
  socket.emit("chatHistory", messages);

  // Handle incoming messages
  socket.on("chatMessage", (msg) => {
    if (!msg.user || !msg.text) return;

    const messageData = {
      user: msg.user,
      text: msg.text,
      time: new Date().toLocaleTimeString()
    };

    messages.push(messageData);
    messages = messages.slice(-100); // keep last 100 messages

    // Save messages persistently
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(messages, null, 2));

    // Broadcast to all users (including sender)
    io.emit("chatMessage", messageData);
  });

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected");
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
