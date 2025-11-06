import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Load message history from file if exists
const HISTORY_FILE = "./chat.json";
let messages = [];

if (fs.existsSync(HISTORY_FILE)) {
  try {
    messages = JSON.parse(fs.readFileSync(HISTORY_FILE));
  } catch {
    messages = [];
  }
}

// Serve static files (index.html etc.)
app.use(express.static("."));

// When a user connects
io.on("connection", (socket) => {
  console.log("🟢 New user connected");

  // Send chat history to new user
  socket.emit("chatHistory", messages);

  // When user sends message
  socket.on("chatMessage", (msg) => {
    const messageData = {
      user: msg.user,
      text: msg.text,
      time: new Date().toLocaleTimeString(),
    };
    messages.push(messageData);

    // Save to file
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(messages.slice(-100), null, 2));

    // Broadcast to all users
    io.emit("chatMessage", messageData);
  });

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected");
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
