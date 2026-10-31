import { Page, PageHeader, Section } from "@/components/page";

import { androidAssetLinks } from "@/server/android";

import { InstallGuide } from "./guide";

export const metadata = { title: "Install the app" };

/** How to put VeeJam ERP on a phone or PC as an app (it's the same site, installed). */
export default function InstallPage() {
  const androidLinked = androidAssetLinks(process.env).length > 0;
  return (
    <Page wide>
      <PageHeader
        title="Install the app"
        description="VeeJam ERP installs straight from the browser on Android, iPhone and Windows. It opens from its own icon in its own window, signs you in as usual, and updates itself whenever a new version is published: there is nothing to download again."
      />
      <InstallGuide />
      <Section title="Good to know">
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          <li>The installed app and the website are the same: same sign-in, same data, always up to date.</li>
          <li>
            It needs the internet. Without a connection it shows an “offline” page and records nothing, so
            nothing can be posted twice or lost.
          </li>
          <li>On a shared computer, sign out when you finish (Your account → Sign out).</li>
          <li>To remove it: long-press the icon (phone) or open it and use ⋯ → Uninstall (Windows).</li>
        </ul>
      </Section>
      <Section title="Android app file (optional)">
        <div className="text-muted-foreground max-w-3xl space-y-2 text-sm">
          <p>
            Installing from Chrome (above) is all a phone needs. If you also want an app file to hand out or
            to put on Google Play, it is made from this site with PWABuilder: it opens full screen with the
            same icon and sign-in, and still updates itself from the site.
          </p>
          <p>
            Android full-screen link:{" "}
            <span className={androidLinked ? "text-success font-medium" : "font-medium"}>
              {androidLinked ? "set up" : "not set up yet"}
            </span>
            .{" "}
            {androidLinked
              ? "The app opens without a browser bar."
              : "Until it is, the app file shows a thin browser bar at the top."}
          </p>
        </div>
      </Section>
    </Page>
  );
}
