import { TokenCount } from '../types';

export const MODEL_NAME = 'gemini-3.1-flash-lite'; 

export const SYSTEM_PROMPT = `
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
 * Yields HTML chunks as they stream in.
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
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        currentPageHtml,
        isGrounded,
        formState,
        isMobile,
        userApiKey
      }),
      signal: abortSignal
    });

    if (!response.ok) {
      let errorMessage = 'Failed to generate page';
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        // If not JSON, maybe it's a 404 or something else
        errorMessage = `Error ${response.status}: ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      yield text;
    }
  } catch (error) {
    if ((error as any).name === 'AbortError') return;
    console.error("Gemini Stream Error:", error);
    yield `<div class="p-8 text-red-600"><h1>Generation Error</h1><p>${error}</p></div>`;
  }
}
