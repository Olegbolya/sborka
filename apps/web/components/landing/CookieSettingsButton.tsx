'use client';
import { COOKIE_SETTINGS_EVENT } from '../../lib/analytics';

/** The footer's way back to the choice made in the banner. */
export function CookieSettingsButton() {
  return (
    <button type="button" className="lp-linkbtn" onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))}>
      Настройки cookie
    </button>
  );
}
