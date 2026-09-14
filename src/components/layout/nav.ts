import {
  Building2, ClipboardList, FileBarChart, Globe, KeyRound, LayoutDashboard,
  Megaphone, MessagesSquare, NotebookPen, PackageSearch, Share2, ShieldCheck, Smartphone, TrendingUp, Upload, Users,
} from 'lucide-react';
import type { Permission } from '@/lib/types';

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  description: string;
  /** The permission that opens this page (see src/lib/access.ts). */
  permission?: Permission;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, description: 'Cross-module KPIs and drilldowns' },
    ],
  },
  {
    label: 'Registers',
    items: [
      { to: '/sims', label: 'SIMs & Numbers', icon: Smartphone, description: 'Phone number register' },
      { to: '/agents', label: 'Agents', icon: Users, description: 'Marketing agents and agencies' },
      { to: '/accounts', label: 'Social Accounts', icon: Share2, description: 'Accounts across all platforms' },
      { to: '/domains', label: 'Domains', icon: Globe, description: 'Domain register and rotation', permission: 'access:domains' },
      { to: '/reserves', label: 'Reserve Inventory', icon: PackageSearch, description: 'Ready-to-assign accounts' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/growth', label: 'Growth', icon: TrendingUp, description: 'Daily followers and content engagement' },
      { to: '/ads-monitoring', label: 'Ads Monitoring', icon: Megaphone, description: 'Ad campaigns, daily performance, creatives and trends' },
      { to: '/shared-spiel', label: 'Shared Spiel Library', icon: MessagesSquare, description: 'Approved communication scripts, references and the AI Assistant Learner' },
      { to: '/team-reports', label: 'Team Reports', icon: NotebookPen, description: 'Daily, weekly and monthly work reports' },
      { to: '/assignments', label: 'Assignments', icon: ClipboardList, description: 'Allocations and handovers' },
      { to: '/credentials', label: 'Credential Refs', icon: KeyRound, description: 'Vault references, no secrets', permission: 'access:credential-refs' },
      { to: '/brands', label: 'Brands & Team', icon: Building2, description: 'Brands, projects, platforms, people' },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/reports', label: 'Reports', icon: FileBarChart, description: 'Inventory and readiness reporting' },
      { to: '/import', label: 'Import', icon: Upload, description: 'CSV import and data quality', permission: 'access:import' },
      { to: '/audit', label: 'Roles & Audit', icon: ShieldCheck, description: 'Role preview and audit history', permission: 'access:roles-audit' },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((g) => g.items);
