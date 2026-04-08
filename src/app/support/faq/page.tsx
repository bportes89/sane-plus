"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/Logo";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";

type FAQItem = { id?: string; slug: string; title: string; body: string };

export default function FAQPage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<FAQItem[]>([]);
  const [loading, setLoading] = useState(true);

  const query = useMemo(() => q.trim(), [q]);

  useEffect(() => {
    let canceled = false;
    async function run() {
      setLoading(true);
      try {
        const url = query ? `/api/support/faq?q=${encodeURIComponent(query)}` : "/api/support/faq";
        const res = await fetch(url);
        const data = (await res.json().catch(() => [])) as FAQItem[];
        if (!canceled) setItems(Array.isArray(data) ? data : []);
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    run();
    return () => {
      canceled = true;
    };
  }, [query]);

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/support" />
        <Link href="/support" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-4xl mx-auto space-y-4">
          <div>
            <h1 className="font-title font-bold text-2xl">FAQ</h1>
            <div className="text-sm text-foreground/70 mt-1">
              Respostas curtas e diretas para dúvidas comuns.
            </div>
          </div>

          <div>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar no FAQ..."
              aria-label="Buscar no FAQ"
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            {loading ? (
              <Card className="p-5">
                <div className="text-sm text-foreground/70">Carregando...</div>
              </Card>
            ) : items.length ? (
              items.map((i) => (
                <Link key={i.slug} href={`/support/faq/${i.slug}`} className="block">
                  <Card className="p-5 hover:bg-muted transition-colors">
                    <div className="font-title font-semibold">{i.title}</div>
                    <div className="text-sm text-foreground/70 mt-1 line-clamp-2">{i.body}</div>
                  </Card>
                </Link>
              ))
            ) : (
              <Card className="p-5">
                <div className="text-sm text-foreground/70">Nenhum resultado.</div>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
