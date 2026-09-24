import { beforeEach, describe, expect, it } from 'vitest';

import { createCategory } from './category.service';
import {
  createAttributeDefinition,
  updateAttributeDefinition,
  deleteAttributeDefinition,
  listAttributeDefinitions,
  getEffectiveAttributeDefinitions,
  validateProductAttributes,
} from './attribute.service';
import { resetCatalogTables } from './testing';

beforeEach(async () => {
  await resetCatalogTables();
});

describe('createAttributeDefinition', () => {
  it('creates a TEXT attribute', async () => {
    const category = await createCategory({ slug: 'cars', nameAr: 'سيارات', nameEn: 'Cars' });
    const def = await createAttributeDefinition({
      categoryId: category.id,
      key: 'engine',
      labelAr: 'المحرك',
      labelEn: 'Engine',
      type: 'TEXT',
    });
    expect(def.type).toBe('TEXT');
    expect(def.required).toBe(false);
    expect(def.filterable).toBe(false);
  });

  it('requires allowedValues for SELECT', async () => {
    const category = await createCategory({ slug: 'cars', nameAr: 'سيارات', nameEn: 'Cars' });
    await expect(
      createAttributeDefinition({
        categoryId: category.id,
        key: 'fuel_type',
        labelAr: 'نوع الوقود',
        labelEn: 'Fuel type',
        type: 'SELECT',
      }),
    ).rejects.toThrow();
  });

  it('accepts SELECT with allowedValues, filterable', async () => {
    const category = await createCategory({ slug: 'cars', nameAr: 'سيارات', nameEn: 'Cars' });
    const def = await createAttributeDefinition({
      categoryId: category.id,
      key: 'fuel_type',
      labelAr: 'نوع الوقود',
      labelEn: 'Fuel type',
      type: 'SELECT',
      allowedValues: ['Petrol', 'Hybrid', 'Electric'],
      filterable: true,
      required: true,
    });
    expect(def.allowedValues).toEqual(['Petrol', 'Hybrid', 'Electric']);
    expect(def.filterable).toBe(true);
  });

  it('rejects a category that does not exist', async () => {
    await expect(
      createAttributeDefinition({
        categoryId: '00000000-0000-0000-0000-000000000000',
        key: 'engine',
        labelAr: 'المحرك',
        labelEn: 'Engine',
        type: 'TEXT',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists definitions in displayOrder', async () => {
    const category = await createCategory({ slug: 'cars', nameAr: 'سيارات', nameEn: 'Cars' });
    await createAttributeDefinition({
      categoryId: category.id,
      key: 'b',
      labelAr: 'ب',
      labelEn: 'B',
      type: 'TEXT',
      displayOrder: 2,
    });
    await createAttributeDefinition({
      categoryId: category.id,
      key: 'a',
      labelAr: 'أ',
      labelEn: 'A',
      type: 'TEXT',
      displayOrder: 1,
    });
    const defs = await listAttributeDefinitions(category.id);
    expect(defs.map((d) => d.key)).toEqual(['a', 'b']);
  });
});

describe('updateAttributeDefinition', () => {
  it('rejects switching to SELECT without allowedValues', async () => {
    const category = await createCategory({ slug: 'cars', nameAr: 'سيارات', nameEn: 'Cars' });
    const def = await createAttributeDefinition({
      categoryId: category.id,
      key: 'engine',
      labelAr: 'المحرك',
      labelEn: 'Engine',
      type: 'TEXT',
    });
    await expect(updateAttributeDefinition(def.id, { type: 'SELECT' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('attribute inheritance', () => {
  it("parent only: a leaf with no attributes of its own inherits the parent's", async () => {
    const parent = await createCategory({ slug: 'vehicles', nameAr: 'مركبات', nameEn: 'Vehicles' });
    await createAttributeDefinition({
      categoryId: parent.id,
      key: 'color',
      labelAr: 'اللون',
      labelEn: 'Color',
      type: 'TEXT',
    });
    const child = await createCategory({
      slug: 'cars',
      nameAr: 'سيارات',
      nameEn: 'Cars',
      parentId: parent.id,
    });

    const effective = await getEffectiveAttributeDefinitions(child.id);
    expect(effective.map((d) => d.key)).toEqual(['color']);
  });

  it('parent + child: child sees its own attributes plus the inherited ones, not duplicated', async () => {
    const parent = await createCategory({ slug: 'vehicles', nameAr: 'مركبات', nameEn: 'Vehicles' });
    await createAttributeDefinition({
      categoryId: parent.id,
      key: 'color',
      labelAr: 'اللون',
      labelEn: 'Color',
      type: 'TEXT',
      displayOrder: 1,
    });
    const child = await createCategory({
      slug: 'cars',
      nameAr: 'سيارات',
      nameEn: 'Cars',
      parentId: parent.id,
    });
    await createAttributeDefinition({
      categoryId: child.id,
      key: 'seating',
      labelAr: 'عدد المقاعد',
      labelEn: 'Seating',
      type: 'NUMBER',
      displayOrder: 2,
    });

    const effective = await getEffectiveAttributeDefinitions(child.id);
    expect(effective.map((d) => d.key)).toEqual(['color', 'seating']);
  });

  it('nested inheritance: grandchild sees definitions from every ancestor', async () => {
    const grandparent = await createCategory({
      slug: 'vehicles',
      nameAr: 'مركبات',
      nameEn: 'Vehicles',
    });
    await createAttributeDefinition({
      categoryId: grandparent.id,
      key: 'color',
      labelAr: 'اللون',
      labelEn: 'Color',
      type: 'TEXT',
      displayOrder: 1,
    });
    const parent = await createCategory({
      slug: 'cars',
      nameAr: 'سيارات',
      nameEn: 'Cars',
      parentId: grandparent.id,
    });
    await createAttributeDefinition({
      categoryId: parent.id,
      key: 'seating',
      labelAr: 'عدد المقاعد',
      labelEn: 'Seating',
      type: 'NUMBER',
      displayOrder: 2,
    });
    const child = await createCategory({
      slug: 'suvs',
      nameAr: 'دفع رباعي',
      nameEn: 'SUVs',
      parentId: parent.id,
    });
    await createAttributeDefinition({
      categoryId: child.id,
      key: 'ground_clearance',
      labelAr: 'ارتفاع أرضي',
      labelEn: 'Ground clearance',
      type: 'NUMBER',
      unit: 'mm',
      displayOrder: 3,
    });

    const effective = await getEffectiveAttributeDefinitions(child.id);
    expect(effective.map((d) => d.key)).toEqual(['color', 'seating', 'ground_clearance']);
  });

  it("duplicate/conflicting keys: a child definition overrides its ancestor's for the same key, without duplicating it", async () => {
    const parent = await createCategory({ slug: 'vehicles', nameAr: 'مركبات', nameEn: 'Vehicles' });
    await createAttributeDefinition({
      categoryId: parent.id,
      key: 'color',
      labelAr: 'اللون',
      labelEn: 'Color',
      type: 'TEXT',
    });
    const child = await createCategory({
      slug: 'cars',
      nameAr: 'سيارات',
      nameEn: 'Cars',
      parentId: parent.id,
    });
    // Conflicting definition: same key, different type and label.
    await createAttributeDefinition({
      categoryId: child.id,
      key: 'color',
      labelAr: 'لون الطلاء',
      labelEn: 'Paint color',
      type: 'SELECT',
      allowedValues: ['Black', 'White'],
    });

    const effective = await getEffectiveAttributeDefinitions(child.id);
    const colorDefs = effective.filter((d) => d.key === 'color');
    expect(colorDefs).toHaveLength(1);
    expect(colorDefs[0]?.type).toBe('SELECT');
    expect(colorDefs[0]?.labelEn).toBe('Paint color');

    // The parent's own effective set is untouched by the child's override.
    const parentEffective = await getEffectiveAttributeDefinitions(parent.id);
    expect(parentEffective[0]?.type).toBe('TEXT');
  });
});

describe('validateProductAttributes', () => {
  async function carsCategory() {
    const category = await createCategory({ slug: 'cars', nameAr: 'سيارات', nameEn: 'Cars' });
    await createAttributeDefinition({
      categoryId: category.id,
      key: 'fuel_type',
      labelAr: 'نوع الوقود',
      labelEn: 'Fuel type',
      type: 'SELECT',
      allowedValues: ['Petrol', 'Hybrid', 'Electric'],
      required: true,
    });
    await createAttributeDefinition({
      categoryId: category.id,
      key: 'seating',
      labelAr: 'عدد المقاعد',
      labelEn: 'Seating',
      type: 'NUMBER',
      required: false,
    });
    return category;
  }

  it('accepts valid values, required and optional', async () => {
    const category = await carsCategory();
    const result = await validateProductAttributes(category.id, {
      fuel_type: 'Hybrid',
      seating: 5,
    });
    expect(result).toEqual({ fuel_type: 'Hybrid', seating: 5 });
  });

  it('accepts a valid value with the optional field omitted', async () => {
    const category = await carsCategory();
    const result = await validateProductAttributes(category.id, { fuel_type: 'Petrol' });
    expect(result).toEqual({ fuel_type: 'Petrol' });
  });

  it('rejects a missing required field', async () => {
    const category = await carsCategory();
    await expect(validateProductAttributes(category.id, { seating: 5 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects a value outside allowedValues', async () => {
    const category = await carsCategory();
    await expect(
      validateProductAttributes(category.id, { fuel_type: 'Diesel' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects the wrong type for a field', async () => {
    const category = await carsCategory();
    await expect(
      validateProductAttributes(category.id, { fuel_type: 'Petrol', seating: 'five' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects an unknown key not defined for the category', async () => {
    const category = await carsCategory();
    await expect(
      validateProductAttributes(category.id, { fuel_type: 'Petrol', not_a_real_attribute: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('accepts a MULTI_SELECT array of allowed values', async () => {
    const category = await createCategory({
      slug: 'electronics',
      nameAr: 'إلكترونيات',
      nameEn: 'Electronics',
    });
    await createAttributeDefinition({
      categoryId: category.id,
      key: 'connectivity',
      labelAr: 'الاتصال',
      labelEn: 'Connectivity',
      type: 'MULTI_SELECT',
      allowedValues: ['WiFi', 'Bluetooth', 'NFC'],
    });
    const result = await validateProductAttributes(category.id, {
      connectivity: ['WiFi', 'Bluetooth'],
    });
    expect(result).toEqual({ connectivity: ['WiFi', 'Bluetooth'] });
  });

  it('rejects a BOOLEAN field given a non-boolean value', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    await createAttributeDefinition({
      categoryId: category.id,
      key: 'waterproof',
      labelAr: 'مقاوم للماء',
      labelEn: 'Waterproof',
      type: 'BOOLEAN',
    });
    await expect(
      validateProductAttributes(category.id, { waterproof: 'yes' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('deleteAttributeDefinition', () => {
  it('removes a definition — it no longer appears in the effective set', async () => {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    const definition = await createAttributeDefinition({
      categoryId: category.id,
      key: 'material',
      labelAr: 'الخامة',
      labelEn: 'Material',
      type: 'TEXT',
    });
    await deleteAttributeDefinition(definition.id);
    expect(await getEffectiveAttributeDefinitions(category.id)).toEqual([]);
  });

  it('rejects an id that does not exist', async () => {
    await expect(
      deleteAttributeDefinition('00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
