import * as categoriesRepo from '../db/categoriesRepo';

export function listCategories() {
  return categoriesRepo.listCategories();
}

export function createCategory(input: { name: string; parentId?: number | null }) {
  return categoriesRepo.createCategory(input);
}
