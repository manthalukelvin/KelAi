const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const DATA_DIR = path.join(__dirname, "..", "data");
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const DOCS_FILE = path.join(DATA_DIR, "documents.json");

[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function loadDocs() {
  try {
    if (fs.existsSync(DOCS_FILE)) {
      return JSON.parse(fs.readFileSync(DOCS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Load docs error:", e.message);
  }
  return { documents: [] };
}

function saveDocs(data) {
  fs.writeFileSync(DOCS_FILE, JSON.stringify(data, null, 2));
}

let store = loadDocs();

async function extractText(filePath, originalName, mimetype) {
  const ext = path.extname(originalName).toLowerCase();
  try {
    if (ext === ".pdf" || mimetype === "application/pdf") {
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return data.text || "";
    }
    if (ext === ".docx" || mimetype.includes("wordprocessingml")) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || "";
    }
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error("Extract error:", err.message);
    return "";
  }
}

function chunkText(text, chunkSize = 850, overlap = 160) {
  const chunks = [];
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return chunks;

  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const breakPoints = [". ", "? ", "! ", "\n", "; "];
      let bestBreak = -1;
      for (const bp of breakPoints) {
        const idx = slice.lastIndexOf(bp);
        if (idx > chunkSize * 0.55 && idx > bestBreak) bestBreak = idx;
      }
      if (bestBreak > 0) end = start + bestBreak + 1;
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk.length > 35) chunks.push(chunk);
    start = end - overlap;
    if (start >= clean.length) break;
  }
  return chunks;
}

// Improved relevance scoring
function scoreChunk(chunk, query) {
  const q = query.toLowerCase().trim();
  const c = chunk.toLowerCase();
  const qWords = q.split(/\W+/).filter(w => w.length > 2);
  if (qWords.length === 0) return 0;

  let score = 0;

  // Exact phrase bonus
  if (c.includes(q)) score += 8;

  // Individual word matches with position weighting
  for (const w of qWords) {
    const regex = new RegExp(`\\b${w}\\b`, "gi");
    const matches = c.match(regex);
    if (matches) {
      score += matches.length * 1.8;
      // Early appearance bonus
      const firstPos = c.indexOf(w);
      if (firstPos >= 0 && firstPos < 120) score += 1.2;
    }
  }

  // Coverage: how many unique query words appear
  const uniqueHits = qWords.filter(w => c.includes(w)).length;
  score += (uniqueHits / qWords.length) * 4;

  // Length normalization (prefer denser relevant chunks)
  score = score / Math.sqrt(chunk.length / 180);

  return score;
}

function retrieveRelevantChunks(query, topK = 8) {
  const allChunks = [];
  for (const doc of store.documents) {
    for (const chunk of doc.chunks || []) {
      const score = scoreChunk(chunk.text, query);
      if (score > 0.6) {
        allChunks.push({
          text: chunk.text,
          score,
          documentId: doc.id,
          documentName: doc.originalName,
          chunkIndex: chunk.index
        });
      }
    }
  }
  // Diversify a bit: avoid too many chunks from same doc
  const sorted = allChunks.sort((a, b) => b.score - a.score);
  const selected = [];
  const perDoc = {};
  for (const item of sorted) {
    perDoc[item.documentId] = (perDoc[item.documentId] || 0) + 1;
    if (perDoc[item.documentId] <= 4) {
      selected.push(item);
    }
    if (selected.length >= topK) break;
  }
  return selected;
}

async function addDocument(file) {
  const id = uuidv4();
  const text = await extractText(file.path, file.originalname, file.mimetype);

  if (!text || text.trim().length < 30) {
    try { fs.unlinkSync(file.path); } catch {}
    throw new Error("Could not extract enough text. Use PDF, DOCX, TXT or MD.");
  }

  const chunks = chunkText(text).map((t, i) => ({ index: i, text: t }));

  const doc = {
    id,
    originalName: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    uploadedAt: new Date().toISOString(),
    textLength: text.length,
    chunkCount: chunks.length,
    chunks,
    preview: text.slice(0, 300) + (text.length > 300 ? "…" : "")
  };

  store.documents.unshift(doc);
  saveDocs(store);
  try { fs.unlinkSync(file.path); } catch {}

  return {
    id: doc.id,
    originalName: doc.originalName,
    size: doc.size,
    chunkCount: doc.chunkCount,
    textLength: doc.textLength,
    uploadedAt: doc.uploadedAt,
    preview: doc.preview
  };
}

function listDocuments() {
  return store.documents.map(d => ({
    id: d.id,
    originalName: d.originalName,
    size: d.size,
    chunkCount: d.chunkCount,
    textLength: d.textLength,
    uploadedAt: d.uploadedAt,
    preview: d.preview
  }));
}

function deleteDocument(id) {
  const before = store.documents.length;
  store.documents = store.documents.filter(d => d.id !== id);
  saveDocs(store);
  return store.documents.length < before;
}

function getStats() {
  return {
    totalDocuments: store.documents.length,
    totalChunks: store.documents.reduce((s, d) => s + (d.chunkCount || 0), 0),
    totalCharacters: store.documents.reduce((s, d) => s + (d.textLength || 0), 0)
  };
}

module.exports = {
  addDocument,
  listDocuments,
  deleteDocument,
  retrieveRelevantChunks,
  getStats
};
