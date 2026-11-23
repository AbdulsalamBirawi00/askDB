"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import { authClient } from "@/lib/auth-client";

type Labels = { github: string; guest: string; working: string; error: string };

type Props = {
  lang: Locale;
  labels: Labels;
  /** Show the GitHub button (only when the server has a GitHub OAuth app). */
  github?: boolean;
  size?: "default" | "lg";
};

export function SignInButtons({ lang, labels, github = false, size = "lg" }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<"github" | "guest" | null>(null);
  const [failed, setFailed] = useState(false);
  const appPath = `/${lang}/app`;

  async function signInAsGuest() {
    setPending("guest");
    setFailed(false);
    const { error } = await authClient.signIn.anonymous();
    // Already a guest in this browser: just go to the app.
    if (error && error.code !== "ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY") {
      setPending(null);
      setFailed(true);
      return;
    }
    router.push(appPath);
    router.refresh();
  }

  async function signInWithGitHub() {
    setPending("github");
    setFailed(false);
    const { error } = await authClient.signIn.social({
      provider: "github",
      callbackURL: appPath,
      errorCallbackURL: `/${lang}/login`,
    });
    // On success the browser is already leaving for GitHub.
    if (error) {
      setPending(null);
      setFailed(true);
    }
  }

  return (
    <div className="flex w-full flex-col gap-3 sm:w-auto">
      <div className="flex flex-col gap-3 sm:flex-row">
        {github && (
          <Button size={size} onClick={signInWithGitHub} disabled={pending !== null}>
            {pending === "github" ? labels.working : labels.github}
          </Button>
        )}
        <Button
          size={size}
          variant={github ? "outline" : "default"}
          onClick={signInAsGuest}
          disabled={pending !== null}
        >
          {pending === "guest" ? labels.working : labels.guest}
        </Button>
      </div>
      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-destructive">
        {failed ? labels.error : null}
      </p>
    </div>
  );
}
