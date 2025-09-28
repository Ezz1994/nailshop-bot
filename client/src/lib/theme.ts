// Theme utility for handling VITE environment variables
// Supports both HSL ("340 82% 52%") and HEX ("#ff00aa") color formats

/**
 * Validates if a string is a valid hex color
 */
export function isValidHexColor(color: string): boolean {
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
}

/**
 * Validates if a string is a valid HSL color (without hsl() wrapper)
 */
export function isValidHslColor(color: string): boolean {
  // Matches formats like "340 82% 52%" or "0 0% 100%"
  return /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(color.trim());
}

/**
 * Converts hex color to HSL format for CSS custom properties
 */
export function hexToHsl(hex: string): string {
  // Remove the hash if present
  hex = hex.replace('#', '');
  
  // Parse r, g, b values
  const r = parseInt(hex.substr(0, 2), 16) / 255;
  const g = parseInt(hex.substr(2, 2), 16) / 255;
  const b = parseInt(hex.substr(4, 2), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Normalizes color to HSL format for CSS custom properties
 */
export function normalizeColor(color: string): string {
  if (!color) return '';
  
  const trimmed = color.trim();
  
  if (isValidHexColor(trimmed)) {
    return hexToHsl(trimmed);
  }
  
  if (isValidHslColor(trimmed)) {
    return trimmed;
  }
  
  console.warn(`Invalid color format: ${color}. Expected hex (#ff00aa) or HSL (340 82% 52%)`);
  return '';
}

/**
 * Applies VITE environment variables as CSS custom properties
 */
export function initializeTheme(): void {
  const root = document.documentElement;
  
  // Get all VITE environment variables
  const env = import.meta.env;
  
  console.log('Initializing theme with environment variables:', env);
  
  // App metadata
  if (env.VITE_APP_NAME) {
    root.style.setProperty('--app-name', env.VITE_APP_NAME);
  }
  
  if (env.VITE_APP_LOGO) {
    root.style.setProperty('--app-logo', env.VITE_APP_LOGO);
  }
  
  // Primary colors
  if (env.VITE_PRIMARY_COLOR) {
    const normalizedColor = normalizeColor(env.VITE_PRIMARY_COLOR);
    if (normalizedColor) {
      root.style.setProperty('--primary', normalizedColor);
    }
  }
  
  if (env.VITE_PRIMARY_FOREGROUND) {
    const normalizedColor = normalizeColor(env.VITE_PRIMARY_FOREGROUND);
    if (normalizedColor) {
      root.style.setProperty('--primary-foreground', normalizedColor);
    }
  }
  
  // Secondary colors
  if (env.VITE_SECONDARY_COLOR) {
    const normalizedColor = normalizeColor(env.VITE_SECONDARY_COLOR);
    if (normalizedColor) {
      root.style.setProperty('--secondary', normalizedColor);
    }
  }
  
  if (env.VITE_SECONDARY_FOREGROUND) {
    const normalizedColor = normalizeColor(env.VITE_SECONDARY_FOREGROUND);
    if (normalizedColor) {
      root.style.setProperty('--secondary-foreground', normalizedColor);
    }
  }
  
  // Background colors
  if (env.VITE_BACKGROUND_COLOR) {
    const normalizedColor = normalizeColor(env.VITE_BACKGROUND_COLOR);
    if (normalizedColor) {
      root.style.setProperty('--background', normalizedColor);
    }
  }
  
  if (env.VITE_BACKGROUND_GRADIENT_FROM) {
    const normalizedColor = normalizeColor(env.VITE_BACKGROUND_GRADIENT_FROM);
    if (normalizedColor) {
      root.style.setProperty('--background-gradient-from', normalizedColor);
    }
  }
  
  if (env.VITE_BACKGROUND_GRADIENT_TO) {
    const normalizedColor = normalizeColor(env.VITE_BACKGROUND_GRADIENT_TO);
    if (normalizedColor) {
      root.style.setProperty('--background-gradient-to', normalizedColor);
    }
  }
  
  // Header colors
  if (env.VITE_HEADER_BACKGROUND) {
    const normalizedColor = normalizeColor(env.VITE_HEADER_BACKGROUND);
    if (normalizedColor) {
      root.style.setProperty('--header-bg', normalizedColor);
    }
  }
  
  if (env.VITE_HEADER_TEXT_COLOR) {
    const normalizedColor = normalizeColor(env.VITE_HEADER_TEXT_COLOR);
    if (normalizedColor) {
      root.style.setProperty('--header-text', normalizedColor);
    }
  }
  
  // Status colors
  const statusTypes = ['CONFIRMED', 'ARRIVED', 'DONE', 'CANCELLED'];
  statusTypes.forEach(status => {
    const bgKey = `VITE_STATUS_${status}_BG`;
    const textKey = `VITE_STATUS_${status}_TEXT`;
    const borderKey = `VITE_STATUS_${status}_BORDER`;
    
    if (env[bgKey]) {
      const normalizedColor = normalizeColor(env[bgKey]);
      if (normalizedColor) {
        root.style.setProperty(`--status-${status.toLowerCase()}-bg`, normalizedColor);
      }
    }
    
    if (env[textKey]) {
      const normalizedColor = normalizeColor(env[textKey]);
      if (normalizedColor) {
        root.style.setProperty(`--status-${status.toLowerCase()}-text`, normalizedColor);
      }
    }
    
    if (env[borderKey]) {
      const normalizedColor = normalizeColor(env[borderKey]);
      if (normalizedColor) {
        root.style.setProperty(`--status-${status.toLowerCase()}-border`, normalizedColor);
      }
    }
  });
  
  // Button colors
  const buttonTypes = ['SAVE', 'CANCEL', 'DONE'];
  buttonTypes.forEach(button => {
    const bgKey = `VITE_${button}_BUTTON_BG`;
    const hoverKey = `VITE_${button}_BUTTON_HOVER`;
    
    if (env[bgKey]) {
      const normalizedColor = normalizeColor(env[bgKey]);
      if (normalizedColor) {
        root.style.setProperty(`--${button.toLowerCase()}-button-bg`, normalizedColor);
      }
    }
    
    if (env[hoverKey]) {
      const normalizedColor = normalizeColor(env[hoverKey]);
      if (normalizedColor) {
        root.style.setProperty(`--${button.toLowerCase()}-button-hover`, normalizedColor);
      }
    }
  });
  
  // Walk-in button colors
  if (env.VITE_WALKIN_BUTTON_BG) {
    const normalizedColor = normalizeColor(env.VITE_WALKIN_BUTTON_BG);
    if (normalizedColor) {
      root.style.setProperty('--walkin-button-bg', normalizedColor);
      console.log('Set --walkin-button-bg to:', normalizedColor);
    }
  }
  
  if (env.VITE_WALKIN_BUTTON_HOVER) {
    const normalizedColor = normalizeColor(env.VITE_WALKIN_BUTTON_HOVER);
    if (normalizedColor) {
      root.style.setProperty('--walkin-button-hover', normalizedColor);
      console.log('Set --walkin-button-hover to:', normalizedColor);
    }
  }

  if (env.VITE_WALKIN_BUTTON_TEXT) {
    const normalizedColor = normalizeColor(env.VITE_WALKIN_BUTTON_TEXT);
    if (normalizedColor) {
      root.style.setProperty('--walkin-button-text', normalizedColor);
      console.log('Set --walkin-button-text to:', normalizedColor);
    }
  }
  
  // Feature flags
  if (env.VITE_SHOW_SERVICES_MENU !== undefined) {
    root.style.setProperty('--show-services-menu', env.VITE_SHOW_SERVICES_MENU);
  }
  
  if (env.VITE_SHOW_EXPORT_MENU !== undefined) {
    root.style.setProperty('--show-export-menu', env.VITE_SHOW_EXPORT_MENU);
  }

  // Walk-in button visibility flags
  if (env.VITE_SHOW_WALKIN_BUTTON_TODAY !== undefined) {
    root.style.setProperty('--show-walkin-button-today', env.VITE_SHOW_WALKIN_BUTTON_TODAY);
  }

  if (env.VITE_SHOW_WALKIN_BUTTON_DAY !== undefined) {
    root.style.setProperty('--show-walkin-button-day', env.VITE_SHOW_WALKIN_BUTTON_DAY);
  }

  if (env.VITE_SHOW_WALKIN_BUTTON_CALENDAR !== undefined) {
    root.style.setProperty('--show-walkin-button-calendar', env.VITE_SHOW_WALKIN_BUTTON_CALENDAR);
  }

  // Walk-in button text customization
  if (env.VITE_WALKIN_BUTTON_TEXT_TODAY) {
    root.style.setProperty('--walkin-button-text-today', `"${env.VITE_WALKIN_BUTTON_TEXT_TODAY}"`);
  }

  if (env.VITE_WALKIN_BUTTON_TEXT_DAY) {
    root.style.setProperty('--walkin-button-text-day', `"${env.VITE_WALKIN_BUTTON_TEXT_DAY}"`);
  }

  if (env.VITE_WALKIN_BUTTON_TEXT_EMPTY) {
    root.style.setProperty('--walkin-button-text-empty', `"${env.VITE_WALKIN_BUTTON_TEXT_EMPTY}"`);
  }

  // Navigation button colors
  if (env.VITE_NAV_BUTTON_ACTIVE_BG) {
    const normalizedColor = normalizeColor(env.VITE_NAV_BUTTON_ACTIVE_BG);
    if (normalizedColor) {
      root.style.setProperty('--nav-button-active-bg', normalizedColor);
      console.log('Set --nav-button-active-bg to:', normalizedColor);
    }
  }

  if (env.VITE_NAV_BUTTON_ACTIVE_TEXT) {
    const normalizedColor = normalizeColor(env.VITE_NAV_BUTTON_ACTIVE_TEXT);
    if (normalizedColor) {
      root.style.setProperty('--nav-button-active-text', normalizedColor);
      console.log('Set --nav-button-active-text to:', normalizedColor);
    }
  }

  if (env.VITE_NAV_BUTTON_ACTIVE_BORDER) {
    const normalizedColor = normalizeColor(env.VITE_NAV_BUTTON_ACTIVE_BORDER);
    if (normalizedColor) {
      root.style.setProperty('--nav-button-active-border', normalizedColor);
      console.log('Set --nav-button-active-border to:', normalizedColor);
    }
  }

  if (env.VITE_NAV_BUTTON_ACTIVE_HOVER) {
    const normalizedColor = normalizeColor(env.VITE_NAV_BUTTON_ACTIVE_HOVER);
    if (normalizedColor) {
      root.style.setProperty('--nav-button-active-hover', normalizedColor);
      console.log('Set --nav-button-active-hover to:', normalizedColor);
    }
  }

  if (env.VITE_NAV_BUTTON_INACTIVE_HOVER) {
    const normalizedColor = normalizeColor(env.VITE_NAV_BUTTON_INACTIVE_HOVER);
    if (normalizedColor) {
      root.style.setProperty('--nav-button-inactive-hover', normalizedColor);
      console.log('Set --nav-button-inactive-hover to:', normalizedColor);
    }
  }
  
  console.log('Theme initialized successfully');
}
