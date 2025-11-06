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
  cors: {
    origin: "*", // allow connections from anywhere
  },
});

const PORT = process.env.PORT || 3000;
const HISTORY_FILE = path.join(__dirname, "chat.json");

// Load messages or initialize empty
let messages = [];
if (fs.existsSync(HISTORY_FILE)) {
  try {
    messages = JSON.parse(fs.readFileSync(HISTORY_FILE));
  } catch {
    messages = [];
  }
}

// Serve static files (index.html at root)
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  console.log("🟢 User connected");

  // Send history to new user
  socket.emit("chatHistory", messages);

  // Listen for messages
  socket.on("chatMessage", (msg) => {
    const messageData = {
      user: msg.user || "Anonymous",
      text: msg.text || "",
      time: new Date().toLocaleTimeString(),
    };

    // Save message
    messages.push(messageData);
    messages = messages.slice(-100);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(messages, null, 2));

    // Broadcast to all users (including sender)
    io.emit("chatMessage", messageData);
  });

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected");
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
