/** The person's colour theme. "system" follows the device's light/dark setting. */
export type ThemeChoice = "light" | "dark" | "system";

export const THEME_COOKIE = "vj-theme";

export function parseTheme(value: string | undefined | null): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}
