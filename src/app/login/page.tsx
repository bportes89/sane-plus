"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/cn";

type Mode = "login" | "register";

function LoginInner() {
  const search = useSearchParams();
  const nextUrl = (() => {
    const next = search.get("next") ?? "";
    if (next.startsWith("/") && !next.startsWith("//")) return next;
    return "/home";
  })();
  const clear = search.get("clear") ?? null;
  const [mode, setMode] = useState<Mode>(() =>
    search.get("mode") === "register" ? "register" : "login",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = "auth-error";

  useEffect(() => {
    const e = search.get("error");
    setError(e ? String(e) : null);
  }, [search]);

  useEffect(() => {
    setMode(search.get("mode") === "register" ? "register" : "login");
  }, [search]);

  useEffect(() => {
    let canceled = false;
    async function run() {
      if (clear === "1") {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
        if (!canceled) {
          const url = new URL(window.location.href);
          url.searchParams.delete("clear");
          window.history.replaceState(null, "", url.toString());
        }
      }
    }
    run();
    return () => {
      canceled = true;
    };
  }, [clear]);

  async function submit(formData: FormData) {
    setLoading(true);
    setError(null);
    try {
      const payload =
        mode === "login"
          ? {
              email: String(formData.get("email") ?? ""),
              password: String(formData.get("password") ?? ""),
            }
          : {
              name: String(formData.get("name") ?? ""),
              email: String(formData.get("email") ?? ""),
              password: String(formData.get("password") ?? ""),
            };

      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(data?.error ?? "Não foi possível concluir. Tente novamente.");
        return;
      }

      const origin = (() => {
        const { protocol, hostname, port } = window.location;
        const safeHost =
          hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]"
            ? "localhost"
            : hostname;
        const safeProtocol =
          safeHost === "localhost" || safeHost === "127.0.0.1" ? "http:" : protocol;
        return `${safeProtocol}//${safeHost}${port ? `:${port}` : ""}`;
      })();
      window.location.assign(new URL(nextUrl, origin).toString());
    } finally {
      setLoading(false);
    }
  }

  const loginHref = (() => {
    const sp = new URLSearchParams();
    if (nextUrl) sp.set("next", nextUrl);
    if (clear) sp.set("clear", clear);
    sp.set("mode", "login");
    return `/login?${sp.toString()}`;
  })();

  const registerHref = (() => {
    const sp = new URLSearchParams();
    if (nextUrl) sp.set("next", nextUrl);
    if (clear) sp.set("clear", clear);
    sp.set("mode", "register");
    return `/login?${sp.toString()}`;
  })();

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo href="/" />
          <p className="text-sm text-foreground/70">
            Sua voz por um saneamento melhor.
          </p>
        </div>

        <Card className="p-6 !bg-white text-foreground">
          <h1 className="font-title font-bold text-2xl">
            Entre ou crie sua conta
          </h1>
          <div className="mt-4 flex gap-2" role="tablist" aria-label="Entrar ou criar conta">
            <Link
              href={loginHref}
              className={cn(
                "inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 h-11 px-4 text-base flex-1",
                mode === "login" && "bg-accent text-white hover:bg-highlight active:bg-primary",
                mode !== "login" && "bg-white text-primary border border-black/10 hover:bg-muted",
              )}
              role="tab"
              aria-selected={mode === "login"}
            >
              Entrar
            </Link>
            <Link
              href={registerHref}
              className={cn(
                "inline-flex items-center justify-center rounded-xl font-title font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 h-11 px-4 text-base flex-1",
                mode === "register" && "bg-accent text-white hover:bg-highlight active:bg-primary",
                mode !== "register" && "bg-white text-primary border border-black/10 hover:bg-muted",
              )}
              role="tab"
              aria-selected={mode === "register"}
            >
              Criar conta
            </Link>
          </div>

          <form
            className="mt-5 flex flex-col gap-3"
            method="post"
            action={`/api/auth/${mode}?next=${encodeURIComponent(nextUrl)}`}
            onSubmit={(e) => {
              e.preventDefault();
              void submit(new FormData(e.currentTarget));
            }}
          >
            {mode === "register" ? (
              <div className="space-y-1">
                <label htmlFor="name" className="block text-sm font-medium">
                  Nome
                </label>
                <Input id="name" name="name" autoComplete="name" required />
              </div>
            ) : null}
            <div className="space-y-1">
              <label htmlFor="email" className="block text-sm font-medium">
                E-mail
              </label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-1">
              <label htmlFor="password" className="block text-sm font-medium">
                Senha
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={6}
                aria-describedby="password-hint"
                aria-invalid={error ? true : undefined}
              />
              <div id="password-hint" className="text-xs text-foreground/60 leading-5">
                Mínimo de 6 caracteres.
              </div>
            </div>

            {error ? (
              <div
                id={errorId}
                role="alert"
                aria-live="polite"
                className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]"
              >
                {error}
              </div>
            ) : null}

            <Button disabled={loading} type="submit">
              {loading ? "Aguarde..." : mode === "login" ? "Entrar com e-mail" : "Criar conta com e-mail"}
            </Button>

            <div className="mt-3 flex items-center gap-3">
              <div className="h-px flex-1 bg-black/10" />
              <div className="text-xs text-foreground/60">OU</div>
              <div className="h-px flex-1 bg-black/10" />
            </div>

            <div className="grid grid-cols-1 gap-2">
              <Button type="button" variant="secondary" disabled>
                Entrar com telefone
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" disabled>
                  Google
                </Button>
                <Button type="button" variant="secondary" disabled>
                  Apple
                </Button>
              </div>
            </div>

            <div className="mt-3 text-xs text-foreground/60 leading-5">
              Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade.
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
