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

// ---------- Config ----------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "adminpass";
// List of admin IDs
const ADMIN_ID = [
  "e3078d0d-aa6c-410c-8015-9a7d269fe230",
  "694beb8e-c652-41b0-9922-36b34f55282d",
];

const BANNED_WORDS_FILE = path.join(__dirname, "bannedwords.json");
const BANS_FILE = path.join(__dirname, "bans.json");
const MESSAGES_FILE = path.join(__dirname, "chathistory.json");

// ---------- Data ----------
let bannedWords = fs.existsSync(BANNED_WORDS_FILE)
  ? JSON.parse(fs.readFileSync(BANNED_WORDS_FILE, "utf-8"))
  : [];

let bans = fs.existsSync(BANS_FILE)
  ? JSON.parse(fs.readFileSync(BANS_FILE, "utf-8"))
  : [];

let messages = fs.existsSync(MESSAGES_FILE)
  ? JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf-8"))
  : [];

let mutedUsers = {}; // { userId: unmuteTimestamp }

// Save functions
const saveBans = () => fs.writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2));
const saveMessages = () =>
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));

// ---------- Middleware ----------
app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

// Block banned users
app.use((req, res, next) => {
  const cookieId = req.cookies?.userid;
  if (bans.find((b) => b.cookie === cookieId)) return res.status(403).send("You are banned.");
  next();
});

// ---------- Socket.io ----------
io.on("connection", (socket) => {
  let username;
  let userId;

  socket.on("set username", (data) => {
    username = data.username || "Anonymous";

    if (!data.cookieId) {
      userId = randomUUID();
      socket.emit("setCookie", userId);
    } else userId = data.cookieId;

    socket.username = username;
    socket.userId = userId;

    // Send last 100 messages
    socket.emit("chat history", messages.slice(-100));

    console.log(`🟢 New user connected: ${username} (${userId})`);
  });

  socket.on("chat message", (msg) => {
    if (!username || !userId) return;

    // Auto-unmute cleanup
    const now = Date.now();
    for (const [uid, time] of Object.entries(mutedUsers)) {
      if (time <= now) delete mutedUsers[uid];
    }

    if (bans.find((b) => b.cookie === userId)) {
      socket.emit("bannedNotice", { text: "You are banned." });
      return;
    }

    if (mutedUsers[userId]) {
      socket.emit("chat message", {
        username: "System",
        message: `You are muted for ${Math.ceil((mutedUsers[userId] - now)/1000)}s`,
        system: true,
      });
      return;
    }

    if (msg.startsWith("/")) {
      handleCommand(msg, socket);
      return;
    }

    // AutoMod banned words
    const lowerMsg = msg.toLowerCase();
    const foundWord = bannedWords.find((w) => lowerMsg.includes(w.toLowerCase()));
    if (foundWord) {
      const reason = `Used banned word "${foundWord}"`;
      bans.push({ username, cookie: userId, reason, time: now });
      saveBans();

      const sysMsg = {
        username: "AutoMod",
        message: `${username} has been banned for ${reason}`,
        system: true,
      };
      io.emit("chat message", sysMsg);

      messages.push(sysMsg);
      messages = messages.slice(-100);
      saveMessages();

      socket.disconnect();
      return;
    }

    // Normal message
    const msgData = { username, userId, message: msg };
    messages.push(msgData);
    messages = messages.slice(-100);
    saveMessages();

    io.emit("chat message", msgData);

    // Mentions
    for (const s of io.sockets.sockets.values()) {
      if (msg.includes(`@${s.username}`) && s.userId !== userId) {
        s.emit("mention", { from: username, message: msg });
      }
    }
  });

  socket.on("disconnect", () => console.log(`🔴 ${username || "Unknown"} disconnected`));
});

