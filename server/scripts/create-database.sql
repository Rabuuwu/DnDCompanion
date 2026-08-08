-- Run as the PostgreSQL administrator after replacing the password placeholder:
-- sudo -u postgres psql -v app_password="your-password" -f server/scripts/create-database.sql

SELECT format('CREATE ROLE dnd_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dnd_app')\gexec

SELECT 'CREATE DATABASE dnd_app OWNER dnd_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'dnd_app')\gexec

REVOKE ALL ON DATABASE dnd_app FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE dnd_app TO dnd_app;
