# Flash-Lite Browser ⚡️🌐

Imagine any website, generated in real-time. Flash-Lite is an AI-powered "browser" that uses Gemini 3.1 Flash-Lite to construct web pages on the fly based on your prompts or navigation intent.

## 🚀 Key Features

- **Real-Time Generation**: Simply type a URL or a description, and the AI builds the page instantly using Tailwind CSS.
- **Key Rotation System**: Supports up to 4 system-wide Gemini API keys. If one key hits a rate limit (429 Error), the browser automatically rotates to the next available key to ensure uninterrupted browsing.
- **Custom Key Toggle**: Users can choose to use their own personal Gemini API key. There is a specific toggle in the settings (⋮) to force the browser to **only** use the provided custom key, bypassing the system pool.
- **Google Search Grounding**: Toggle search grounding to ensure the generated pages contain real-time facts, names, and statistics.
- **PWA Ready**: Installable as a progressive web app for a native-like experience.
- **Safety First**: Integrated anti-phishing disclaimer and safety checks.

## 🛠️ Environment Setup

To enable the automatic key rotation, add the following to your environment variables (or `.env` file for local development):

```env
# System Key Pool (Optional, for automatic rotation)
GEMINI_API_KEY_1=your_key_here
GEMINI_API_KEY_2=your_key_here
GEMINI_API_KEY_3=your_key_here
GEMINI_API_KEY_4=your_key_here
```

## 📖 How to Use

1. **Navigate**: Enter a prompt like "A futuristic dashboard for a Mars colony" or a mock URL like `mars.com`.
2. **Interact**: The browser tracks state. You can fill out forms, click buttons, or follow links—the AI will understand the context and generate the next state.
3. **Settings**: Click the three dots (⋮) in the address bar to:
   - Add your own **Custom API Key**.
   - Enable **"Use Custom Key Only"** to strictly use your key.
   - Toggle **Search Grounding** for factual accuracy.
   - View **Token Usage** statistics for every generated page.

## 🛡️ Safety Notice
This tool is for design and simulation purposes. It includes strict anti-phishing warnings to prevent the generation of deceptive login or banking interfaces.
