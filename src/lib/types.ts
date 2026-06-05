// export type TabType =
//   | 'upload'
//   | 'dataview'
//   | 'profile'
//   | 'workbench'
//   | 'dashboard'
//   | 'analyse'
//   | 'benford'
//   | 'outliers'
//   | 'timeseries'
//   | 'clustering'
//   | 'network'
//   | 'insights';

// export type TabGroup = 'prepare' | 'analyse';

// export interface ColumnMeta {
//   name: string;
//   inferred_type: string;
//   original_name?: string;
// }

// export interface FileMetadata {
//   file_id: string;
//   dataset_id?: string;
//   file_path: string;
//   table_name?: string;
//   name: string;
//   columns: string[];
//   columnMeta?: ColumnMeta[];
//   preview: any[];
//   row_count?: number;
//   row_count_approx: number;
//   dataset_type?: string;
//   audit_area_code?: string | null;
//   warnings?: string[];
//   pii_detected?: boolean;
//   pii_summary?: any;
// }

// export interface JobStatus {
//   id: string;
//   status: 'pending' | 'running' | 'completed' | 'failed';
//   task_name: string;
//   task_params?: any;
//   result_path?: string;
//   error_message?: string;
// }

// export interface SavedDataset {
//   id: string;
//   original_filename: string;
//   file_path?: string;
//   table_name?: string;
//   row_count?: number;
//   file_type?: string;
//   created_at: string;
//   columns?: ColumnMeta[];
//   dataset_type?: string;
//   audit_area_code?: string | null;
//   pii_detected?: boolean;
//   pii_summary?: any;
// }

// export type AuditVertical = 'general' | 'bank' | 'nbfc' | 'insurance';
// export type AccountingFramework = 'as' | 'ind_as';
// export type AuditAreaCategory = 'line_item' | 'methodology' | 'compliance' | 'reporting' | 'planning' | 'source_data' | 'other';

// export interface AuditArea {
//   id: string;                  // 'general:F-PPE' / 'bank:ADV' etc.
//   vertical: AuditVertical;
//   code: string;                // 'F-PPE', 'ADV', 'CLM', 'SA320', ...
//   title: string;
//   category: AuditAreaCategory;
//   display_order: number;
// }

// // ─── Saved Views ────────────────────────────────────────────────────────────

// export type FilterOp =
//   | 'contains' | 'not_contains'
//   | 'equals' | 'not_equals'
//   | 'regex'
//   | 'gt' | 'gte' | 'lt' | 'lte'
//   | 'between'
//   | 'is_empty' | 'is_not_empty';

// export interface FilterSpec {
//   column: string;
//   op: FilterOp;
//   value?: string;
//   value2?: string;
// }

// export interface SortSpec {
//   column: string;
//   direction: 'asc' | 'desc';
// }

// export interface SavedView {
//   id: string;
//   dataset_id: string;
//   name: string;
//   description?: string | null;
//   audit_area_code?: string | null;
//   view_type: 'table';
//   filters: FilterSpec[];
//   sort?: SortSpec | null;
//   columns?: string[] | null;
//   owner: string;
//   created_at: string;
//   updated_at: string;
// }

// export interface CurrentUser {
//   email: string;
//   name: string;
// }


// export type TabType =
//   | 'upload'
//   | 'dataview'
//   | 'profile'
//   | 'workbench'
//   | 'dashboard'
//   | 'analyse'
//   | 'benford'
//   | 'outliers'
//   | 'timeseries'
//   | 'clustering'
//   | 'network'
//   | 'insights';

// export type TabGroup = 'prepare' | 'analyse';

// export interface ColumnMeta {
//   name: string;
//   inferred_type: string;
//   original_name?: string;
// }

// export interface FileMetadata {
//   file_id: string;
//   dataset_id?: string;
//   file_path: string;
//   table_name?: string;
//   name: string;
//   columns: string[];
//   columnMeta?: ColumnMeta[];
//   preview: any[];
//   row_count?: number;
//   row_count_approx: number;
//   dataset_type?: string;
//   audit_area_code?: string | null;
//   warnings?: string[];
//   pii_detected?: boolean;
//   pii_summary?: any;
//   completeness_pct?: number | null;
// }

// export interface JobStatus {
//   id: string;
//   status: 'pending' | 'running' | 'completed' | 'failed';
//   task_name: string;
//   task_params?: any;
//   result_path?: string;
//   error_message?: string;
// }

