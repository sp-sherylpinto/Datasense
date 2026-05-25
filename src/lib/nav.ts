import {
  Upload,
  Table,
  Database,
  CheckCircle2,
  BarChart3,
  Lightbulb,
} from 'lucide-react';
import type { TabType, TabGroup } from './types';

export interface TabSpec {
  id: TabType;
  label: string;
  icon: any;
  group: TabGroup;
  requiresFile: boolean;
}

export const TABS: TabSpec[] = [
  // Prepare group
  {
    id: 'upload',
    label: 'Data Source',
    icon: Upload,
    group: 'prepare',
    requiresFile: false,
  },
  {
    id: 'profile',
    label: 'Quality Profile',
    icon: CheckCircle2,
    group: 'prepare',
    requiresFile: false,
  },
  {
    id: 'dataview',
    label: 'Data View',
    icon: Table,
    group: 'prepare',
    requiresFile: true,
  },
  {
    id: 'workbench',
    label: 'SQL Workbench',
    icon: Database,
    group: 'prepare',
    requiresFile: false,
  },

  // Analyse group
  {
    id: 'analyse',
    label: 'Analyse',
    icon: BarChart3,
    group: 'analyse',
    requiresFile: true,
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: Lightbulb,
    group: 'analyse',
    requiresFile: false,
  },
];

export const TABS_BY_ID = TABS.reduce((acc, t) => {
  acc[t.id] = t;
  return acc;
}, {} as Record<string, TabSpec>);

export const isValidTabId = (
  s: string | null | undefined
): s is TabType => {
  if (!s) return false;
  return TABS.some((t) => t.id === s);
};

export const isTabApplicable = (
  tab: TabSpec,
  datasetType?: string
): boolean => true;

export const tabsForGroup = (
  group: TabGroup,
  datasetType?: string
): TabSpec[] => TABS.filter((t) => t.group === group);

export const GROUP_LABELS: Record<TabGroup, string> = {
  prepare: 'Prepare',
  analyse: 'Analyse',
};