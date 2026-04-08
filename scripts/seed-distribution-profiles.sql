DELETE FROM "DistributionProfile" WHERE "id" IN ('seed-prof-email-sp','seed-prof-hook-sp');

INSERT INTO "DistributionProfile" (
  "id","integrationId","reportType","format","destination","frequency","active","emailTo","webhookUrl","lastRunAt","lastRunPeriod","lastError","createdAt","updatedAt"
) VALUES
(
  'seed-prof-email-sp','seed-int-email-1','CITY_MONTHLY','XLSX','OFFICIAL_EMAIL','MONTHLY',1,NULL,NULL,NULL,NULL,NULL,DATETIME('now'),DATETIME('now')
),
(
  'seed-prof-hook-sp','seed-int-webhook-1','INSTITUTIONAL_MONTHLY','JSON','WEBHOOK','MONTHLY',1,NULL,NULL,NULL,NULL,NULL,DATETIME('now'),DATETIME('now')
);

