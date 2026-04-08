const profanity = [
  "porra",
  "merda",
  "caralho",
  "fdp",
  "idiota",
  "imbecil",
];

const piiPatterns: RegExp[] = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}-?\d{1}\b/g, // RG simples
  /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}-?\d{4}\b/g, // telefone
  /\b[\w.-]+@[\w.-]+\.\w{2,}\b/g, // e-mail
  /\b\d{5}-?\d{3}\b/g, // CEP
  /\b(?:rua|avenida|av\.|rodovia|estrada)\b.+\d+/gi, // endereço simples
  /\b(?:n[ºo]\.?\s*)\d+\b/gi, // número
  /\b(?:cpf|rg|cnpj)\s*[:\-]?\s*\d[\d.\-\/]{6,}\b/gi, // campos explícitos
];

const crimeAccusations = [
  "ladrão",
  "ladrao",
  "ladrões",
  "ladroes",
  "corrupto",
  "corrupta",
  "estelionatário",
  "estelionatario",
  "golpista",
  "fraude",
  "roubo",
  "roubaram",
  "desvio",
  "quadrilha",
  "bandidos",
];

const hateOrSexual = [
  "racista",
  "nazista",
  "pedófilo",
  "pedofilo",
  "estupro",
  "estuprador",
  "pornografia",
  "assédio",
  "assedio",
  "discriminação",
  "discriminacao",
];

const sensitive = [
  "hiv",
  "aids",
  "câncer",
  "cancer",
  "depressão",
  "depressao",
  "ansiedade",
  "suicídio",
  "suicidio",
  "religião",
  "religiao",
  "orientação sexual",
  "orientacao sexual",
];

const needsHumanReview = [
  "contamina",
  "contaminação",
  "contaminacao",
  "intoxica",
  "doença",
  "doenca",
  "diarreia",
  "hospital",
  "criança",
  "crianca",
  "servidor público",
  "servidor publico",
  "vulnerabilidade",
  "mau cheiro forte",
];

const xssPatterns: RegExp[] = [
  /<\s*script\b/i,
  /<\s*iframe\b/i,
  /\bon\w+\s*=/i,
  /\bjavascript\s*:/i,
  /\bdata\s*:\s*text\/html\b/i,
];

export type ModerationSeverity = "allow" | "review" | "block";

export function autoModerate(input: string) {
  let output = input;
  let adjusted = false;
  let pii = false;
  let profanityHit = false;
  let employeeName = false;
  let crime = false;
  let hatefulOrSexual = false;
  let sensitiveData = false;
  let manualReview = false;
  const xss = xssPatterns.some((re) => re.test(input));

  for (const pattern of piiPatterns) {
    if (pattern.test(output)) {
      output = output.replace(pattern, "[dado ocultado]");
      adjusted = true;
      pii = true;
    }
  }

  for (const word of profanity) {
    const re = new RegExp(`\\b${word}\\b`, "gi");
    if (re.test(output)) {
      output = output.replace(re, "[ofensa editada]");
      adjusted = true;
      profanityHit = true;
    }
  }

  // Remoção de nomes de funcionários (heurística simples: "fulano", "sobrenome")
  const beforeEmployee = output;
  output = output.replace(/\bSr\.?\s+\w+\b/gi, "[nome ocultado]");
  output = output.replace(/\bSra\.?\s+\w+\b/gi, "[nome ocultado]");
  output = output.replace(
    /\b(?:atendente|funcion[aá]rio|t[eé]cnico|supervisor|gerente)\s+([A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][a-záàâãéèêíìîóòôõúùûç]+)(?:\s+[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][a-záàâãéèêíìîóòôõúùûç]+)?\b/g,
    "[nome ocultado]",
  );
  if (output !== beforeEmployee) {
    adjusted = true;
    employeeName = true;
  }

  const lc = input.toLowerCase();
  crime = crimeAccusations.some((w) => lc.includes(w));
  hatefulOrSexual = hateOrSexual.some((w) => lc.includes(w));
  sensitiveData = sensitive.some((w) => lc.includes(w));
  manualReview = needsHumanReview.some((w) => lc.includes(w));

  const severity: ModerationSeverity =
    xss || hatefulOrSexual || sensitiveData || crime
      ? "block"
      : manualReview
        ? "review"
        : "allow";

  return {
    adjusted,
    output,
    severity,
    flags: {
      pii,
      profanity: profanityHit,
      employeeName,
      crimeAccusation: crime,
      hatefulOrSexual,
      sensitiveData,
      manualReview,
      xss,
    },
  };
}

export function autoModerateSupportMessage(input: string) {
  let output = input;
  let adjusted = false;
  let pii = false;
  let profanityHit = false;
  let employeeName = false;
  let crime = false;
  let hatefulOrSexual = false;
  let sensitiveData = false;
  const xss = xssPatterns.some((re) => re.test(input));

  for (const pattern of piiPatterns) {
    if (pattern.test(output)) {
      output = output.replace(pattern, "[dado ocultado]");
      adjusted = true;
      pii = true;
    }
  }

  for (const word of profanity) {
    const re = new RegExp(`\\b${word}\\b`, "gi");
    if (re.test(output)) {
      output = output.replace(re, "[ofensa editada]");
      adjusted = true;
      profanityHit = true;
    }
  }

  const beforeEmployee = output;
  output = output.replace(/\bSr\.?\s+\w+\b/gi, "[nome ocultado]");
  output = output.replace(/\bSra\.?\s+\w+\b/gi, "[nome ocultado]");
  output = output.replace(
    /\b(?:atendente|funcion[aá]rio|t[eé]cnico|supervisor|gerente)\s+([A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][a-záàâãéèêíìîóòôõúùûç]+)(?:\s+[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][a-záàâãéèêíìîóòôõúùûç]+)?\b/g,
    "[nome ocultado]",
  );
  if (output !== beforeEmployee) {
    adjusted = true;
    employeeName = true;
  }

  const lc = input.toLowerCase();
  crime = crimeAccusations.some((w) => lc.includes(w));
  hatefulOrSexual = hateOrSexual.some((w) => lc.includes(w));
  sensitiveData = sensitive.some((w) => lc.includes(w));

  return {
    adjusted,
    output,
    flags: {
      pii,
      profanity: profanityHit,
      employeeName,
      crimeAccusation: crime,
      hatefulOrSexual,
      sensitiveData,
      xss,
    },
  };
}
