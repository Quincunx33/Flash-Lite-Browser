import { GoogleGenAI } from "@google/genai";

interface Env {
  GEMINI_API_KEY_1?: string;
  GEMINI_API_KEY_2?: string;
  GEMINI_API_KEY_3?: string;
  GEMINI_API_KEY_4?: string;
}

const MODEL_NAME = 'gemini-3.1-flash-lite';

const SYSTEM_PROMPT = `
You are powered by Gemini 3.1 Flash-Lite, a new fast, light-weight model released in March 2026. You generate complete web pages as HTML documents.
Return a full HTML document including <head> and <body>.
Use Tailwind CSS for styling.
Include Material Symbols for icons.
Fill the page with rich, realistic content.
`;

type PagesFunction<T = any> = (context: { request: Request; env: T }) => Promise<Response>;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const body: any = await request.json();
    const { prompt, currentPageHtml, isGrounded, formState, isMobile, userApiKey } = body;

    // API Key Rotation Logic
    let apiKey = userApiKey && userApiKey.trim() !== '' ? userApiKey : null;
    let usedSystemKey = false;
    
    if (!apiKey) {
      const systemKeys = [
        env.GEMINI_API_KEY_1,
        env.GEMINI_API_KEY_2,
        env.GEMINI_API_KEY_3,
        env.GEMINI_API_KEY_4
      ].map(k => k?.trim()).filter(k => k && k !== 'undefined' && k !== '');

      if (systemKeys.length > 0) {
        apiKey = systemKeys[Math.floor(Math.random() * systemKeys.length)];
        usedSystemKey = true;
      }
    }

    if (!apiKey) {
      return new Response(JSON.stringify({ 
        error: "No API key available. Please add GEMINI_API_KEY_1-4 in Cloudflare Pages 'Variables and secrets' for both Production and Preview environments." 
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

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
      userPrompt = `Update this page based on: "${prompt}".\nReturn full updated HTML.\n${formStateBlock}\nCURRENT HTML:\n${currentPageHtml}`;
    } else {
      userPrompt = `Generate a new web page for: "${prompt}".`;
    }

    if (isGrounded) {
       userPrompt += `\nUse Google Search to ground the content in real-world data.`;
    }

    const responseStream = await ai.models.generateContentStream({
      model: MODEL_NAME,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: isGrounded ? [{ googleSearch: {} }] : undefined,
      }
    });

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Process stream in background
    (async () => {
      // Send immediate initial marker so UI shows Loading state right away
      await writer.write(encoder.encode(`__TOKEN__${JSON.stringify({ input: 0, output: 0, isEstimate: true })}`));

      let inputTokens = 0;

      // Try to get input tokens first
      try {
        const countResult = await ai.models.countTokens({
          model: MODEL_NAME,
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        });
        inputTokens = countResult.totalTokens || 0;
      } catch (e) {
        console.warn("Input token count failed, using estimate", e);
        inputTokens = Math.round(userPrompt.length / 4);
      }

      // Send initial token counts
      await writer.write(encoder.encode(`__TOKEN__${JSON.stringify({ input: inputTokens, output: 0, isEstimate: true })}`));

      let outputTokens = 0;
      let totalChars = 0;
      let groundingSources: any[] = [];
      let searchEntryPointHtml = '';

      try {
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
            // Send tokens marker
            await writer.write(encoder.encode(`__TOKEN__${JSON.stringify({ input: inputTokens, output: estimatedOutput, isEstimate: outputTokens === 0 })}`));
            await writer.write(encoder.encode(text));
          }
        }
        // Send final metadata
        await writer.write(encoder.encode(`__META__${JSON.stringify({ tokenCount: { input: inputTokens, output: outputTokens }, groundingSources, searchEntryPointHtml })}`));
        await writer.close();
      } catch (err: any) {
        await writer.write(encoder.encode(`\n\nERROR: ${err.message}`));
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: { 
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked'
      }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
