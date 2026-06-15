import { GoogleGenAI } from "@google/genai";

let exhaustedKeys = new Set<string>();
let currentKey: string | null = null;

const SYSTEM_PROMPT = `
You are powered by Gemini 3.1 Flash-Lite, a new fast, light-weight model released in March 2026. You generate complete web pages as HTML documents.

STRUCTURE:
Return a full HTML document with a <head> and a <body>:

<html>
<head>
  <title>SiteName - Page Name</title>
  <meta name="color-scheme" content="light">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="font-family: 'Inter', sans-serif">
  ...page content...
</body>
</html>

Tailwind CSS and Material Symbols are injected automatically.
Set color-scheme to "light" or "dark".
Use Tailwind for all styling.
For icons: <span class="material-symbols-outlined">icon_name</span>.
`;

const MODEL_NAME = 'gemini-3.1-flash-lite-preview';

function getAi(userKey?: string, strictUserKey: boolean = false) {
  if (userKey) {
    currentKey = userKey;
    return new GoogleGenAI(userKey);
  }

  if (strictUserKey) {
    throw new Error("Custom API Key is required but not set.");
  }

  // System Keys (VITE_ prefix is required for Cloudflare Pages/Vite)
  const systemKeys = [
    import.meta.env.VITE_GEMINI_API_KEY_1,
    import.meta.env.VITE_GEMINI_API_KEY_2,
    import.meta.env.VITE_GEMINI_API_KEY_3,
    import.meta.env.VITE_GEMINI_API_KEY_4,
    import.meta.env.VITE_GEMINI_API_KEY // Legacy
  ].filter(k => k && k !== 'undefined');

  const availableKey = systemKeys.find(k => !exhaustedKeys.has(k!));
  const keyToUse = availableKey || systemKeys[0];

  if (!keyToUse) {
    throw new Error("No API keys configured. Set VITE_GEMINI_API_KEY_1 in Cloudflare.");
  }

  currentKey = keyToUse;
  return new GoogleGenAI(keyToUse);
}

export async function* streamPageGeneration(
  prompt: string,
  currentPageHtml: string | null = null,
  isGrounded: boolean = false,
  abortSignal?: AbortSignal,
  formState?: Array<{ name: string; type: string; value: string }>,
  isMobile: boolean = false,
  userApiKey?: string,
  strictUserKey: boolean = false,
): AsyncGenerator<string> {
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    try {
      const genAI = getAi(userApiKey, strictUserKey);
      const model = genAI.getGenerativeModel({ 
        model: MODEL_NAME,
        systemInstruction: SYSTEM_PROMPT
      });

      let userPrompt = currentPageHtml 
        ? `Update this page based on: "${prompt}"\nCURRENT HTML:\n${currentPageHtml}`
        : `Task: Generate a new web page.\nDescription: "${prompt}"`;

      if (isGrounded) userPrompt += `\nUse Google Search for real facts.`;
      if (isMobile) userPrompt += `\nDesign mobile-first.`;

      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        tools: isGrounded ? [{ googleSearch: {} } as any] : [],
      });

      for await (const chunk of result.stream) {
        if (abortSignal?.aborted) break;
        const text = chunk.text();
        if (text) yield text;
      }
      
      return; // Success

    } catch (e: any) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      const isQuotaError = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');

      if (isQuotaError && !userApiKey && currentKey) {
        exhaustedKeys.add(currentKey);
        attempt++;
        if (attempt < maxAttempts) continue;
      }
      throw e;
    }
  }
}
