import { api } from './api';
import type { AccountingFramework, AuditVertical } from './types';

export interface CoreEngagement {
  engagement_id: string;
  engagement_code: string;
  engagement_name: string;
  engagement_type: string;
  vertical: AuditVertical | null;
  framework: AccountingFramework | null;
  period_start: string;
  period_end: string;
  status: string;
  client_id: string;
  client_code: string;
  client_name: string;
  client_display_name: string | null;
  gstin: string | null;
  pan: string | null;
  lead_partner_email: string | null;
  lead_partner_name: string | null;
  materiality_planning: number | string | null;     // Overall Materiality (OM)
  materiality_performance: number | string | null;  // Performance Materiality (PM)
}

export interface CorePartner {
  id: string;
  email: string;
  display_name: string;
  icai_membership_no: string | null;
}

export interface CoreClient {
  id: string;
  code: string;
  legal_name: string;
  display_name: string | null;
  gstin: string | null;
  pan: string | null;
  status: string;
}

export const coreApi = {
  engagements: (params?: { status?: string }) =>
    api.get<CoreEngagement[]>('/core/engagements', { params }).then(r => r.data),
  engagement: (id: string) =>
    api.get<CoreEngagement>(`/core/engagements/${id}`).then(r => r.data),
  partners: () =>
    api.get<CorePartner[]>('/core/partners').then(r => r.data),
  clients: () =>
    api.get<CoreClient[]>('/core/clients').then(r => r.data),
};