// ---------------- Commands ----------------
function handleCommand(msg, socket) {
  const args = msg.trim().split(" ");
  const command = args[0].toLowerCase();
  const isAdmin = ADMIN_ID.includes(socket.userId);

  const adminCommands = [
    "/ban","/unban","/server","/mute","/kick","/clear","/purge","/addbannedword","/removebannedword"
  ];

  if (adminCommands.includes(command) && !isAdmin) {
    socket.emit("chat message", { username: "System", message: "❌ You are not an admin.", system: true });
    return;
  }

  switch(command) {
    // Admin
    case "/ban": {
      const id = args[1]; const reason = args.slice(2).join(" ") || "No reason";
      if (!id) return socket.emit("chat message", { username: "System", message: "Usage: /ban userid reason", system: true });

      if (!bans.find(b => b.cookie === id)) {
        let uname = messages.find(m => m.userId === id)?.username || "Unknown";
        bans.push({ username: uname, cookie: id, reason, time: Date.now() });
        saveBans();

        const sysMsg = { username: "AutoMod", message: `${uname} has been banned for ${reason}`, system: true };
        io.emit("chat message", sysMsg);
        messages.push(sysMsg); messages = messages.slice(-100); saveMessages();
      }
      break;
    }
    case "/unban": {
      const id = args[1]; if (!id) return socket.emit("chat message", { username:"System", message:"Usage: /unban userid", system:true });
      const index = bans.findIndex(b => b.cookie===id);
      if(index!==-1){const u=bans[index];bans.splice(index,1); saveBans();
        const sysMsg={username:"AutoMod", message:`${u.username||"Unknown"} has been unbanned.`, system:true};
        io.emit("chat message",sysMsg); messages.push(sysMsg); messages=messages.slice(-100); saveMessages();
      }
      break;
    }
    case "/server": {
      const sub = args[1]?.toLowerCase();
      switch(sub){
        case "say": io.emit("chat message",{username:"Server",message:args.slice(2).join(" "),system:true}); break;
        case "update": io.emit("server update"); break;
        case "listusers": {
          const online=Array.from(io.sockets.sockets.values()).map(s=>`${s.username} (${s.userId})`);
          socket.emit("chat message",{username:"Server",message:`Online Users:\n${online.join("\n")}`,system:true});
          break;
        }
        case "updatestatus": io.emit("server status", args[2]||"online"); break;
        default: socket.emit("chat message",{username:"Server", message:"Unknown /server command", system:true});
      }
      break;
    }
    case "/mute": {
      const tId=args[1]; const dur=args[2]||"5m"; if(!tId) return socket.emit("chat message",{username:"System", message:"Usage: /mute userid duration", system:true});
      mutedUsers[tId]=Date.now()+parseDuration(dur);
      io.emit("chat message",{username:"AutoMod", message:`User ${tId} muted for ${dur}`, system:true});
      break;
    }
    case "/kick": {
      const tId=args[1]; if(!tId) return socket.emit("chat message",{username:"System", message:"Usage: /kick userid", system:true});
      for(const s of io.sockets.sockets.values()) if(s.userId===tId) s.disconnect();
      io.emit("chat message",{username:"AutoMod", message:`User ${tId} was kicked.`, system:true});
      break;
    }
    case "/clear": {
      const tId=args[1]; if(!tId) return socket.emit("chat message",{username:"System", message:"Usage: /clear userid", system:true});
      messages=messages.filter(m=>m.userId!==tId); saveMessages();
      io.emit("chat message",{username:"Server", message:`All messages from ${tId} cleared`, system:true});
      break;
    }
    case "/purge": messages=[]; saveMessages(); io.emit("chat message",{username:"Server", message:"Chat history purged", system:true}); break;
    case "/addbannedword": bannedWords.push(args[1]); fs.writeFileSync(BANNED_WORDS_FILE, JSON.stringify(bannedWords,null,2)); break;
    case "/removebannedword": bannedWords=bannedWords.filter(w=>w!==args[1]); fs.writeFileSync(BANNED_WORDS_FILE, JSON.stringify(bannedWords,null,2)); break;

    // User
    case "/online": socket.emit("chat message",{username:"Server", message:`Online users: ${io.sockets.sockets.size}`, system:true}); break;
    case "/report": { const rId=args[1]; const rMsg=args.slice(rId?2:1).join(" "); socket.emit("chat message",{username:"Server", message:`Report sent: ${rMsg}`, system:true}); break; }
    case "/stats": socket.emit("chat message",{username:"Server", message:`Your stats:\nMessages sent: ${messages.filter(m=>m.userId===socket.userId).length}`, system:true}); break;
    case "/roll": {
      const dice=args[1]?.toLowerCase()?.split("d"); if(!dice || dice.length!==2){socket.emit("chat message",{username:"Server", message:"Usage: /roll XdY", system:true}); break;}
      const [num,faces]=dice.map(Number); const results=[]; for(let i=0;i<num;i++) results.push(1+Math.floor(Math.random()*faces));
      socket.emit("chat message",{username:"Server", message:`${socket.username} rolled: ${results.join(", ")}`, system:true});
      break;
    }
    case "/flip": socket.emit("chat message",{username:"Server", message:`${socket.username} flipped a coin: ${Math.random()<0.5?"Heads":"Tails"}`, system:true}); break;
    case "/hug": {
      const tId=args[1]; if(!tId){socket.emit("chat message",{username:"Server", message:"Usage: /hug [userid]", system:true}); break;}
      const tUser=Array.from(io.sockets.sockets.values()).find(s=>s.userId===tId);
      if(!tUser){socket.emit("chat message",{username:"Server", message:"User not found.", system:true}); break;}
      io.emit("chat message",{username:"Server", message:`${socket.username} hugged ${tUser.username}`, system:true}); break;
    }
    case "/help": {
      let helpMsg=`User Commands:\n/online\n/report [userid] [message]\n/stats\n/roll [XdY]\n/flip\n/hug [userid]`;
      if(isAdmin) helpMsg+=`\nAdmin Commands:\n/ban [userid] [reason]\n/unban [userid]\n/server [say|update|listusers|updatestatus]\n/mute [userid] [duration]\n/kick [userid]\n/clear [userid]\n/purge\n/addbannedword [word]\n/removebannedword [word]`;
      socket.emit("chat message",{username:"Server", message:helpMsg, system:true}); break;
    }
    default: socket.emit("chat message",{username:"System", message:`Unknown command: ${command}`, system:true});
  }
}

// ---------- Helpers ----------
function parseDuration(str){
  const match=str.match(/^(\d+)(s|m|h)$/);
  if(!match) return 300000;
  const [, val, unit] = match;
  const num=parseInt(val);
  switch(unit){case"s":return num*1000; case"m":return num*60*1000; case"h":return num*60*60*1000; default:return 300000;}
}

// ---------- Endpoints ----------
app.get("/chat-history.json",(req,res)=>res.json(messages));
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public/admin.html")));

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`✅ Server running on port ${PORT}`));

