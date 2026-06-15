import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT, MODEL_NAME } from "./services/geminiService";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API rotation logic
  const getApiKey = (userKey?: string) => {
    if (userKey && userKey.trim() !== '') return userKey;
    
    // Check for multiple keys as requested by the user
    // The user has GEMINI_API_KEY_1 through GEMINI_API_KEY_4 in Cloudflare
    const keys = [
      process.env.GEMINI_API_KEY_1,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
      process.env.GEMINI_API_KEY_4,
      process.env.GEMINI_API_KEY // Fallback
    ].filter(k => k && k !== 'undefined' && k !== '');

    if (keys.length === 0) return null;

    // Pick one at random for simple load balancing
    const selectedKey = keys[Math.floor(Math.random() * keys.length)];
    return selectedKey;
  };

  app.post("/api/generate", async (req, res) => {
    const { prompt, currentPageHtml, isGrounded, formState, isMobile, userApiKey } = req.body;

    const apiKey = getApiKey(userApiKey);
    if (!apiKey) {
      return res.status(400).json({ error: "No API key available. Please configure system keys or provide a user key." });
    }

    try {
      const genAI = new GoogleGenAI(apiKey);
      const model = genAI.getGenerativeModel({ 
        model: MODEL_NAME,
        systemInstruction: SYSTEM_PROMPT
      });

      const isEdit = currentPageHtml !== null;
      let userPrompt: string;
      if (isEdit) {
        const formStateBlock = formState && formState.length > 0
          ? `\n\nThe user entered the following values into input fields on the previous page:\n${formState.map((f: any) => `- ${f.name || 'unnamed'} (${f.type}): "${f.value}"`).join('\n')}\n`
          : '';
        userPrompt = `
Update this page based on the following.
Instruction: "${prompt}"

Keep the layout and style generally consistent.
Return the complete updated HTML document.${formStateBlock}

CURRENT HTML:
${currentPageHtml}
`;
      } else {
        userPrompt = `
Task: Generate a new web page.
Description: "${prompt}"

Create a complete, detailed, realistic-looking web page based on this description.
`;
      }

      if (isGrounded) {
        userPrompt += `\nIMPORTANT: You have access to Google Search. Use it to find current, accurate data for populating the page content. Always ground the page in search results — use real names, real statistics, real facts from your Google searches.\n`;
      }

      if (isMobile) {
        userPrompt += `\nIMPORTANT: The user is on a MOBILE device with a narrow viewport. Design mobile-first:\n- Use a single-column layout\n- Use responsive Tailwind classes\n- Avoid horizontal scrolling\n- Stack elements vertically\n- Keep navigation simple\n`;
      }

      const config: any = {};
      if (isGrounded) {
        config.tools = [{ googleSearch: {} }];
      }

      // Setting up streaming response
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');

      // Pre-flight: count tokens
      let inputTokens = 0;
      try {
        const countResult = await model.countTokens({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        });
        inputTokens = countResult.totalTokens || 0;
      } catch (e) {
        console.warn("Token count failed on server", e);
      }

      res.write(`__TOKEN__${JSON.stringify({ input: inputTokens, output: 0, isEstimate: true })}`);

      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: config
      });

      let outputTokens = 0;
      let totalChars = 0;
      let groundingSources: any[] = [];
      let searchEntryPointHtml = '';

      for await (const chunk of result.stream) {
        if (chunk.usageMetadata) {
          if (chunk.usageMetadata.promptTokenCount) {
             inputTokens = chunk.usageMetadata.promptTokenCount;
          }
          outputTokens = chunk.usageMetadata.candidatesTokenCount || 0;
        }

        const groundingMeta = chunk.candidates?.[0]?.groundingMetadata;
        if (groundingMeta?.groundingChunks?.length) {
          groundingSources = groundingMeta.groundingChunks
            .filter((c: any) => c.web?.uri && c.web?.title)
            .map((c: any) => ({ title: c.web.title, uri: c.web.uri }));
        }
        if (groundingMeta?.searchEntryPoint?.renderedContent) {
          searchEntryPointHtml = groundingMeta.searchEntryPoint.renderedContent;
        }

        try {
          const text = chunk.text();
          if (text) {
            totalChars += text.length;
            const estimatedOutput = Math.round(totalChars / 4);
            res.write(`__TOKEN__${JSON.stringify({ input: inputTokens, output: estimatedOutput, isEstimate: true })}`);
            res.write(text);
          }
        } catch (e) {
          // Sometimes chunk.text() fails if there's no text in the chunk
        }
      }

      res.write(`__META__${JSON.stringify({ tokenCount: { input: inputTokens, output: outputTokens }, groundingSources, searchEntryPointHtml })}`);
      res.end();

    } catch (error: any) {
      console.error("Server Generation Error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      } else {
        res.write(`\n\nERROR: ${error.message}`);
        res.end();
      }
    }
  });

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
