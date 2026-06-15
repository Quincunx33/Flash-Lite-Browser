import React, { useState } from 'react';

interface NewTabProps {
  onCreatePage: (prompt: string) => void;
}

const LUCKY_PROMPTS = [
  "A color palette generator with contrast ratios and accessibility scores",
  "A flight departure board for a retro-futuristic airport terminal",
  "A cocktail recipe builder where you pick ingredients and it suggests drinks",
  "A volcano monitoring dashboard with seismic activity and alert levels",
  "A deep sea creature field guide with depth zones and habitat maps",
  "A transit route planner showing connections, fares, and travel times",
  "A space mission log with crew profiles, experiments, and status updates",
  "A vintage vinyl record collection catalog sorted by genre and decade",
  "A hiking trail directory with elevation profiles and difficulty ratings",
  "A ferry timetable for an island archipelago with route maps",
];

export const NewTab: React.FC<NewTabProps> = ({ onCreatePage }) => {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) {
      onCreatePage(prompt.trim());
    }
  };

  const handleHowItWorks = () => {
    onCreatePage(
      `A docs page for "Flash-Lite Browser" — a demo powered by Gemini 3.1 Flash-Lite, a model released in March 2026.` +
      `The Flash-Lite Browser demo works by sending the user's description to the Gemini API, and Gemini generates a complete HTML page in real-time using streaming.` +
      `The page is rendered live in an iframe as tokens arrive. Links within the page trigger new prompts to Gemini, so users can navigate an entirely AI-generated web. ` +
      `Introduce the Flash-Lite Browser in the docs, how every page is generated in realtime by Gemini 3.1 Flash-Lite, how each click becomes a new prompt, generated based on the previous page. ` +
      `All pages are generated from scratch using a prompt, including this one. Stat that this is enabled by the speed and coding capabilities of Gemini 3.1 Flash-Lite.` +
      `Add that this is an experiment only, Gemini can make mistakes, results may vary. Don't make claims about 'worlds first' or 'groundbreaking'.` +
      `Empasize that every page (*including this one*!) is generated from scratch. Generations use the previous page only, there is no state apart from the previous page.` +
      `Add a call to action of 'See Examples' which takes the user to a page with examples of things Gemini can generate.`
    );
  };

  const handleLucky = () => {
    if (prompt.trim().length >= 3) {
      onCreatePage(prompt.trim());
    } else {
      const randomPrompt = LUCKY_PROMPTS[Math.floor(Math.random() * LUCKY_PROMPTS.length)];
      onCreatePage(randomPrompt);
    }
  };

  return (
    <div className="newtab-page">
      <div className="newtab-content">
        {/* Branding — visible only on mobile (CSS-controlled) */}
        <div className="newtab-branding">
          <h1 className="newtab-brand-title">Flash-Lite Browser</h1>
          <p className="newtab-brand-subtitle">Imagine any website, generated in real-time by Gemini 3.1 Flash-Lite</p>
        </div>

        <form onSubmit={handleSubmit} className="newtab-form">
          <div className="newtab-input-row">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="newtab-input"
              placeholder="Imagine any website..."
              aria-label="Describe a website to generate"
              autoFocus
            />
            <button type="submit" className="newtab-submit" aria-label="Submit">
              <span className="material-symbols-outlined">keyboard_return</span>
            </button>
          </div>
        </form>

        <div className="newtab-buttons">
          <button onClick={handleHowItWorks} className="newtab-btn newtab-how-it-works">
            How does this work?
          </button>
          <button onClick={handleLucky} className="newtab-btn newtab-lucky">
            I'm Feeling Lucky
          </button>
        </div>
      </div>
    </div>
  );
};