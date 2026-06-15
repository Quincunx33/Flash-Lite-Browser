import { GoogleGenAI } from "@google/genai";
import { TokenCount } from '../types';

let aiInstance: GoogleGenAI | null = null;
let currentKey: string | null = null;

function getAi(userKey?: string) {
  const apiKey = userKey || process.env.GEMINI_API_KEY;
  
  if (!apiKey || apiKey === 'undefined') {
    throw new Error("GEMINI_API_KEY is missing. Please enter your API key in the Settings menu (⋮).");
  }

  // If the key has changed, re-initialize the instance
  if (aiInstance && currentKey === apiKey) {
    return aiInstance;
  }
  
  currentKey = apiKey;
  aiInstance = new GoogleGenAI({ apiKey });
  return aiInstance;
}

const MODEL_NAME = 'gemini-3.1-flash-lite-preview'; 

const SYSTEM_PROMPT = `
You are powered by Gemini 3.1 Flash-Lite, a new fast, light-weight model released in March 2026. You generate complete web pages as HTML documents.

STRUCTURE:
Return a full HTML document with a <head> and a <body>:

<html>
<head>
  <title>SiteName - Page Name</title>
  <meta name="color-scheme" content="light">
  <link href="https://fonts.googleapis.com/css2?family=ChosenFont:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="font-family: 'Chosen Font', sans-serif">
  ...page content...
</body>
</html>

Keep the <head> minimal — just the <title>, <meta name="color-scheme">, and a Google Fonts <link>. Tailwind CSS and scripts are injected automatically.
The <title> format is: "SiteName - PageName" eg. "UKNews - Home".
Set color-scheme to "light" or "dark" — choose whichever suits the site. Use only one.

STYLING:
Use Tailwind CSS utility classes for all styling. Create rich, polished, realistic-looking pages.
Use Google Fonts for the site. Include the <link> tag in <head> and apply the font via an inline style on the <body> tag (e.g., style="font-family: 'Playfair Display', serif"). Each site should feel typographically distinct.
For icons, use Material Symbols: <span class="material-symbols-outlined">icon_name</span> (e.g., home, search, settings, favorite, delete, mail, star).
Use emojis generously for visual flair and as image placeholders.
For images, use CSS gradients, inline SVGs, or emoji placeholders.

NAVIGATION:
Use <a href="..."> tags with descriptive path-like hrefs (e.g., href="inbox/message-from-alice", href="settings/notifications").
Every link should have a meaningful href.

INTERACTIVITY:
For actions that change the current page state (e.g., archiving, submitting, toggling), call:
  window.FlashLiteAPI.performAction('Description of intent', 'Optional payload')
Examples:
  <button onclick="FlashLiteAPI.performAction('Archive email 42')">Archive</button>
  <form onsubmit="event.preventDefault(); FlashLiteAPI.performAction('Search', this.q.value)">

CONTENT:
Fill every page with rich, plausible, detailed content. Make it feel like a real website.
`;

export interface GenerationResult {
  tokenCount: TokenCount;
}

/**
 * Unified page generation — handles both create and edit.
 * - If currentPageHtml is provided → edit mode (update based on prompt)
 * - If currentPageHtml is null → create mode (generate from scratch)
 * 
 * Yields HTML chunks as they stream in.
 * After the stream completes, the final yield is a GenerationResult object (as JSON string prefixed with __META__).
 */
export async function* streamPageGeneration(
  prompt: string,
  currentPageHtml: string | null = null,
  isGrounded: boolean = false,
  abortSignal?: AbortSignal,
  formState?: Array<{ name: string; type: string; value: string }>,
  isMobile: boolean = false,
  userApiKey?: string,
): AsyncGenerator<string> {
  const isEdit = currentPageHtml !== null;

  let userPrompt: string;
  if (isEdit) {
    const formStateBlock = formState && formState.length > 0
      ? `\n\nThe user entered the following values into input fields on the previous page:\n${formState.map(f => `- ${f.name || 'unnamed'} (${f.type}): "${f.value}"`).join('\n')}\n`
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

  // When grounding is on, encourage the model to use search
  if (isGrounded) {
    userPrompt += `\nIMPORTANT: You have access to Google Search. Use it to find current, accurate data for populating the page content. Always ground the page in search results — use real names, real statistics, real facts from your Google searches.\n`;
  }

  // Mobile-first layout instructions
  if (isMobile) {
    userPrompt += `\nIMPORTANT: The user is on a MOBILE device with a narrow viewport. Design mobile-first:\n- Use a single-column layout\n- Use responsive Tailwind classes)\n- Avoid horizontal scrolling\n- Stack elements vertically\n- Keep navigation simple\n`;
  }

  const config: any = {
    systemInstruction: SYSTEM_PROMPT,
  };

  if (isGrounded) {
    config.tools = [{ googleSearch: {} }];
  }

  try {
    // Pre-flight: get exact input token count
    let inputTokens = 0;
    try {
      const countResult = await getAi(userApiKey).models.countTokens({
        model: MODEL_NAME,
        contents: [
          { role: 'user', parts: [{ text: config.systemInstruction || '' }] },
          { role: 'user', parts: [{ text: userPrompt }] },
        ],
      });
      inputTokens = countResult.totalTokens || 0;
    } catch (e) {
      console.warn('countTokens failed, will use usageMetadata:', e);
    }

    // Yield initial token estimate (exact input, zero output)
    yield `__TOKEN__${JSON.stringify({ input: inputTokens, output: 0, isEstimate: true })}`;

    const responseStream = await getAi(userApiKey).models.generateContentStream({
      model: MODEL_NAME,
      contents: userPrompt,
      config: { ...config, ...(abortSignal ? { abortSignal } : {}) }
    });

    let outputTokens = 0;
    let totalChars = 0;
    let groundingSources: Array<{ title: string; uri: string }> = [];
    let searchEntryPointHtml = '';

    for await (const chunk of responseStream) {
      // Collect token usage from response metadata (populated on final chunk)
      if (chunk.usageMetadata) {
        if (chunk.usageMetadata.promptTokenCount) {
          inputTokens = chunk.usageMetadata.promptTokenCount;
        }
        outputTokens = chunk.usageMetadata.candidatesTokenCount || 0;
      }
      // Capture grounding metadata (typically on the final chunk)
      const groundingMeta = chunk.candidates?.[0]?.groundingMetadata;
      if (groundingMeta?.groundingChunks?.length) {
        groundingSources = groundingMeta.groundingChunks
          .filter((c: any) => c.web?.uri && c.web?.title)
          .map((c: any) => ({ title: c.web.title, uri: c.web.uri }));
      }
      if (groundingMeta?.searchEntryPoint?.renderedContent) {
        searchEntryPointHtml = groundingMeta.searchEntryPoint.renderedContent;
      }
      if (chunk.text) {
        totalChars += chunk.text.length;
        // Estimate output tokens: ~4 chars per token
        const estimatedOutput = Math.round(totalChars / 4);
        yield `__TOKEN__${JSON.stringify({ input: inputTokens, output: estimatedOutput, isEstimate: true })}`;
        yield chunk.text;
      }
    }

    // Yield final confirmed metadata (exact values from usageMetadata)
    yield `__META__${JSON.stringify({ tokenCount: { input: inputTokens, output: outputTokens }, groundingSources, searchEntryPointHtml })}`;

  } catch (error) {
    console.error("Gemini Stream Error:", error);
    yield `<div class="p-8 text-red-600"><h1>Generation Error</h1><p>${error}</p></div>`;
  }
}