export type SectorCategory =
  | "Água"
  | "Esgoto"
  | "Infraestrutura"
  | "Financeiro"
  | "Atendimento";

export const categories: Record<SectorCategory, string[]> = {
  Água: [
    "Falta de água",
    "Baixa pressão",
    "Água turva",
    "Água com odor",
    "Água com gosto estranho",
  ],
  Esgoto: [
    "Esgoto a céu aberto",
    "Retorno de esgoto",
    "Vazamento de esgoto",
    "Mau cheiro",
  ],
  Infraestrutura: [
    "Vazamento na rua",
    "Vazamento interno",
    "Tubulação danificada",
    "Boca de lobo entupida",
  ],
  Financeiro: ["Conta alta", "Cobrança indevida", "Falha na leitura do hidrômetro"],
  Atendimento: ["Demora", "Atendimento inadequado", "Protocolo não cumprido"],
};

