"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({
  lang,
  labels,
}: {
  lang: Locale;
  labels: { signOut: string; signingOut: string };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.push(`/${lang}`);
    router.refresh();
  }

  return (
    <Button variant="outline" onClick={signOut} disabled={pending}>
      {pending ? labels.signingOut : labels.signOut}
    </Button>
  );
}
