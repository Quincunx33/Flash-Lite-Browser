import { GoogleGenAI } from "@google/genai";

export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const { prompt, currentPageHtml, isGrounded, formState, isMobile, userApiKey, strictUserKey } = await request.json();

    // 1. Key Retrieval
    let apiKey = userApiKey && typeof userApiKey === 'string' && userApiKey.trim().length > 10 ? userApiKey.trim() : null;
    
    if (!apiKey && !strictUserKey) {
      const keys = [
        env.GEMINI_API_KEY_1,
        env.GEMINI_API_KEY_2,
        env.GEMINI_API_KEY_3,
        env.GEMINI_API_KEY_4,
        env.GEMINI_API_KEY
      ].map(k => k?.trim()).filter(k => k && k.length > 10);
      
      apiKey = keys[0] || null;
    }

    if (!apiKey) {
      return new Response(JSON.stringify({ 
        error: { 
          message: strictUserKey 
            ? "Custom API Key is required but missing or invalid. Please check your settings." 
            : "Server configuration error: No Gemini API keys found. Please set GEMINI_API_KEY in your dashboard." 
        } 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Initialize with safe check
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const userPrompt = currentPageHtml 
      ? `Update this page: "${prompt}"\nCurrent HTML: ${currentPageHtml}`
      : `Generate a new page: "${prompt}"`;

    const streamResponse = await ai.models.generateContentStream({
      model: 'gemini-3.1-flash-lite',
      systemInstruction: "You are Flash-Lite Browser. Generate complete HTML pages using Tailwind CSS. Return ONLY the HTML code.",
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      tools: isGrounded ? [{ googleSearch: {} }] : []
    });

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      try {
        for await (const chunk of streamResponse) {
          const text = chunk.text;
          if (text) {
            await writer.write(encoder.encode(text));
          }
        }
      } catch (err) {
        await writer.write(encoder.encode(`\n\n__ERROR__${err.message}`));
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: { 
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked"
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: { message: err.message } }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
