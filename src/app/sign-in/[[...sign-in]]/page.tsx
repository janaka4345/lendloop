import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
      <SignIn fallbackRedirectUrl="/listings" />
    </main>
  );
}
