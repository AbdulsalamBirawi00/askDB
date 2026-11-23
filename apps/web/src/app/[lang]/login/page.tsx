import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { SignInButtons } from "@/components/auth/sign-in-buttons";
import { SiteHeader } from "@/components/site-header";
import { getEnv } from "@/env";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getCurrentUser } from "@/lib/session";

/** Signed-in visitors skip the login page. Reads the request, so it sits behind <Suspense>. */
async function RedirectIfSignedIn({ lang }: { lang: Locale }) {
  if (await getCurrentUser()) redirect(`/${lang}/app`);
  return null;
}

export default async function LoginPage({ params }: PageProps<"/[lang]/login">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { home, auth } = await getDictionary(lang);
  const otherLocale = lang === "ar" ? "en" : "ar";
  const env = getEnv();
  const github = !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
      <Suspense>
        <RedirectIfSignedIn lang={lang} />
      </Suspense>
      <SiteHeader
        lang={lang}
        switchLabel={home.switchLanguage}
        switchHref={`/${otherLocale}/login`}
      />
      <section className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 py-16">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-bold tracking-tight">{auth.title}</h1>
          <p className="text-pretty text-muted-foreground">{auth.subtitle}</p>
        </div>
        <SignInButtons lang={lang} labels={auth} github={github} />
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <p>{auth.guestNote}</p>
          {!github && <p>{auth.githubUnavailable}</p>}
        </div>
      </section>
    </main>
  );
}
