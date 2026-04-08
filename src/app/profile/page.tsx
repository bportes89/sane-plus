"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Card } from "@/components/Card";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/Button";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type MeDto =
  | {
      id: string;
      name: string | null;
      email: string;
      role: string;
      points: number;
      notifyInApp?: boolean;
      notifyEmail?: boolean;
    }
  | { error: string };

export default function ProfilePage() {
  const router = useRouter();
  const { data, isLoading } = useSWR<MeDto>("/api/auth/me", fetcher);
  const [highContrast, setHighContrast] = useState(() => {
    try {
      return localStorage.getItem("saneplus.a11y.contrast") === "high";
    } catch {
      return false;
    }
  });
  const [simplicity, setSimplicity] = useState(() => {
    try {
      return localStorage.getItem("saneplus.a11y.simplicity") === "on";
    } catch {
      return false;
    }
  });
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem("saneplus.a11y.sound") === "on";
    } catch {
      return false;
    }
  });
  const [vibrate, setVibrate] = useState(() => {
    try {
      return localStorage.getItem("saneplus.a11y.vibrate") === "on";
    } catch {
      return false;
    }
  });

  const name =
    data && "id" in data ? (data.name?.trim() ? data.name : "Usuário") : "Usuário";
  const email = data && "id" in data ? data.email : "";
  const initial = (name?.trim()?.[0] ?? email?.trim()?.[0] ?? "U").toUpperCase();
  const points = data && "id" in data ? data.points : 0;
  const role = data && "id" in data ? data.role : "";
  const notifyInApp = data && "id" in data ? !!data.notifyInApp : true;
  const notifyEmail = data && "id" in data ? !!data.notifyEmail : true;

  function applyA11yPrefs(next: { highContrast: boolean; simplicity: boolean }) {
    try {
      if (next.highContrast) localStorage.setItem("saneplus.a11y.contrast", "high");
      else localStorage.removeItem("saneplus.a11y.contrast");
      if (next.simplicity) localStorage.setItem("saneplus.a11y.simplicity", "on");
      else localStorage.removeItem("saneplus.a11y.simplicity");
    } catch {}
    window.dispatchEvent(new Event("saneplus:a11y"));
  }

  function applyNotifyFeedbackPrefs(next: { sound: boolean; vibrate: boolean }) {
    try {
      if (next.sound) localStorage.setItem("saneplus.a11y.sound", "on");
      else localStorage.removeItem("saneplus.a11y.sound");
      if (next.vibrate) localStorage.setItem("saneplus.a11y.vibrate", "on");
      else localStorage.removeItem("saneplus.a11y.vibrate");
    } catch {}
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  async function deleteAccount() {
    const typed = window.prompt('Para confirmar, digite EXCLUIR', "");
    if (!typed) return;

    const payload: { confirm: string; password?: string } = { confirm: typed };
    if (typed.trim().toUpperCase() !== "EXCLUIR") {
      alert("Confirmação inválida.");
      return;
    }

    const password = window.prompt("Digite sua senha (se aplicável)", "") ?? "";
    if (password.trim()) {
      payload.password = password;
    }

    const res = await fetch("/api/users/me", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !out?.ok) {
      alert(out?.error ?? "Falha ao excluir conta.");
      return;
    }
    router.replace("/login");
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/home" />
        <Link href="/home" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-2xl mx-auto">
          <h1 className="font-title font-bold text-2xl">Perfil</h1>

          <Card className="mt-5 p-6">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-2xl bg-primary text-white flex items-center justify-center font-title font-bold text-xl">
                {initial}
              </div>
              <div className="min-w-0">
                <div className="font-title font-semibold text-lg">
                  {isLoading ? "Carregando..." : name}
                </div>
                <div className="text-sm text-foreground/70 truncate">
                  {isLoading ? "—" : email}
                </div>
              </div>
            </div>
          </Card>

          <div className="mt-6 grid gap-2">
            <Link href="/complaints" className="block">
              <Card className="p-5 hover:bg-muted transition-colors">
                <div className="font-title font-semibold">Minhas reclamações</div>
              </Card>
            </Link>
            <Link href="#dados" className="block">
              <Card className="p-5 hover:bg-muted transition-colors">
                <div className="font-title font-semibold">Dados pessoais</div>
              </Card>
            </Link>
            <Link href="/search" className="block">
              <Card className="p-5 hover:bg-muted transition-colors">
                <div className="font-title font-semibold">Busca</div>
              </Card>
            </Link>
            <Link href="/notifications" className="block">
              <Card className="p-5 hover:bg-muted transition-colors">
                <div className="font-title font-semibold">Notificações</div>
              </Card>
            </Link>
            <Link href="/terms" className="block">
              <Card className="p-5 hover:bg-muted transition-colors">
                <div className="font-title font-semibold">Termos de Uso</div>
              </Card>
            </Link>
            <Link href="/privacy" className="block">
              <Card className="p-5 hover:bg-muted transition-colors">
                <div className="font-title font-semibold">Política de Privacidade</div>
              </Card>
            </Link>
          </div>

          <div id="dados" className="mt-10">
            <div className="font-title font-bold text-lg">Dados pessoais</div>
            <Card className="mt-3 p-6">
              <div className="text-sm text-foreground/70">
                Nome: <span className="text-foreground">{isLoading ? "—" : name}</span>
              </div>
              <div className="text-sm text-foreground/70 mt-2">
                E-mail: <span className="text-foreground">{isLoading ? "—" : email}</span>
              </div>
              <div className="text-sm text-foreground/70 mt-2">
                Pontos: <span className="text-foreground">{isLoading ? "—" : points}</span>
              </div>
              <div className="text-sm text-foreground/70 mt-2">
                Perfil: <span className="text-foreground">{isLoading ? "—" : role}</span>
              </div>
            </Card>
          </div>

          <div className="mt-6">
            <div className="font-title font-bold text-lg">Acessibilidade</div>
            <Card className="mt-3 p-6 space-y-3">
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={highContrast}
                  onChange={(e) => {
                    const next = e.currentTarget.checked;
                    setHighContrast(next);
                    applyA11yPrefs({ highContrast: next, simplicity });
                  }}
                  className="h-4 w-4 rounded border-black/20"
                />
                Modo alto contraste
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={simplicity}
                  onChange={(e) => {
                    const next = e.currentTarget.checked;
                    setSimplicity(next);
                    applyA11yPrefs({ highContrast, simplicity: next });
                  }}
                  className="h-4 w-4 rounded border-black/20"
                />
                Modo simplicidade (fontes maiores)
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={sound}
                  onChange={(e) => {
                    const next = e.currentTarget.checked;
                    setSound(next);
                    applyNotifyFeedbackPrefs({ sound: next, vibrate });
                  }}
                  className="h-4 w-4 rounded border-black/20"
                />
                Sons nas notificações
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={vibrate}
                  onChange={(e) => {
                    const next = e.currentTarget.checked;
                    setVibrate(next);
                    applyNotifyFeedbackPrefs({ sound, vibrate: next });
                  }}
                  className="h-4 w-4 rounded border-black/20"
                />
                Vibração nas notificações (se disponível)
              </label>
              <div className="text-xs text-foreground/60 leading-5">
                Essas opções ficam salvas neste dispositivo.
              </div>
            </Card>
          </div>

          <div className="mt-6">
            <div className="font-title font-bold text-lg">Notificações</div>
            <Card className="mt-3 p-6 space-y-3">
              <form
                action="/api/users/me"
                method="post"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget as HTMLFormElement);
                  const res = await fetch("/api/users/me", {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      notifyInApp: formData.get("notifyInApp") === "on",
                      notifyEmail: formData.get("notifyEmail") === "on",
                    }),
                  });
                  if (res.ok) {
                    window.location.reload();
                  }
                }}
              >
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="notifyInApp"
                    defaultChecked={notifyInApp}
                    className="h-4 w-4 rounded border-black/20"
                  />
                  Receber notificações no app
                </label>
                <label className="flex items-center gap-3 text-sm mt-2">
                  <input
                    type="checkbox"
                    name="notifyEmail"
                    defaultChecked={notifyEmail}
                    className="h-4 w-4 rounded border-black/20"
                  />
                  Receber notificações por e‑mail
                </label>
                <Button className="mt-4" type="submit">
                  Salvar preferências
                </Button>
              </form>
            </Card>
          </div>

          <div className="mt-6">
            <Button variant="secondary" onClick={logout} className="w-full">
              Sair
            </Button>
          </div>

          <div className="mt-4">
            <Button variant="secondary" onClick={deleteAccount} className="w-full">
              Excluir conta
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
