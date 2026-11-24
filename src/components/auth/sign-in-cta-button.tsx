"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function SignInCtaButton() {
  const router = useRouter();
  return (
    <Button type="button" size="lg" onClick={() => router.push("/sign-in")}>
      Sign in to lend or borrow
    </Button>
  );
}
