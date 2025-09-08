/**
 * Extracts and normalizes a display name from user input.
 * Removes common filler words and applies title case formatting.
 * 
 * @param {string} input - Raw user input string
 * @returns {string} Normalized display name in title case
 */
function extractDisplayName(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Normalize whitespace and convert to lowercase for processing
  const normalized = input.trim().toLowerCase();
  
  // Common filler words/phrases to remove (English and Arabic)
  const fillerPatterns = [
    /^my\s+name\s+is\s+/,
    /^call\s+me\s+/,
    /^i\s+am\s+/,
    /^i'm\s+/,
    /^this\s+is\s+/,
    /^it's\s+/,
    /^اسمي\s+/,        // "my name is" in Arabic
    /^ادعني\s+/,       // "call me" in Arabic
    /^انا\s+/,         // "I am" in Arabic
  ];

  // Remove filler patterns from the beginning
  let cleaned = normalized;
  for (const pattern of fillerPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Split into words and filter
  const words = cleaned
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word => word.length > 0);

  // Find the end of the name by looking for common stop words
  const stopWords = [
    'from', 'in', 'at', 'please', 'thanks', 'thank', 'you',
    'here', 'there', 'and', 'or', 'but', 'so', 'then',
    'من', 'في', 'عند', 'لو', 'سمحت', 'شكرا', 'شكراً'  // Arabic stop words
  ];

  const nameWords = [];
  for (const word of words) {
    // Remove punctuation except apostrophes and hyphens
    const cleanWord = word.replace(/[^\w\u0600-\u06FF'-]/g, '');
    
    if (!cleanWord) continue;
    
    // Stop if we hit a stop word
    if (stopWords.includes(cleanWord.toLowerCase())) {
      break;
    }
    
    // Only keep words that contain letters (including Arabic)
    if (/[\w\u0600-\u06FF]/.test(cleanWord)) {
      nameWords.push(cleanWord);
    }
    
    // Limit to 4 name tokens maximum
    if (nameWords.length >= 4) {
      break;
    }
  }

  // Convert to title case
  const titleCased = nameWords.map(word => {
    // Handle special cases with apostrophes and hyphens
    if (word.includes("'") || word.includes('-')) {
      return word
        .split(/(['-])/)
        .map(part => {
          if (part === "'" || part === '-') return part;
          if (part.length === 0) return part;
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join('');
    }
    
    // Standard title case
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });

  return titleCased.join(' ');
}

module.exports = { extractDisplayName };
