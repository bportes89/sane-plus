# SANE+ (MVP)

## O que está por trás do SANE+ (MVP)

- Frontend + Backend no mesmo projeto (Full Stack Web): feito em Next.js 16 com React 19 e TypeScript. Isso entrega uma aplicação web moderna, rápida e com código tipado (menos erro em produção).
- API própria: a plataforma tem endpoints internos em `/api/*` para criar/consultar reclamações, anexos, suporte/chat, ranking, relatórios, notificações e integrações.
- Banco de dados + ORM: usa Prisma ORM com SQLite (better-sqlite3) no MVP. A estrutura de dados já está modelada (usuários, empresas, reclamações, respostas, eventos, notificações, moderação, suporte, métricas). Em implantação corporativa, dá para migrar para Postgres facilmente mantendo o Prisma.
- Autenticação e sessão: login/sessão por cookie httpOnly + sessão persistida em banco (token), com senha criptografada via bcrypt. Suporta papéis (cidadão, empresa, moderação, jurídico, admin).
- Mapa e georreferenciamento: usa Leaflet no front para marcar ponto no mapa e visualizar ocorrências. Além disso, existe busca por CEP via endpoint interno (`/api/geo/cep`) que consulta ViaCEP (endereço) e tenta obter lat/lng por geocoding (Nominatim/OSM) para já posicionar no mapa.
- Moderação e compliance (LGPD): pipeline de moderação (automática + manual + jurídico) e regras para reduzir risco legal (dados pessoais, acusações, conteúdo sensível). Isso já está embutido no fluxo de criação/publicação.
- Proteções operacionais: rate limit por IP/usuário em endpoints críticos (evita abuso e spam).
- Relatórios e exportações: geração/exportação (ex.: XLSX) para empresas acompanharem indicadores e baixarem dados.
- Qualidade (testes): suíte de testes com Vitest (unit e integração) + testes de UI com Testing Library, e testes de API via Postman/Newman (isso ajuda em auditoria/garantia de entrega).

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
