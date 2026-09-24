'use client';

import * as React from 'react';
import { LayoutGrid, Package, Settings2, ShoppingCart, Users } from 'lucide-react';

import type { Locale } from '../gallery-shell';
import { SectionHeading, SubHeading } from './section-heading';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sidebar } from '@/components/admin/sidebar';
import { PageHeader } from '@/components/admin/page-header';
import { KpiCard } from '@/components/admin/kpi-card';
import { AdminSearch } from '@/components/admin/search';
import { FilterBar } from '@/components/admin/filters';
import { FormSection } from '@/components/admin/form-section';
import { StatusBadge } from '@/components/admin/status-badge';
import { BulkActionBar } from '@/components/admin/bulk-action-bar';
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog';
import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface OrderRow {
  id: string;
  customer: string;
  totalMinor: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'cancelled';
}

const ORDER_ROWS: OrderRow[] = [
  { id: 'ORD-1042', customer: 'سارة أحمد', totalMinor: 125_000, status: 'confirmed' },
  { id: 'ORD-1041', customer: 'محمد علي', totalMinor: 43_000, status: 'pending' },
  { id: 'ORD-1040', customer: 'نورة سالم', totalMinor: 899_00, status: 'shipped' },
  { id: 'ORD-1039', customer: 'خالد فهد', totalMinor: 12_000, status: 'cancelled' },
];

const STATUS_TONE = {
  pending: 'warning',
  confirmed: 'info',
  shipped: 'success',
  cancelled: 'error',
} as const;

const STATUS_LABEL = {
  ar: { pending: 'قيد الانتظار', confirmed: 'مؤكد', shipped: 'تم الشحن', cancelled: 'ملغي' },
  en: { pending: 'Pending', confirmed: 'Confirmed', shipped: 'Shipped', cancelled: 'Cancelled' },
} as const;

