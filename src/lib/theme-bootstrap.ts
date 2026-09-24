/**
 * Applied before hydration via a blocking inline script: reading the theme
 * choice out of `localStorage` and painting `data-theme` on `<html>` has to
 * happen before first paint, or the page flashes the wrong theme for a
 * frame. This is the one deliberate exception to "no inline script" — it is
 * static, has no external input, and runs strictly before React attaches.
 * Shared by every root layout (`app/[locale]/layout.tsx`, `app/dev/layout.tsx`).
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('luxedrive-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
