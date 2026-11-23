import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary, type Dictionary } from "@/i18n/dictionaries";
import { requireUser } from "@/lib/session";

async function Profile({ lang, profile }: { lang: Locale; profile: Dictionary["profile"] }) {
  const user = await requireUser(lang);
  const rows: [string, string][] = [
    [profile.name, user.name],
    ...(user.email ? ([[profile.email, user.email]] as [string, string][]) : []),
    [profile.accountType, user.isGuest ? profile.typeGuest : profile.typeUser],
  ];

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <dl className="divide-y rounded-xl border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 p-4 sm:flex-row sm:gap-4">
            <dt className="w-40 shrink-0 text-sm text-muted-foreground">{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {user.isGuest && <p className="text-sm text-muted-foreground">{profile.guestExpiry}</p>}
      <div>
        <SignOutButton lang={lang} labels={profile} />
      </div>
    </div>
  );
}

export default async function ProfilePage({ params }: PageProps<"/[lang]/app/profile">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { app, profile } = await getDictionary(lang);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-3xl font-bold tracking-tight">{profile.title}</h1>
      <Suspense fallback={<p className="text-muted-foreground">{app.loading}</p>}>
        <Profile lang={lang} profile={profile} />
      </Suspense>
    </div>
  );
}
