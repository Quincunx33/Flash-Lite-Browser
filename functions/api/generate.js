import { GoogleGenAI } from "@google/genai";

export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const { prompt, currentPageHtml, isGrounded, formState, isMobile, userApiKey, strictUserKey } = await request.json();

    // 1. Key Retrieval
    let apiKey = userApiKey && userApiKey.length > 5 ? userApiKey : null;
    
    if (!apiKey && !strictUserKey) {
      const keys = [
        env.GEMINI_API_KEY_1,
        env.GEMINI_API_KEY_2,
        env.GEMINI_API_KEY_3,
        env.GEMINI_API_KEY_4,
        env.GEMINI_API_KEY
      ].filter(k => k && k.trim() !== "");
      
      apiKey = keys[0] || null; // Simplified for the function worker
    }

    if (!apiKey) {
      return new Response(JSON.stringify({ error: { message: "No API key found." } }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const genAI = new GoogleGenAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash-latest',
      systemInstruction: "You are Flash-Lite Browser. Generate complete HTML pages using Tailwind CSS. Return ONLY the HTML code."
    });

    const userPrompt = currentPageHtml 
      ? `Update this page: "${prompt}"\nCurrent HTML: ${currentPageHtml}`
      : `Generate a new page: "${prompt}"`;

    const result = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      tools: isGrounded ? [{ googleSearch: {} }] : []
    });

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      try {
        for await (const chunk of result.stream) {
          const text = chunk.text();
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
