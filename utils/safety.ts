/**
 * Safety validation utility for filtering inappropriate prompts (e.g. pornographic sites, gambling, malicious requests).
 */

const BANNED_KEYWORDS = [
  // Pornographic & Adult content (English)
  'porn', 'xxx', 'sexx', 'adult', 'erotic', 'nsfw', 'naked', 'breast', 'penis', 
  'vagina', 'pussy', 'blowjob', 'hentai', 'nudity', 'nude', 'milf', 'masturbate', 
  'orgasm', 'playboy', 'stripclub', 'onlyfans', 'brazzer', 'pornhub', 'xvideos',
  'escort', 'dating18', 'hotgirls', 'redtube', 'kamasingha', 'camgirl', 'chaturbate',
  'incest', 'seduction', 'playmate', 'hardcore sex',

  // Pornographic & Adult content (Bengali)
  'যৌন', 'চটি', 'মাগি', 'সেক্স', 'পরকীয়া', 'স্তন', 'লিঙ্গ', 'বেশ্যা', 'খানকি', 
  'লুচ্চা', 'হস্তমৈথুন', 'নগ্ন', 'কামুক', 'সহবাস', 'সঙ্গম', 'ধর্ষন', 'ধর্ষণ', 'চুদা', 'চুদ',
  'মাগী', 'যৌনসুখ', 'যৌন মিলন', 'কামক্রীড়া', 'কামরস', 'পুরুষাঙ্গ', 'স্ত্রীঅঙ্গ',

  // Gambling & Casino (Often considered inappropriate/scam sites)
  'casino', 'gambling', '1xbet', 'linebet', 'baji999', 'melbet', 'jeetbuzz', 'betting',
  'পজি', 'জুয়া', 'ক্যাসিনো', 'বাজি ধরা',

  // Malicious/Hacking (Inappropriate utilities)
  'phishing', 'spyware', 'malware', 'hack tool', 'ddos tool', 'exploit pack'
];

const BANNED_EXACT_REGEXES = [
  /\bsex\b/i,
  /\bass\b/i,
  /\bcum\b/i,
  /\bgay\b/i,
  /\blesbian\b/i,
  /\bballs\b/i
];

export interface SafetyResult {
  isSafe: boolean;
  reason?: string;
  reasonBn?: string;
}

/**
 * Checks if a user prompt contains inappropriate, unsafe, or adult keywords/phrases.
 * Supports both English and Bengali content.
 */
export function checkPromptSafety(prompt: string): SafetyResult {
  if (!prompt || typeof prompt !== 'string') {
    return { isSafe: true };
  }

  const lowercase = prompt.toLowerCase();
  
  // Clean all spacing and special symbols to prevent simple obfuscation (e.g., "p o r n" or "p_o_r_n")
  const cleaned = lowercase.replace(/[^a-z0-9\u0980-\u09ff]/g, '');

  // 1. Direct keyword/substring checks
  for (const keyword of BANNED_KEYWORDS) {
    if (lowercase.includes(keyword) || cleaned.includes(keyword)) {
      return {
        isSafe: false,
        reason: `Your request contains content that violates our safety guidelines (adult/inappropriate content).`,
        reasonBn: `আপনার অনুরোধটি আমাদের নিরাপত্তা নীতি লঙ্ঘন করে (প্রাপ্তবয়স্কদের বা অনুপযুক্ত বিষয়বস্তু)।`
      };
    }
  }

  // 2. Exact word boundary checks (avoids false-positives like matching "class", "glass", "assess" for "ass")
  for (const regex of BANNED_EXACT_REGEXES) {
    if (regex.test(prompt)) {
      return {
        isSafe: false,
        reason: `Your request contains content that violates our safety guidelines (adult/inappropriate content).`,
        reasonBn: `আপনার অনুরোধটি আমাদের নিরাপত্তা নীতি লঙ্ঘন করে (প্রাপ্তবয়স্কদের বা অনুপযুক্ত বিষয়বস্তু)।`
      };
    }
  }

  return { isSafe: true };
}
