import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export const DisclaimerPopup: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const hasAccepted = localStorage.getItem('disclaimer_accepted');
    if (!hasAccepted) {
      setIsOpen(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('disclaimer_accepted', 'true');
    setIsOpen(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="max-w-md w-full bg-[#1c1c1e] border border-[#3c3c3e] rounded-2xl p-8 shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-6 text-[#ff453a]">
              <span className="material-symbols-outlined text-4xl">warning</span>
              <h2 className="text-2xl font-bold text-white tracking-tight">Safety Disclaimer</h2>
            </div>

            <div className="space-y-4 text-[#c7c7cc] text-sm leading-relaxed">
              <p>
                This tool is an AI-powered simulation engine for design and development purposes only.
              </p>
              
              <div className="bg-[#2c2c2e] p-4 rounded-xl border-l-4 border-[#ff453a]">
                <p className="font-semibold text-white mb-1 uppercase tracking-wider text-[10px]">Anti-Phishing Warning</p>
                <p>
                  You are strictly prohibited from using this tool to simulate login pages, bank portals, or any interface designed to deceive users or steal credentials.
                </p>
              </div>

              <p>
                By clicking "I Understand", you agree to use this tool ethically and comply with all anti-phishing regulations. Any misuse for malicious activities is a violation of service terms.
              </p>
            </div>

            <button
              onClick={handleAccept}
              className="mt-8 w-full py-4 bg-[#0a84ff] hover:bg-[#007aff] text-white font-semibold rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-[#0a84ff]/20"
            >
              I Understand & Agree
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
