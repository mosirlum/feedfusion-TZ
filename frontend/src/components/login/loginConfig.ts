// Day/night login scene settings. Change them here (nowhere else).
//
// For automated tests only, a page can set `window.FF_LOGIN_CONFIG = {...}`
// before the app loads to override any of these values.
export interface LoginConfig {
  IDLE_SECONDS: number; // no activity for this long -> sunset starts
  SUNSET_DURATION: number; // seconds, day -> night
  SUNRISE_DURATION: number; // seconds, night -> day
  FIREFLY_COUNT: number;
  STAR_COUNT: number;
  START_FROM_CLOCK: boolean; // first paint follows the device clock (day / golden hour / twilight)
}

const DEFAULTS: LoginConfig = {
  IDLE_SECONDS: 25,
  SUNSET_DURATION: 7,
  SUNRISE_DURATION: 3.5,
  FIREFLY_COUNT: 20,
  STAR_COUNT: 90,
  START_FROM_CLOCK: true,
};

const override =
  typeof window !== 'undefined'
    ? (window as unknown as { FF_LOGIN_CONFIG?: Partial<LoginConfig> }).FF_LOGIN_CONFIG
    : undefined;

export const CONFIG: LoginConfig = { ...DEFAULTS, ...(override ?? {}) };
