-- Local development only: runs once, when the MariaDB volume is first created.
-- Production creates the same two accounts with real passwords and the same grants.
CREATE DATABASE IF NOT EXISTS fitness_league CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;

-- Owns the schema. Used only by `backend migrate`.
CREATE USER IF NOT EXISTS 'fl_migrate'@'%' IDENTIFIED BY 'fl_migrate_dev';
GRANT ALL PRIVILEGES ON fitness_league.* TO 'fl_migrate'@'%';

-- Used by the API and the worker: data only, no schema, file or grant rights.
CREATE USER IF NOT EXISTS 'fl_app'@'%' IDENTIFIED BY 'fl_app_dev';
GRANT SELECT, INSERT, UPDATE, DELETE ON fitness_league.* TO 'fl_app'@'%';
