const Groq = require("groq-sdk");
const docs = require("./documents");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// ONLY currently working models on Groq (Sept 2026)
const MODELS = {
  "llama-3.1-8b-instant": {
    name: "Llama 3.1 8B Instant",
    desc: "Fastest + highest free limits (recommended)"
  },
  "llama-3.3-70b-versatile": {
    name: "Llama 3.3 70B",
    desc: "Strongest quality"
  },
  "openai/gpt-oss-20b": {
    name: "GPT-OSS 20B",
    desc: "Balanced & fast"
  },
  "openai/gpt-oss-120b": {
    name: "GPT-OSS 120B",
    desc: "Very strong reasoning"
  },
  "meta-llama/llama-4-scout-17b-16e-instruct": {
    name: "Llama 4 Scout",
    desc: "Newer Llama 4 model"
  }
};

const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const FALLBACK_MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-20b"
];

const SYSTEM_PROMPT = `You are KelAI — Kelvin's intelligent personal study assistant.

You answer questions primarily using the provided CONTEXT from the user's uploaded documents and notes.

Rules:
1. Prefer information from the CONTEXT section over general knowledge.
2. When you use document content, cite the source document name.
3. If context is incomplete, you may carefully add general knowledge but clearly separate it.
4. Be clear, structured and university-level when appropriate.
5. Use markdown (headings, lists, tables, code blocks) for readability.
6. If asked to generate MCQs, summaries, revision plans or explanations, base them on the documents.
7. Never invent content that is not supported by the documents.

You are helpful, accurate and focused on helping Kelvin learn effectively.`;

function buildContext(chunks) {
  if (!chunks || chunks.length === 0) {
    return "No relevant documents were found for this question. Answer using general knowledge if appropriate, and suggest the user upload relevant notes.";
  }
  let ctx = "CONTEXT FROM USER'S DOCUMENTS:\n\n";
  chunks.forEach((c, i) => {
    ctx += `[Source ${i + 1}: "${c.documentName}"]\n${c.text}\n\n`;
  });
  return ctx;
}

async function callModel(model, messages) {
  return groq.chat.completions.create({
    model,
    messages,
    temperature: 0.45,
    max_tokens: 2500,
    top_p: 0.9
  });
}

async function ask(message, conversationHistory = [], modelId = null) {
  let model = (modelId && MODELS[modelId]) ? modelId : DEFAULT_MODEL;

  const relevant = docs.retrieveRelevantChunks(message, 8);
  const context = buildContext(relevant);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: context },
    ...conversationHistory.slice(-8),
    { role: "user", content: message }
  ];

  // Try the requested model, then fall back automatically
  const tryOrder = [model, ...FALLBACK_MODELS.filter(m => m !== model)];

  let lastError = null;

  for (const currentModel of tryOrder) {
    try {
      const completion = await callModel(currentModel, messages);
      const answer = completion.choices[0]?.message?.content || "I could not generate a response.";
      const sources = [...new Set(relevant.map(c => c.documentName))];

      return {
        success: true,
        answer,
        sources,
        model: currentModel,
        modelName: MODELS[currentModel]?.name || currentModel,
        chunksUsed: relevant.length,
        usedFallback: currentModel !== model
      };
    } catch (error) {
      lastError = error;
      console.error(`Model ${currentModel} failed:`, error.message);

      // Rate limit → stop trying more
      if (error.status === 429 || (error.message || "").toLowerCase().includes("rate limit")) {
        throw new Error("Free rate limit reached. Please wait 30–60 seconds and try again, or switch to Llama 3.1 8B Instant.");
      }

      // Model not found / decommissioned → try next
      continue;
    }
  }

  // All models failed
  throw new Error(
    lastError?.message ||
    "All models failed. Please check your GROQ_API_KEY on Render and try again."
  );
}

function getAvailableModels() {
  return Object.entries(MODELS).map(([id, info]) => ({
    id,
    name: info.name,
    description: info.desc,
    isDefault: id === DEFAULT_MODEL
  }));
}

module.exports = { ask, getAvailableModels, MODELS };
