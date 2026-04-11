DELETE FROM "DistributionProfile" WHERE "id" IN ('seed-prof-email-sp','seed-prof-hook-sp');

INSERT INTO "DistributionProfile" (
  "id","integrationId","reportType","format","destination","frequency","active","emailTo","webhookUrl","lastRunAt","lastRunPeriod","lastError","createdAt","updatedAt"
) VALUES
(
  'seed-prof-email-sp','seed-int-email-1','CITY_MONTHLY','XLSX','OFFICIAL_EMAIL','MONTHLY',true,NULL,NULL,NULL,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
),
(
  'seed-prof-hook-sp','seed-int-webhook-1','INSTITUTIONAL_MONTHLY','JSON','WEBHOOK','MONTHLY',true,NULL,NULL,NULL,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
);
