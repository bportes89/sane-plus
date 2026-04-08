import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  const where = {
    published: true,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { body: { contains: q, mode: "insensitive" as const } },
            { tags: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const items = await prisma.fAQArticle.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: { id: true, slug: true, title: true, body: true },
  });

  if (!items.length) return NextResponse.json(fallback);
  return NextResponse.json(items);
}

