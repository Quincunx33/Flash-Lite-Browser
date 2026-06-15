import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- Key Management & Rotation ---
let exhaustedKeys = new Set<string>();

function getApiKey(userKey?: string, strictUserKey: boolean = false) {
  // 1. User provided key from browser (Settings menu)
  if (userKey && userKey.length > 5) {
    console.log("Using custom user-provided API key from browser.");
    return userKey;
  }
  
  if (strictUserKey) {
    console.log("Strict mode active: No user key provided.");
    return null;
  }

  // 2. System Pool (checked in order)
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY
  ].filter(Boolean) as string[];

  console.log(`Found ${keys.length} system API keys in environment.`);

  const availableKey = keys.find(k => !exhaustedKeys.has(k));
  if (availableKey) {
    return availableKey;
  }

  // Backup: if all keys exhausted, just use the first one and hope for the best
  return keys[0] || null;
}

const SYSTEM_PROMPT = `
You are Flash-Lite Browser, powered by Gemini 3.1 Flash-Lite. 
You generate complete, functional HTML documents using Tailwind CSS and Material Symbols.
Return ONLY the HTML code.
`;

const MODEL_NAME = 'gemini-1.5-flash-latest';

// --- API Endpoints ---
app.post("/api/generate", async (req, res) => {
  const { prompt, currentPageHtml, isGrounded, formState, isMobile, userApiKey, strictUserKey } = req.body;

  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    const apiKey = getApiKey(userApiKey, strictUserKey);
    
    if (!apiKey) {
      const msg = strictUserKey 
        ? "Custom API Key is required but not set. Please enter it in Settings (⋮)." 
        : "No Gemini API keys found on the server. Please add GEMINI_API_KEY_1 to your environment variables.";
      return res.status(400).json({ error: { message: msg } });
    }

    try {
      const genAI = new GoogleGenAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: MODEL_NAME,
        systemInstruction: SYSTEM_PROMPT
      });

      const userPrompt = currentPageHtml 
        ? `Update this page: "${prompt}"\nCurrent HTML: ${currentPageHtml}`
        : `Generate a new page: "${prompt}"`;

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');

      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        tools: isGrounded ? [{ googleSearch: {} }] : []
      });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) res.write(text);
      }
      
      return res.end();

    } catch (e: any) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      const isQuotaError = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');

      if (isQuotaError && !userApiKey && apiKey) {
        exhaustedKeys.add(apiKey);
        attempt++;
        if (attempt < maxAttempts) continue;
      }
      
      if (res.headersSent) {
        res.write(`\n\n__ERROR__${errorMsg}`);
        return res.end();
      }
      return res.status(500).json({ error: { message: errorMsg } });
    }
  }
});

// --- Server Startup ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
