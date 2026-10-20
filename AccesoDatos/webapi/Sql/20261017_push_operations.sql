-- Additive and idempotent. Stop the API, back up the database, apply the previous
-- 20261016 migration first, then this file with the migration principal.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @lock int;
EXEC @lock=sys.sp_getapplock @Resource='eunice-schema-20261017-push',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=30000;
IF @lock < 0 THROW 51017,'No se pudo bloquear la migracion push.',1;
IF COL_LENGTH('dbo.dispositivo_push','registration_id') IS NULL
 ALTER TABLE dbo.dispositivo_push ADD registration_id uniqueidentifier NOT NULL CONSTRAINT DF_dispositivo_registration DEFAULT NEWID();
IF COL_LENGTH('dbo.dispositivo_push','binding_changed_at') IS NULL
 ALTER TABLE dbo.dispositivo_push ADD binding_changed_at datetime2 NOT NULL CONSTRAINT DF_dispositivo_binding DEFAULT SYSUTCDATETIME();
IF OBJECT_ID('dbo.push_notification_marker','U') IS NULL
 CREATE TABLE dbo.push_notification_marker (
  EventKey nvarchar(200) NOT NULL CONSTRAINT PK_push_notification_marker PRIMARY KEY,
  CreatedAt datetime2 NOT NULL
 );
IF OBJECT_ID('dbo.push_outbox_message','U') IS NULL
BEGIN
 CREATE TABLE dbo.push_outbox_message (
  Id uniqueidentifier NOT NULL CONSTRAINT PK_push_outbox_message PRIMARY KEY,
  EventKey nvarchar(200) NOT NULL, Title nvarchar(100) NOT NULL, Body nvarchar(180) NOT NULL,
  DataJson nvarchar(max) NOT NULL, UserIdsJson nvarchar(max) NOT NULL, RolesJson nvarchar(max) NOT NULL,
  ExcludeUserId int NULL, CreatedAt datetime2 NOT NULL, ExpiresAt datetime2 NOT NULL, ExpandedAt datetime2 NULL
 );
END;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.push_outbox_message') AND name='UX_push_outbox_event')
 CREATE UNIQUE INDEX UX_push_outbox_event ON dbo.push_outbox_message(EventKey);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.push_outbox_message') AND name='IX_push_outbox_expand')
 CREATE INDEX IX_push_outbox_expand ON dbo.push_outbox_message(ExpandedAt,CreatedAt);
IF OBJECT_ID('dbo.push_outbox_delivery','U') IS NULL
BEGIN
 CREATE TABLE dbo.push_outbox_delivery (
  Id uniqueidentifier NOT NULL CONSTRAINT PK_push_outbox_delivery PRIMARY KEY,
  MessageId uniqueidentifier NOT NULL, DeviceId int NOT NULL, UserId int NOT NULL, RegistrationId uniqueidentifier NOT NULL,
  Token nvarchar(200) NOT NULL, Status nvarchar(20) NOT NULL, Attempts int NOT NULL,
  NextAttemptAt datetime2 NOT NULL, AcceptedAt datetime2 NULL, TicketId nvarchar(200) NULL,
  LastError nvarchar(50) NULL, LeaseId uniqueidentifier NULL, LeaseUntil datetime2 NULL,
  CONSTRAINT FK_push_delivery_message FOREIGN KEY(MessageId) REFERENCES dbo.push_outbox_message(Id) ON DELETE CASCADE
 );
END;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.push_outbox_delivery') AND name='UX_push_delivery_device')
 CREATE UNIQUE INDEX UX_push_delivery_device ON dbo.push_outbox_delivery(MessageId,DeviceId);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.push_outbox_delivery') AND name='IX_push_delivery_due')
 CREATE INDEX IX_push_delivery_due ON dbo.push_outbox_delivery(Status,NextAttemptAt,LeaseUntil);
IF OBJECT_ID('dbo.tracking_notification_state','U') IS NULL
 CREATE TABLE dbo.tracking_notification_state (
  TripId int NOT NULL CONSTRAINT PK_tracking_notification_state PRIMARY KEY,
  MonitoredSince datetime2 NOT NULL, LostAt datetime2 NULL
 );
IF OBJECT_ID('dbo.guest_push_subscription','U') IS NULL
BEGIN
 CREATE TABLE dbo.guest_push_subscription (
  Id uniqueidentifier NOT NULL CONSTRAINT PK_guest_push_subscription PRIMARY KEY,
  ConversationId uniqueidentifier NOT NULL, Revision uniqueidentifier NOT NULL,
  EndpointHash nvarchar(64) NOT NULL, Endpoint nvarchar(2048) NOT NULL,
  P256dh nvarchar(100) NOT NULL, Auth nvarchar(100) NOT NULL,
  ProtectedUrl nvarchar(2048) NOT NULL, Active bit NOT NULL, ExpiresAt datetime2 NOT NULL
 );
 CREATE UNIQUE INDEX IX_guest_push_subscription_ConversationId ON dbo.guest_push_subscription(ConversationId);
 CREATE UNIQUE INDEX IX_guest_push_subscription_EndpointHash ON dbo.guest_push_subscription(EndpointHash);
END;
IF OBJECT_ID('dbo.guest_push_job','U') IS NULL
 CREATE TABLE dbo.guest_push_job (
  Id uniqueidentifier NOT NULL CONSTRAINT PK_guest_push_job PRIMARY KEY,
  SubscriptionId uniqueidentifier NOT NULL, SubscriptionRevision uniqueidentifier NOT NULL,
  Status nvarchar(20) NOT NULL, Attempts int NOT NULL, NextAttemptAt datetime2 NOT NULL,
  ExpiresAt datetime2 NOT NULL, LeaseId uniqueidentifier NULL, LeaseUntil datetime2 NULL, LastError nvarchar(50) NULL
 );
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.guest_push_job') AND name='IX_guest_push_due')
 CREATE INDEX IX_guest_push_due ON dbo.guest_push_job(Status,NextAttemptAt,LeaseUntil);
IF OBJECT_ID('dbo.guest_push_keys','U') IS NULL
 CREATE TABLE dbo.guest_push_keys (
  Id int NOT NULL CONSTRAINT PK_guest_push_keys PRIMARY KEY,
  PublicKey nvarchar(100) NOT NULL, ProtectedPrivateKey nvarchar(2048) NOT NULL
 );
COMMIT;
