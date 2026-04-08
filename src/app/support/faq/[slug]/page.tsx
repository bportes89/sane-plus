import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Logo } from "@/components/Logo";
import { Card } from "@/components/Card";

const fallback = [
  {
    slug: "como-registrar-reclamacao",
    title: "Como registrar uma reclamação?",
    body: "Na Home, toque em Registrar Reclamação e siga os passos. Evite dados pessoais de terceiros e acusações sem prova.",
  },
  {
    slug: "por-que-minha-reclamacao-esta-em-analise",
    title: "Por que minha reclamação está em análise?",
    body: "Alguns temas exigem revisão humana (ex.: saúde, contaminação) ou o texto pode ter sido ocultado por segurança jurídica/LGPD.",
  },
  {
    slug: "como-contestar-resposta",
    title: "Como contestar a resposta da empresa?",
    body: "Abra a reclamação e use Contestar resposta. Sua contestação é registrada e encaminhada para revisão.",
  },
  {
    slug: "como-excluir-conta",
    title: "Como excluir minha conta?",
    body: "Você pode solicitar a exclusão da conta e dos dados conforme a LGPD. Abra um chamado em Suporte e confirme a solicitação.",
  },
  {
    slug: "seguranca-e-privacidade",
    title: "Segurança e privacidade (LGPD)",
    body: "Nunca envie CPF, RG, endereço completo, dados bancários ou dados de terceiros. Se isso ocorrer, o conteúdo pode ser ocultado ou ajustado.",
  },
];

export default async function FAQItemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;

  const item = await prisma.fAQArticle.findFirst({
    where: { slug, published: true },
    select: { slug: true, title: true, body: true },
  });

  const resolved = item ?? fallback.find((x) => x.slug === slug) ?? null;

  if (!resolved) {
    return (
      <div className="min-h-dvh bg-background">
        <header className="px-6 pt-6 flex items-center justify-between gap-4">
          <Logo href="/support/faq" />
          <Link href="/support/faq" className="text-sm text-primary hover:text-highlight">
            Voltar
          </Link>
        </header>
        <main className="px-6 py-10">
          <div className="w-full max-w-3xl mx-auto">
            <Card className="p-6">
              <div className="font-title font-bold text-lg">Artigo não encontrado</div>
              <div className="text-sm text-foreground/70 mt-1">
                Tente buscar por outra palavra no FAQ.
              </div>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-6 flex items-center justify-between gap-4">
        <Logo href="/support/faq" />
        <Link href="/support/faq" className="text-sm text-primary hover:text-highlight">
          Voltar
        </Link>
      </header>

      <main className="px-6 py-10">
        <div className="w-full max-w-3xl mx-auto">
          <Card className="p-6">
            <h1 className="font-title font-bold text-xl">{resolved.title}</h1>
            <div className="text-sm text-foreground/70 mt-3 whitespace-pre-wrap">
              {resolved.body}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}

