export type OpenDataDatasetId = "public-summary" | "public-categories" | "public-companies";

type SchemaField = { name: string; type: string; description?: string };

export type OpenDataDataset = {
  id: OpenDataDatasetId;
  version: number;
  schemaVersion: number;
  title: string;
  description: string;
  formats: Array<"json" | "csv" | "xlsx">;
  paging: { supported: boolean; params?: string[] };
  params: Record<string, unknown>;
  schema: SchemaField[];
  links: {
    self: string;
    schema: string;
    data: string;
  };
};

export function getOpenDataDatasetIds(): OpenDataDatasetId[] {
  return ["public-summary", "public-categories", "public-companies"];
}

export function getOpenDataDataset(baseUrl: string, id: OpenDataDatasetId): OpenDataDataset {
  const base = `${baseUrl}/api/open-data/datasets/${id}`;
  const links = {
    self: base,
    schema: `${base}/schema`,
    data: `${base}/data`,
  };

  if (id === "public-summary") {
    return {
      id,
      version: 1,
      schemaVersion: 1,
      title: "Resumo público",
      description: "Indicadores agregados (janela móvel) para transparência pública.",
      formats: ["json", "csv", "xlsx"],
      paging: { supported: false },
      params: {
        windowDays: { type: "number", default: 30, min: 7, max: 365 },
        format: { type: "string", enum: ["json", "csv", "xlsx"] },
      },
      schema: [
        { name: "windowDays", type: "number" },
        { name: "total", type: "number" },
        { name: "replied", type: "number" },
        { name: "resolved", type: "number" },
        { name: "responseRate", type: "number" },
        { name: "solutionRate", type: "number" },
      ],
      links,
    };
  }

  if (id === "public-categories") {
    return {
      id,
      version: 1,
      schemaVersion: 1,
      title: "Categorias (público)",
      description: "Distribuição de reclamações por categoria (janela móvel).",
      formats: ["json", "csv", "xlsx"],
      paging: { supported: false },
      params: {
        windowDays: { type: "number", default: 30, min: 7, max: 365 },
        format: { type: "string", enum: ["json", "csv", "xlsx"] },
      },
      schema: [
        { name: "windowDays", type: "number" },
        { name: "rows", type: "array" },
        { name: "rows[].category", type: "string" },
        { name: "rows[].count", type: "number" },
      ],
      links,
    };
  }

  return {
    id,
    version: 1,
    schemaVersion: 1,
    title: "Ranking de empresas (público)",
    description: "Lista ranqueada de empresas por indicadores agregados.",
    formats: ["json", "csv", "xlsx"],
    paging: { supported: true, params: ["limit", "offset"] },
    params: {
      format: { type: "string", enum: ["json", "csv", "xlsx"] },
      limit: { type: "number", default: 10, min: 1, max: 200 },
      offset: { type: "number", default: 0, min: 0, max: 100000 },
    },
    schema: [
      { name: "total", type: "number" },
      { name: "limit", type: "number" },
      { name: "offset", type: "number" },
      { name: "rows", type: "array" },
      { name: "rows[].id", type: "string" },
      { name: "rows[].name", type: "string" },
      { name: "rows[].slug", type: "string" },
      { name: "rows[].city", type: "string" },
      { name: "rows[].state", type: "string" },
      { name: "rows[].solutionRate", type: "number" },
      { name: "rows[].overallScore", type: "number" },
      { name: "rows[].avgResponseMs", type: "number" },
    ],
    links,
  };
}

export function listOpenDataDatasets(baseUrl: string): OpenDataDataset[] {
  return getOpenDataDatasetIds().map((id) => getOpenDataDataset(baseUrl, id));
}

export function getOpenDataJsonSchema(baseUrl: string, id: OpenDataDatasetId): Record<string, unknown> {
  const ds = getOpenDataDataset(baseUrl, id);

  if (id === "public-summary") {
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: ds.links.schema,
      title: ds.title,
      type: "object",
      additionalProperties: false,
      required: ["windowDays", "total", "replied", "resolved", "responseRate", "solutionRate"],
      properties: {
        windowDays: { type: "integer", minimum: 7, maximum: 365 },
        total: { type: "integer", minimum: 0 },
        replied: { type: "integer", minimum: 0 },
        resolved: { type: "integer", minimum: 0 },
        responseRate: { type: "integer", minimum: 0, maximum: 100 },
        solutionRate: { type: "integer", minimum: 0, maximum: 100 },
        generatedAt: { type: "string", format: "date-time" },
        datasetVersion: { type: "integer", minimum: 1 },
        schemaVersion: { type: "integer", minimum: 1 },
      },
    };
  }

  if (id === "public-categories") {
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: ds.links.schema,
      title: ds.title,
      type: "object",
      additionalProperties: false,
      required: ["windowDays", "rows"],
      properties: {
        windowDays: { type: "integer", minimum: 7, maximum: 365 },
        generatedAt: { type: "string", format: "date-time" },
        datasetVersion: { type: "integer", minimum: 1 },
        schemaVersion: { type: "integer", minimum: 1 },
        rows: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["category", "count"],
            properties: {
              category: { type: "string" },
              count: { type: "integer", minimum: 0 },
            },
          },
        },
      },
    };
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: ds.links.schema,
    title: ds.title,
    type: "object",
    additionalProperties: false,
    required: ["total", "limit", "offset", "rows"],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      datasetVersion: { type: "integer", minimum: 1 },
      schemaVersion: { type: "integer", minimum: 1 },
      total: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      offset: { type: "integer", minimum: 0 },
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name", "slug"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            slug: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            solutionRate: { type: ["integer", "null"], minimum: 0, maximum: 100 },
            overallScore: { type: ["number", "null"] },
            avgResponseMs: { type: ["integer", "null"], minimum: 0 },
          },
        },
      },
    },
  };
}

