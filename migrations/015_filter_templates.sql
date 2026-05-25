-- Filter Templates table for memory functionality
CREATE TABLE IF NOT EXISTS filter_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  filters JSONB DEFAULT '[]'::jsonb,
  sort_by VARCHAR(255),
  sort_order VARCHAR(10),
  view_columns TEXT[],
  dataset_type VARCHAR(100),
  filter_count INTEGER DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  last_used TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_created_by FOREIGN KEY (created_by) REFERENCES core_user(id) ON DELETE CASCADE,
  CONSTRAINT unique_user_filter_name UNIQUE (created_by, name)
);

-- Track when filters are used
CREATE TABLE IF NOT EXISTS filter_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL,
  dataset_id UUID NOT NULL,
  user_id UUID NOT NULL,
  used_at TIMESTAMP DEFAULT NOW(),
  result_count INTEGER,
  execution_time_ms INTEGER,
  CONSTRAINT fk_template FOREIGN KEY (template_id) REFERENCES filter_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES core_user(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_filter_templates_user ON filter_templates(created_by);
CREATE INDEX IF NOT EXISTS idx_filter_templates_dataset_type ON filter_templates(dataset_type);
CREATE INDEX IF NOT EXISTS idx_filter_templates_usage ON filter_templates(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_filter_usage_template ON filter_usage(template_id);
CREATE INDEX IF NOT EXISTS idx_filter_usage_date ON filter_usage(used_at DESC);

-- RLS for filter_templates
ALTER TABLE filter_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY filter_templates_user_isolation ON filter_templates
  USING (created_by = current_user_id())
  WITH CHECK (created_by = current_user_id());

-- RLS for filter_usage
ALTER TABLE filter_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY filter_usage_user_isolation ON filter_usage
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON filter_templates TO analytics_app;
GRANT SELECT, INSERT ON filter_usage TO analytics_app;