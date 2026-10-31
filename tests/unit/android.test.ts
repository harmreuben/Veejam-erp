import { describe, expect, it } from "vitest";

import { DEFAULT_ANDROID_PACKAGE, androidAssetLinks } from "@/server/android";

const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");

describe("androidAssetLinks", () => {
  it("is empty until a signing fingerprint is set", () => {
    expect(androidAssetLinks({})).toEqual([]);
    expect(androidAssetLinks({ ANDROID_PACKAGE_NAME: "app.vercel.veejam.twa" })).toEqual([]);
  });

  it("names the package and every valid fingerprint", () => {
    const links = androidAssetLinks({ ANDROID_CERT_SHA256: ` ${FP.toLowerCase()} , not-a-key, ${FP}` });
    expect(links).toHaveLength(1);
    expect(links[0]!.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(links[0]!.target.package_name).toBe(DEFAULT_ANDROID_PACKAGE);
    expect(links[0]!.target.sha256_cert_fingerprints).toEqual([FP, FP]);
  });

  it("uses the configured package and refuses a malformed one", () => {
    expect(
      androidAssetLinks({ ANDROID_CERT_SHA256: FP, ANDROID_PACKAGE_NAME: "ke.veejam.erp" })[0]!.target
        .package_name,
    ).toBe("ke.veejam.erp");
    expect(androidAssetLinks({ ANDROID_CERT_SHA256: FP, ANDROID_PACKAGE_NAME: "bad name" })).toEqual([]);
  });
});
