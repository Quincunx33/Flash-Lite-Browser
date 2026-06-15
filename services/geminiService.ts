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
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        currentPageHtml,
        isGrounded,
        formState,
        isMobile,
        userApiKey,
        strictUserKey
      }),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || "Generation failed.");
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Connection failed.");

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value, { stream: true });
      if (text.includes("__ERROR__")) {
        throw new Error(text.split("__ERROR__")[1]);
      }
      yield text;
    }
  } catch (error: any) {
    if (error.name === 'AbortError') return;
    throw error;
  }
}
