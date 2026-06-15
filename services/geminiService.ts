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
      let errorMessage = "Generation failed.";
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorMessage;
      } catch (e) {
        errorMessage = `Server error (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Connection failed.");

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value, { stream: true });
      if (!text) continue;

      // Handle split chunks that might contain the error marker
      if (text.includes("__ERROR__")) {
        const parts = text.split("__ERROR__");
        if (parts[0]) yield parts[0];
        throw new Error(parts[1] || "Unknown server error");
      }
      yield text;
    }
  } catch (error: any) {
    if (error.name === 'AbortError') return;
    throw error;
  }
}
