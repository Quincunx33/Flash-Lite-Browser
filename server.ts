import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT, MODEL_NAME } from "./services/geminiService";
import { checkPromptSafety } from "./utils/safety";

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
    ].map(k => k?.trim()).filter(k => k && k !== 'undefined' && k !== '');

    if (keys.length === 0) return null;

    // Pick one at random for simple load balancing
    const selectedKey = keys[Math.floor(Math.random() * keys.length)];
    return selectedKey;
  };

  const ipCounts = new Map<string, number>();

  const getClientIp = (req: any) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
      } else if (Array.isArray(forwarded)) {
        return forwarded[0].trim();
      }
    }
    return req.socket.remoteAddress || 'unknown';
  };

  const getCookie = (req: any, name: string): string => {
    const list: Record<string, string> = {};
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return '';

    cookieHeader.split(';').forEach((cookie: string) => {
      const parts = cookie.split('=');
      const key = parts.shift()?.trim();
      if (key) {
        list[key] = decodeURIComponent(parts.join('='));
      }
    });

    return list[name] || '';
  };

  app.post("/api/generate", async (req, res) => {
    const { prompt, currentPageHtml, isGrounded, formState, isMobile, userApiKey } = req.body;

    // Check prompt safety
    const safety = checkPromptSafety(prompt);
    if (!safety.isSafe) {
      return res.status(400).json({ error: `🚨 Blocked: ${safety.reasonBn} (Inappropriate content request is not allowed.)` });
    }

    // Verify limit if using system API Key
    const usingSystemKey = !userApiKey || !userApiKey.trim();
    if (usingSystemKey) {
      const ip = getClientIp(req);
      const cookieVal = getCookie(req, '__fl_sec_count');
      const cookieCount = cookieVal ? parseInt(cookieVal, 10) : 0;
      const ipCount = ipCounts.get(ip) || 0;
      const currentCount = Math.max(cookieCount, ipCount);

      if (currentCount >= 5) {
        return res.status(400).json({
          error: "🚨 LIMIT_REACHED: You have reached the limit of 5 free generations on this device. Please provide your own Gemini API Key in Settings to continue."
        });
      }

      // Increment and set secure HTTP-Only cookie
      const nextCount = currentCount + 1;
      ipCounts.set(ip, nextCount);
      res.setHeader('Set-Cookie', `__fl_sec_count=${nextCount}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict`);
    }

    const apiKey = getApiKey(userApiKey);
    if (!apiKey) {
      return res.status(400).json({ error: "No API key available. Please configure system keys or provide a user key." });
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
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

      // Setting up streaming response
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');

      // Send immediate initial marker so UI shows Loading state right away
      res.write(`__TOKEN__${JSON.stringify({ input: 0, output: 0, isEstimate: true })}`);
      if ((res as any).flush) (res as any).flush();

      // countTokens
      let inputTokens = 0;
      try {
        const countResult = await ai.models.countTokens({
          model: MODEL_NAME,
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        });
        inputTokens = countResult.totalTokens || 0;
      } catch (e) {
        console.warn("Token count failed on server, using estimate", e);
        inputTokens = Math.round(userPrompt.length / 4);
      }

      res.write(`__TOKEN__${JSON.stringify({ input: inputTokens, output: 0, isEstimate: true })}`);
      if ((res as any).flush) (res as any).flush();

      const responseStream = await ai.models.generateContentStream({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: isGrounded ? [{ googleSearch: {} }] : undefined,
        }
      });

      let outputTokens = 0;
      let totalChars = 0;
      let groundingSources: any[] = [];
      let searchEntryPointHtml = '';

      for await (const chunk of responseStream) {
        if (chunk.usageMetadata) {
          inputTokens = chunk.usageMetadata.promptTokenCount || inputTokens;
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

        const text = chunk.text;
        if (text) {
          totalChars += text.length;
          const estimatedOutput = outputTokens > 0 ? outputTokens : Math.round(totalChars / 4);
          res.write(`__TOKEN__${JSON.stringify({ input: inputTokens, output: estimatedOutput, isEstimate: outputTokens === 0 })}`);
          res.write(text);
          if ((res as any).flush) (res as any).flush();
        }
      }

      res.write(`__META__${JSON.stringify({ tokenCount: { input: inputTokens, output: outputTokens }, groundingSources, searchEntryPointHtml })}`);
      if ((res as any).flush) (res as any).flush();
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