// export interface SavedDataset {
//   id: string;
//   original_filename: string;
//   file_path?: string;
//   table_name?: string;
//   row_count?: number;
//   file_type?: string;
//   created_at: string;
//   columns?: ColumnMeta[];
//   dataset_type?: string;
//   audit_area_code?: string | null;
//   pii_detected?: boolean;
//   pii_summary?: any;
//   completeness_pct?: number | null;
// }

// export type AuditVertical = 'general' | 'bank' | 'nbfc' | 'insurance';
// export type AccountingFramework = 'as' | 'ind_as';
// export type AuditAreaCategory = 'line_item' | 'methodology' | 'compliance' | 'reporting' | 'planning' | 'source_data' | 'other';

// export interface AuditArea {
//   id: string;                  // 'general:F-PPE' / 'bank:ADV' etc.
//   vertical: AuditVertical;
//   code: string;                // 'F-PPE', 'ADV', 'CLM', 'SA320', ...
//   title: string;
//   category: AuditAreaCategory;
//   display_order: number;
// }

// // ─── Saved Views ────────────────────────────────────────────────────────────

// export type FilterOp =
//   | 'contains' | 'not_contains'
//   | 'equals' | 'not_equals'
//   | 'regex'
//   | 'gt' | 'gte' | 'lt' | 'lte'
//   | 'between'
//   | 'is_empty' | 'is_not_empty';

// export interface FilterSpec {
//   column: string;
//   op: FilterOp;
//   value?: string;
//   value2?: string;
// }

// export interface SortSpec {
//   column: string;
//   direction: 'asc' | 'desc';
// }

// export interface SavedView {
//   id: string;
//   dataset_id: string;
//   name: string;
//   description?: string | null;
//   audit_area_code?: string | null;
//   view_type: 'table';
//   filters: FilterSpec[];
//   sort?: SortSpec | null;
//   columns?: string[] | null;
//   owner: string;
//   created_at: string;
//   updated_at: string;
// }

// export interface CurrentUser {
//   email: string;
//   name: string;
// }







export type TabType =
  | 'upload'
  | 'dataview'
  | 'profile'
  | 'workbench'
  | 'dashboard'
  | 'analyse'
  | 'benford'
  | 'outliers'
  | 'timeseries'
  | 'clustering'
  | 'network'
  | 'insights'
  | 'compare';

export type TabGroup = 'prepare' | 'analyse';

export interface ColumnMeta {
  name: string;
  inferred_type: string;
  original_name?: string;
  user_type?: string | null;
  null_pct?: number | null;
  native_dtype?: boolean;
}

export interface FileMetadata {
  file_id: string;
  dataset_id?: string;
  file_path: string;
  table_name?: string;
  name: string;
  columns: string[];
  columnMeta?: ColumnMeta[];
  preview: any[];
  row_count?: number;
  row_count_approx: number;
  dataset_type?: string;
  audit_area_code?: string | null;
  warnings?: string[];
  pii_detected?: boolean;
  pii_summary?: any;
}

export interface JobStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  task_name: string;
  task_params?: any;
  result_path?: string;
  error_message?: string;
}

export interface SavedDataset {
  id: string;
  original_filename: string;
  file_path?: string;
  table_name?: string;
  row_count?: number;
  file_type?: string;
  created_at: string;
  columns?: ColumnMeta[];
  dataset_type?: string;
  audit_area_code?: string | null;
  pii_detected?: boolean;
  pii_summary?: any;
}

export type AuditVertical = 'general' | 'bank' | 'nbfc' | 'insurance';
export type AccountingFramework = 'as' | 'ind_as';
export type AuditAreaCategory = 'line_item' | 'methodology' | 'compliance' | 'reporting' | 'planning' | 'source_data' | 'other';

export interface AuditArea {
  id: string;
  vertical: AuditVertical;
  code: string;
  title: string;
  category: AuditAreaCategory;
  display_order: number;
}

export type FilterOp =
  | 'contains' | 'not_contains'
  | 'equals' | 'not_equals'
  | 'regex'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'between'
  | 'is_empty' | 'is_not_empty';

export interface FilterSpec {
  column: string;
  op: FilterOp;
  value?: string;
  value2?: string;
}

export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
}

export interface SavedView {
  id: string;
  dataset_id: string;
  name: string;
  description?: string | null;
  audit_area_code?: string | null;
  view_type: 'table';
  filters: FilterSpec[];
  sort?: SortSpec | null;
  columns?: string[] | null;
  owner: string;
  created_at: string;
  updated_at: string;
}

export interface CurrentUser {
  email: string;
  name: string;
}