/**
 * Digital Asset Links for the Android app (a Trusted Web Activity made from this
 * site with PWABuilder or Bubblewrap). Android opens the app full screen, without
 * a browser address bar, only when this file names the app's package and the
 * SHA-256 fingerprint of the key it was signed with.
 *
 * Both values are public (they are printed inside every copy of the app), but
 * they come from the Vercel settings, not from code, so a new signing key never
 * needs a code change:
 *   ANDROID_PACKAGE_NAME    e.g. app.vercel.veejam.twa
 *   ANDROID_CERT_SHA256     one or more fingerprints, comma separated
 *                           (AA:BB:… as shown by PWABuilder or keytool)
 */
export const DEFAULT_ANDROID_PACKAGE = "app.vercel.veejam.twa";

const FINGERPRINT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export type AssetLink = {
  relation: string[];
  target: { namespace: "android_app"; package_name: string; sha256_cert_fingerprints: string[] };
};

export function androidAssetLinks(
  env: Partial<Record<string, string>> & {
    ANDROID_PACKAGE_NAME?: string;
    ANDROID_CERT_SHA256?: string;
  },
): AssetLink[] {
  const fingerprints = (env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => FINGERPRINT.test(f));
  if (fingerprints.length === 0) return [];
  const packageName = env.ANDROID_PACKAGE_NAME?.trim() || DEFAULT_ANDROID_PACKAGE;
  if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(packageName)) return [];
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
    },
  ];
}