export function AdminSection({ locale }: { locale: Locale }) {
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const columns: DataTableColumn<OrderRow>[] = [
    {
      key: 'id',
      header: locale === 'ar' ? 'الطلب' : 'Order',
      cell: (row) => row.id,
      sortable: true,
    },
    {
      key: 'customer',
      header: locale === 'ar' ? 'العميل' : 'Customer',
      cell: (row) => row.customer,
    },
    {
      key: 'status',
      header: locale === 'ar' ? 'الحالة' : 'Status',
      cell: (row) => (
        <StatusBadge label={STATUS_LABEL[locale][row.status]} tone={STATUS_TONE[row.status]} />
      ),
    },
    {
      key: 'total',
      header: locale === 'ar' ? 'الإجمالي' : 'Total',
      align: 'end',
      cell: (row) => (row.totalMinor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    },
  ];

  return (
    <section className="flex flex-col gap-10">
      <SectionHeading
        id="admin"
        title={locale === 'ar' ? 'عناصر لوحة الإدارة' : 'Admin primitives'}
      />

      <div className="flex flex-col gap-3">
        <SubHeading>Sidebar</SubHeading>
        <div className="h-96 overflow-hidden rounded-(--radius-surface) border border-(--color-border)">
          <Sidebar
            navLabel={locale === 'ar' ? 'التنقل الرئيسي' : 'Main navigation'}
            sections={[
              {
                key: 'main',
                items: [
                  {
                    key: 'overview',
                    label: locale === 'ar' ? 'نظرة عامة' : 'Overview',
                    href: '#',
                    icon: LayoutGrid,
                    active: true,
                  },
                  {
                    key: 'products',
                    label: locale === 'ar' ? 'المنتجات' : 'Products',
                    href: '#',
                    icon: Package,
                  },
                  {
                    key: 'orders',
                    label: locale === 'ar' ? 'الطلبات' : 'Orders',
                    href: '#',
                    icon: ShoppingCart,
                  },
                  {
                    key: 'customers',
                    label: locale === 'ar' ? 'العملاء' : 'Customers',
                    href: '#',
                    icon: Users,
                  },
                ],
              },
              {
                key: 'system',
                label: locale === 'ar' ? 'النظام' : 'System',
                items: [
                  {
                    key: 'settings',
                    label: locale === 'ar' ? 'الإعدادات' : 'Settings',
                    href: '#',
                    icon: Settings2,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SubHeading>PageHeader · KpiCard</SubHeading>
        <div className="flex flex-col gap-6 rounded-(--radius-surface) border border-(--color-border) p-5">
          <PageHeader
            title={locale === 'ar' ? 'الطلبات' : 'Orders'}
            description={locale === 'ar' ? '312 طلبًا هذا الشهر' : '312 orders this month'}
            actions={<Button size="sm">{locale === 'ar' ? 'تصدير' : 'Export'}</Button>}
            headingLevel={3}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              label={locale === 'ar' ? 'إجمالي المبيعات' : 'Total sales'}
              value="SAR 128,400"
              icon={ShoppingCart}
              delta={12.4}
              deltaLabel={locale === 'ar' ? 'مقابل الشهر السابق' : 'vs last month'}
            />
            <KpiCard
              label={locale === 'ar' ? 'الطلبات' : 'Orders'}
              value="312"
              icon={Package}
              delta={-3.1}
            />
            <KpiCard
              label={locale === 'ar' ? 'العملاء الجدد' : 'New customers'}
              value="48"
              icon={Users}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SubHeading>Search · Filters</SubHeading>
        <div className="flex flex-col gap-3">
          <AdminSearch value={search} onChange={setSearch} className="max-w-sm" />
          <FilterBar
            activeFilters={[
              { key: 'status', label: locale === 'ar' ? 'الحالة: مؤكد' : 'Status: Confirmed' },
            ]}
            onRemoveFilter={() => {}}
            onClearAll={() => {}}
            clearAllLabel={locale === 'ar' ? 'مسح الكل' : 'Clear all'}
            removeFilterLabel={(label) => (locale === 'ar' ? `إزالة ${label}` : `Remove ${label}`)}
          >
            <Select defaultValue="all">
              <SelectTrigger
                className="w-40"
                aria-label={locale === 'ar' ? 'تصفية حسب الحالة' : 'Filter by status'}
              >
                <SelectValue>{locale === 'ar' ? 'كل الحالات' : 'All statuses'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {locale === 'ar' ? 'كل الحالات' : 'All statuses'}
                </SelectItem>
                <SelectItem value="pending">{STATUS_LABEL[locale].pending}</SelectItem>
                <SelectItem value="confirmed">{STATUS_LABEL[locale].confirmed}</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SubHeading>DataTable · BulkActionBar</SubHeading>
        <DataTable
          columns={columns}
          rows={ORDER_ROWS}
          getRowId={(row) => row.id}
          selectedIds={selected}
          onSelectedIdsChange={setSelected}
        />
        <BulkActionBar
          selectedCount={selected.size}
          onClear={() => setSelected(new Set())}
          toolbarLabel={locale === 'ar' ? 'إجراءات جماعية' : 'Bulk actions'}
          clearLabel={locale === 'ar' ? 'إلغاء التحديد' : 'Clear selection'}
          countLabel={(count) => (locale === 'ar' ? `${count} محدد` : `${count} selected`)}
          actions={
            <>
              <Button size="sm" variant="secondary">
                {locale === 'ar' ? 'تصدير' : 'Export'}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setConfirmOpen(true)}>
                {locale === 'ar' ? 'إلغاء الطلبات' : 'Cancel orders'}
              </Button>
            </>
          }
        />
        <ConfirmationDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={locale === 'ar' ? 'إلغاء الطلبات المحددة؟' : 'Cancel selected orders?'}
          description={
            locale === 'ar' ? 'لا يمكن التراجع عن هذا الإجراء.' : 'This action cannot be undone.'
          }
          destructive
          onConfirm={() => setConfirmOpen(false)}
        />
      </div>

      <div className="flex flex-col gap-3">
        <SubHeading>FormSection</SubHeading>
        <div className="rounded-(--radius-surface) border border-(--color-border) px-5">
          <FormSection
            title={locale === 'ar' ? 'معلومات عامة' : 'General information'}
            description={
              locale === 'ar'
                ? 'الاسم والوصف الظاهر للعملاء.'
                : 'The name and description customers see.'
            }
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="admin-product-name">
                {locale === 'ar' ? 'اسم المنتج' : 'Product name'}
              </Label>
              <Input
                id="admin-product-name"
                defaultValue={locale === 'ar' ? 'رنج روفر فيلار 2026' : 'Range Rover Velar 2026'}
              />
            </div>
          </FormSection>
        </div>
      </div>
    </section>
  );
}
