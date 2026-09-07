const Groq = require("groq-sdk");
const docs = require("./documents");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Available free models on Groq
const MODELS = {
  "llama-3.3-70b-versatile": { name: "Llama 3.3 70B", desc: "Most intelligent" },
  "llama-3.1-8b-instant": { name: "Llama 3.1 8B", desc: "Fastest / higher limits" },
  "gemma2-9b-it": { name: "Gemma 2 9B", desc: "Balanced & fast" },
  "mixtral-8x7b-32768": { name: "Mixtral 8x7B", desc: "Good reasoning" }
};

const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

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

async function ask(message, conversationHistory = [], modelId = null) {
  const model = (modelId && MODELS[modelId]) ? modelId : DEFAULT_MODEL;
  const relevant = docs.retrieveRelevantChunks(message, 8);
  const context = buildContext(relevant);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: context },
    ...conversationHistory.slice(-8),
    { role: "user", content: message }
  ];

  try {
    const completion = await groq.chat.completions.create({
      model,
      messages,
      temperature: 0.45,
      max_tokens: 2500,
      top_p: 0.9
    });

    const answer = completion.choices[0]?.message?.content || "I could not generate a response.";
    const sources = [...new Set(relevant.map(c => c.documentName))];

    return {
      success: true,
      answer,
      sources,
      model,
      modelName: MODELS[model]?.name || model,
      chunksUsed: relevant.length
    };
  } catch (error) {
    console.error("Groq error:", error.message);
    if (error.status === 429 || (error.message || "").toLowerCase().includes("rate limit")) {
      throw new Error("Free rate limit reached. Wait a moment or switch to a lighter model (Llama 3.1 8B).");
    }
    throw new Error(error.message || "AI service temporarily unavailable");
  }
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
