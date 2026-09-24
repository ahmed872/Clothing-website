'use client';

import * as React from 'react';
import { Mail, Plus, Settings, Trash2 } from 'lucide-react';

import type { Locale } from '../gallery-shell';
import { SectionHeading, SubHeading } from './section-heading';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { toast } from '@/components/ui/toast';

const BUTTON_VARIANTS = [
  'primary',
  'secondary',
  'outline',
  'ghost',
  'destructive',
  'link',
] as const;

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

export function ComponentsSection({ locale }: { locale: Locale }) {
  const [page, setPage] = React.useState(4);

  return (
    <section className="flex flex-col gap-10">
      <SectionHeading
        id="components"
        title={locale === 'ar' ? 'المكوّنات الأساسية' : 'Core components'}
      />

      <div className="flex flex-col gap-3">
        <SubHeading>Button</SubHeading>
        {(['md', 'sm', 'lg'] as const).map((size) => (
          <Row key={size}>
            {BUTTON_VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} size={size}>
                {locale === 'ar' ? 'إضافة منتج' : 'Add product'}
              </Button>
            ))}
            <Button size={size} disabled>
              {locale === 'ar' ? 'معطل' : 'Disabled'}
            </Button>
            <Button size={size} loading>
              {locale === 'ar' ? 'جارٍ الحفظ' : 'Saving'}
            </Button>
            <Button size="icon" aria-label="Settings" variant="outline">
              <Settings />
            </Button>
          </Row>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <SubHeading>Badge</SubHeading>
        <Row>
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="brand">Brand</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="error">Error</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="outline">Outline</Badge>
        </Row>
      </div>

      <div className="flex flex-col gap-3">
        <SubHeading>Alert</SubHeading>
        <div className="flex flex-col gap-3">
          <Alert variant="info" title={locale === 'ar' ? 'معلومة' : 'Info'}>
            {locale === 'ar'
              ? 'سيتم إرسال إشعار عند توفر المنتج.'
              : 'You will be notified when back in stock.'}
          </Alert>
          <Alert variant="success" title={locale === 'ar' ? 'تم بنجاح' : 'Success'}>
            {locale === 'ar' ? 'تم حفظ التغييرات.' : 'Changes saved.'}
          </Alert>
          <Alert variant="warning" title={locale === 'ar' ? 'تنبيه' : 'Warning'}>
            {locale === 'ar' ? 'الكمية المتبقية منخفضة.' : 'Remaining stock is low.'}
          </Alert>
          <Alert variant="error" title={locale === 'ar' ? 'خطأ' : 'Error'}>
            {locale === 'ar' ? 'تعذر معالجة الطلب.' : 'Could not process the order.'}
          </Alert>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SubHeading>Form controls</SubHeading>
        <Card className="max-w-lg">
          <CardContent className="flex flex-col gap-5 pt-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gallery-email">
                {locale === 'ar' ? 'البريد الإلكتروني' : 'Email'}
              </Label>
              <Input id="gallery-email" type="email" placeholder="name@example.com" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gallery-email-invalid">
                {locale === 'ar' ? 'حقل غير صالح' : 'Invalid field'}
              </Label>
              <Input id="gallery-email-invalid" aria-invalid defaultValue="not-an-email" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gallery-notes">{locale === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea
                id="gallery-notes"
                placeholder={locale === 'ar' ? 'اكتب هنا…' : 'Write here…'}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gallery-category">{locale === 'ar' ? 'التصنيف' : 'Category'}</Label>
              <Select defaultValue="cars">
                <SelectTrigger id="gallery-category">
                  <SelectValue>{locale === 'ar' ? 'سيارات' : 'Cars'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cars">{locale === 'ar' ? 'سيارات' : 'Cars'}</SelectItem>
                  <SelectItem value="shoes">{locale === 'ar' ? 'أحذية' : 'Shoes'}</SelectItem>
                  <SelectItem value="electronics">
                    {locale === 'ar' ? 'إلكترونيات' : 'Electronics'}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="gallery-checkbox" defaultChecked />
              <Label htmlFor="gallery-checkbox">
                {locale === 'ar' ? 'تفعيل المنتج' : 'Product active'}
              </Label>
            </div>
            <RadioGroup defaultValue="sar" className="flex flex-row gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="sar" id="gallery-sar" />
                <Label htmlFor="gallery-sar">SAR</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="usd" id="gallery-usd" />
                <Label htmlFor="gallery-usd">USD</Label>
              </div>
            </RadioGroup>
            <div className="flex items-center justify-between">
              <Label htmlFor="gallery-switch">
                {locale === 'ar' ? 'إشعارات البريد' : 'Email notifications'}
              </Label>
              <Switch id="gallery-switch" defaultChecked />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <SubHeading>Tooltip · Dropdown · Dialog · Drawer</SubHeading>
        <Row>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Mail">
                <Mail />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{locale === 'ar' ? 'إرسال بريد' : 'Send email'}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">{locale === 'ar' ? 'إجراءات' : 'Actions'}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{locale === 'ar' ? 'المنتج' : 'Product'}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <Plus className="size-4" /> {locale === 'ar' ? 'تكرار' : 'Duplicate'}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive">
                <Trash2 className="size-4" /> {locale === 'ar' ? 'حذف' : 'Delete'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">{locale === 'ar' ? 'فتح نافذة' : 'Open dialog'}</Button>
            </DialogTrigger>
            <DialogContent closeLabel={locale === 'ar' ? 'إغلاق' : 'Close'}>
              <DialogHeader>
                <DialogTitle>{locale === 'ar' ? 'تأكيد الإجراء' : 'Confirm action'}</DialogTitle>
                <DialogDescription>
                  {locale === 'ar'
                    ? 'هذا مثال على نافذة حوار قياسية.'
                    : 'This is a standard dialog example.'}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline">{locale === 'ar' ? 'إلغاء' : 'Cancel'}</Button>
                <Button>{locale === 'ar' ? 'تأكيد' : 'Confirm'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="outline">
                {locale === 'ar' ? 'فتح لوحة جانبية' : 'Open drawer'}
              </Button>
            </DrawerTrigger>
            <DrawerContent side="end" closeLabel={locale === 'ar' ? 'إغلاق' : 'Close'}>
              <DrawerHeader>
                <DrawerTitle>{locale === 'ar' ? 'تفاصيل الطلب' : 'Order details'}</DrawerTitle>
                <DrawerDescription>
                  {locale === 'ar'
                    ? 'تنزلق من الجانب المناسب للاتجاه تلقائيًا.'
                    : 'Slides in from the correct physical side automatically.'}
                </DrawerDescription>
              </DrawerHeader>
              <DrawerFooter>
                <Button>{locale === 'ar' ? 'إغلاق' : 'Close'}</Button>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>

          <Button
            variant="outline"
            onClick={() =>
              toast({
                title: locale === 'ar' ? 'تم الحفظ' : 'Saved',
                description:
                  locale === 'ar' ? 'تم تحديث المنتج بنجاح.' : 'The product was updated.',
                variant: 'success',
              })
            }
          >
            {locale === 'ar' ? 'إظهار إشعار' : 'Show toast'}
          </Button>
        </Row>
      </div>

      <div className="flex flex-col gap-3">
        <SubHeading>Tabs</SubHeading>
        <Tabs defaultValue="details" className="max-w-md">
          <TabsList>
            <TabsTrigger value="details">{locale === 'ar' ? 'التفاصيل' : 'Details'}</TabsTrigger>
            <TabsTrigger value="pricing">{locale === 'ar' ? 'التسعير' : 'Pricing'}</TabsTrigger>
            <TabsTrigger value="shipping">{locale === 'ar' ? 'الشحن' : 'Shipping'}</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="text-small text-(--color-text-muted)">
            {locale === 'ar' ? 'محتوى تبويب التفاصيل.' : 'Details tab content.'}
          </TabsContent>
          <TabsContent value="pricing" className="text-small text-(--color-text-muted)">
            {locale === 'ar' ? 'محتوى تبويب التسعير.' : 'Pricing tab content.'}
          </TabsContent>
          <TabsContent value="shipping" className="text-small text-(--color-text-muted)">
            {locale === 'ar' ? 'محتوى تبويب الشحن.' : 'Shipping tab content.'}
          </TabsContent>
        </Tabs>
      </div>

      <div className="flex flex-col gap-3">
        <SubHeading>Breadcrumb · Pagination</SubHeading>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#">{locale === 'ar' ? 'الرئيسية' : 'Home'}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#">{locale === 'ar' ? 'سيارات' : 'Cars'}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {locale === 'ar' ? 'رنج روفر 2026' : 'Range Rover 2026'}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Pagination page={page} pageCount={12} onPageChange={setPage} />
      </div>

      <div className="flex flex-col gap-3">
        <SubHeading>Table</SubHeading>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{locale === 'ar' ? 'الطلب' : 'Order'}</TableHead>
              <TableHead>{locale === 'ar' ? 'العميل' : 'Customer'}</TableHead>
              <TableHead className="text-end">{locale === 'ar' ? 'الإجمالي' : 'Total'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              {
                id: 'ORD-1042',
                name: locale === 'ar' ? 'سارة أحمد' : 'Sarah Ahmed',
                total: '1,250.00',
              },
              {
                id: 'ORD-1041',
                name: locale === 'ar' ? 'محمد علي' : 'Mohammed Ali',
                total: '430.00',
              },
            ].map((row) => (
              <TableRow key={row.id}>
                <TableCell className="tabular-nums">{row.id}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-end tabular-nums">{row.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-3">
          <SubHeading>Card</SubHeading>
          <Card>
            <CardHeader>
              <CardTitle>{locale === 'ar' ? 'ملخص المخزون' : 'Inventory summary'}</CardTitle>
              <CardDescription>
                {locale === 'ar' ? 'آخر تحديث قبل 3 دقائق' : 'Updated 3 minutes ago'}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-small text-(--color-text-muted)">
              {locale === 'ar'
                ? '124 منتجًا متوفرًا في 4 مستودعات.'
                : '124 products available across 4 warehouses.'}
            </CardContent>
            <CardFooter>
              <Button size="sm" variant="outline">
                {locale === 'ar' ? 'عرض التفاصيل' : 'View details'}
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="flex flex-col gap-3">
          <SubHeading>Skeleton</SubHeading>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-3">
          <SubHeading>{locale === 'ar' ? 'حالات فارغة/خطأ' : 'Empty / Error state'}</SubHeading>
          <div className="flex flex-col gap-3">
            <EmptyState title={locale === 'ar' ? 'لا توجد نتائج' : 'No results'} className="py-8" />
            <ErrorState
              title={locale === 'ar' ? 'فشل التحميل' : 'Failed to load'}
              onRetry={() => {}}
              className="py-8"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
