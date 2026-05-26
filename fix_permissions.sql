-- Grant analytics_app full access to datasets table
GRANT SELECT, INSERT, UPDATE, DELETE ON public.datasets TO analytics_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO analytics_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO analytics_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO analytics_app;
-- Make sure future tables are also covered
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO analytics_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO analytics_app;