DELETE FROM "EmailOutbox" WHERE "id" LIKE 'seed-email-%';
DELETE FROM "WebhookOutbox" WHERE "id" LIKE 'seed-hook-%';
DELETE FROM "Integration" WHERE "id" IN ('seed-int-email-1','seed-int-webhook-1');
DELETE FROM "Company" WHERE "id" = 'seed-company-1';

INSERT INTO "Company" (
  "id","name","slug","city","state","status","createdAt","updatedAt"
) VALUES (
  'seed-company-1','Companhia Teste','companhia-teste','Sao Paulo','SP','ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "Integration" (
  "id","name","scope","kind","status","companyId","city","state","webhookUrl","webhookMethod","webhookHeaders",
  "signingSecretEnc","officialEmail","emailVerifyTokenHash","verifiedAt","inboundTokenHash","lastUsedAt","createdAt","updatedAt"
) VALUES
(
  'seed-int-email-1','Email Oficial SP','CITY','OFFICIAL_EMAIL','ACTIVE', NULL,'Sao Paulo','SP', NULL,'POST', NULL,
  NULL,'institucional@test.local',NULL, CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  'seed-int-webhook-1','Webhook SP','CITY','WEBHOOK','ACTIVE', NULL,'Sao Paulo','SP','https://example.com/hook','POST', NULL,
  NULL, NULL, NULL, CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "EmailOutbox" (
  "id","to","subject","body","status","error","meta","integrationId","ticketId","complaintId","userId","createdAt","sentAt"
) VALUES
('seed-email-1','institucional@test.local','Relatorio','Payload','SENT',NULL,NULL,'seed-int-email-1',NULL,NULL,NULL,
  CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour 50 minutes'),
('seed-email-2','institucional@test.local','Relatorio','Payload','SENT',NULL,NULL,'seed-int-email-1',NULL,NULL,NULL,
  CURRENT_TIMESTAMP - INTERVAL '3 hours', CURRENT_TIMESTAMP - INTERVAL '2 hours 50 minutes'),
('seed-email-3','institucional@test.local','Relatorio','Payload','FAILED','smtp fail',NULL,'seed-int-email-1',NULL,NULL,NULL,
  CURRENT_TIMESTAMP - INTERVAL '30 minutes', NULL),
('seed-email-4','institucional@test.local','Relatorio','Payload','PENDING',NULL,NULL,'seed-int-email-1',NULL,NULL,NULL,
  CURRENT_TIMESTAMP - INTERVAL '10 minutes', NULL);

INSERT INTO "WebhookOutbox" (
  "id","url","method","headers","body","status","error","meta","integrationId","createdAt","sentAt"
) VALUES
('seed-hook-1','https://example.com/hook','POST',NULL,'ok','SENT',NULL,NULL,'seed-int-webhook-1', CURRENT_TIMESTAMP - INTERVAL '90 minutes', CURRENT_TIMESTAMP - INTERVAL '88 minutes'),
('seed-hook-2','https://example.com/hook','POST',NULL,'ok','FAILED','timeout',NULL,'seed-int-webhook-1', CURRENT_TIMESTAMP - INTERVAL '40 minutes', NULL),
('seed-hook-3','https://example.com/hook','POST',NULL,'ok','PENDING',NULL,NULL,'seed-int-webhook-1', CURRENT_TIMESTAMP - INTERVAL '15 minutes', NULL);
