require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const docs = require("./services/documents");
const ai = require("./services/ai");

const app = express();
const conversations = new Map();

// Simple password protection (set in .env)
const APP_PASSWORD = process.env.APP_PASSWORD || ""; // empty = no password

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "3mb" }));

// Simple auth middleware
function checkAuth(req, res, next) {
  if (!APP_PASSWORD) return next(); // no password set
  const token = req.headers["x-kelai-token"] || req.query.token;
  if (token === APP_PASSWORD) return next();
  return res.status(401).json({ success: false, error: "Unauthorized. Please login." });
}

// File upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads")),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 18 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".txt", ".md", ".docx", ".csv"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype.startsWith("text/")) cb(null, true);
    else cb(new Error("Only PDF, DOCX, TXT, MD, CSV allowed"));
  }
});

// ========== PUBLIC ==========
app.get("/", (req, res) => {
  res.json({
    name: "KelAI Free API",
    version: "1.1.0",
    status: "online",
    message: "Backend is running. Point your frontend to this URL."
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    name: "KelAI Free",
    version: "1.1.0",
    passwordProtected: !!APP_PASSWORD,
    features: ["document-rag", "model-selector", "export", "password-protection"]
  });
});

app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (!APP_PASSWORD) {
    return res.json({ success: true, token: "open", message: "No password required" });
  }
  if (password === APP_PASSWORD) {
    return res.json({ success: true, token: APP_PASSWORD });
  }
  res.status(401).json({ success: false, error: "Wrong password" });
});

// ========== PROTECTED ==========
app.use("/api", checkAuth);

app.get("/api/models", (req, res) => {
  res.json({ success: true, models: ai.getAvailableModels() });
});

app.get("/api/documents", (req, res) => {
  res.json({ success: true, documents: docs.listDocuments(), stats: docs.getStats() });
});

app.post("/api/documents", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
    const doc = await docs.addDocument(req.file);
    res.json({ success: true, document: doc });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete("/api/documents/:id", (req, res) => {
  const ok = docs.deleteDocument(req.params.id);
  res.json({ success: ok });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, conversationId, model } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: "Message required" });
    }

    let convId = conversationId;
    if (!convId || !conversations.has(convId)) {
      convId = uuidv4();
      conversations.set(convId, { messages: [], createdAt: new Date().toISOString() });
    }

    const conv = conversations.get(convId);
    const history = conv.messages.slice(-8);

    const result = await ai.ask(message.trim(), history, model || null);

    conv.messages.push(
      { role: "user", content: message.trim(), timestamp: new Date().toISOString() },
      { role: "assistant", content: result.answer, timestamp: new Date().toISOString(), sources: result.sources }
    );
    if (conv.messages.length > 50) conv.messages = conv.messages.slice(-50);

    res.json({
      success: true,
      answer: result.answer,
      conversationId: convId,
      sources: result.sources || [],
      model: result.model,
      modelName: result.modelName,
      chunksUsed: result.chunksUsed
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export conversation as Markdown
app.get("/api/export/:conversationId", (req, res) => {
  const conv = conversations.get(req.params.conversationId);
  if (!conv) return res.status(404).json({ success: false, error: "Conversation not found" });

  let md = `# KelAI Study Notes Export\n\nExported: ${new Date().toISOString()}\n\n---\n\n`;
  for (const msg of conv.messages) {
    if (msg.role === "user") {
      md += `### You\n${msg.content}\n\n`;
    } else {
      md += `### KelAI\n${msg.content}\n\n`;
      if (msg.sources?.length) {
        md += `*Sources: ${msg.sources.join(", ")}*\n\n`;
      }
    }
    md += "---\n\n";
  }

  res.setHeader("Content-Type", "text/markdown");
  res.setHeader("Content-Disposition", `attachment; filename="kelai-export-${req.params.conversationId.slice(0,8)}.md"`);
  res.send(md);
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║       KelAI Free v1.1 — Document AI Online       ║
║                                                  ║
║   Local:     http://localhost:${PORT}               ║
║   Engine:    Groq Free Tier                      ║
║   Features:  RAG • Models • Export • Password    ║
╚══════════════════════════════════════════════════╝
  `);
});
