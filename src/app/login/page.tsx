"use client";

import { signIn } from "next-auth/react";
import { Github } from "lucide-react";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 p-8 rounded-xl border bg-card shadow-lg w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Code Launcher</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to manage your local dev projects
          </p>
        </div>

        <button
          onClick={() => signIn("github", { callbackUrl: "/" })}
          className="flex items-center gap-2 w-full justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Github className="size-4" />
          Sign in with GitHub
        </button>
      </div>
    </div>
  );
}
